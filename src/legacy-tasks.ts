import {legacyRecipientFields,resolveLegacyRecipient,type LegacyRecipientKind} from './legacy-recipients.ts';
import {AuthoringApiError,type AuthoringBinding} from './authoring-api.ts';
import {legacyText,legacyFormPreserved,parseLegacyTextForm,type LegacyRecipe,type LegacyPage,type LegacyTextForm} from './legacy-authoring.ts';
interface Level {level_id:number;level_number:number;level_name:string}
export interface LegacyTaskContext {
 binding:AuthoringBinding;
 recipientKind?(signal?:AbortSignal):Promise<LegacyRecipientKind>;
 level(id:number,signal?:AbortSignal):Promise<Level>;
 ids(ordinal:number,signal?:AbortSignal):Promise<number[]>;
 exact(levelId:number,taskId:number,signal?:AbortSignal):Promise<{level:Level;form:LegacyTextForm;path:string;version:string;preservationVersion:string;literalPreservationVersion:string}>;
 dispatch(recipe:LegacyRecipe,signal?:AbortSignal):Promise<LegacyPage>;
}
export class LegacyTasks {
 readonly #context:LegacyTaskContext;constructor(context:LegacyTaskContext){this.#context=context;}
 async read(levelId:number,signal?:AbortSignal){
  const level=await this.#context.level(levelId,signal),ids=await this.#context.ids(level.level_number,signal),tasks:Record<string,unknown>[]=[];
  for(const id of ids){const task=await this.#context.exact(levelId,id,signal);tasks.push({task_id:id,task_text:task.form.text,replace_nl_to_br:task.form.replaceNewlines,...legacyRecipientFields(task.form.recipient,task.form.recipientOptions,task.form.recipientKind),_authoring_revision:task.version,_authoring_preservation:task.preservationVersion,_authoring_literal_preservation:task.literalPreservationVersion,_authoring_replace_newlines:task.form.replaceNewlines});}
  const value=JSON.stringify({profile:'legacy-task-index-v1',binding:this.#context.binding,level,tasks}),bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return {game_id:this.#context.binding.gameId,level,tasks,version:'legacy-observed:task-index-v1:'+Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('')};
 }
 async request(path:string,init:RequestInit={}):Promise<Response|undefined>{
  const match=path.match(new RegExp(`^/admin/games/${this.#context.binding.gameId}/levels/([1-9]\\d*)/tasks(?:/([1-9]\\d*))?$`));if(!match)return undefined;
  const method=(init.method??'GET').toUpperCase(),create=!match[2]&&method==='POST',remove=!!match[2]&&method==='DELETE';if(!create&&!remove&&!(method==='GET'&&!match[2]))return undefined;
  const levelId=Number(match[1]),before=await this.read(levelId,init.signal??undefined);if(method==='GET')return Response.json(before);
  const expected=new Headers(init.headers).get('X-Authoring-Expected-Revision');if(!expected||expected!==before.version)return new Response(null,{status:409});
  let recipe:LegacyRecipe,createForm:LegacyTextForm|undefined,desired:string|undefined,recipient=0,replaceNewlines=false;
  if(create){
   let fields:any;try{fields=JSON.parse(String(init.body));}catch{throw new AuthoringApiError('unsupported');}
   if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).some(key=>!['task_text','for_member_id','for_user_id','for_team_id','replace_nl_to_br'].includes(key))||typeof fields.task_text!=='string'||fields.task_text.length>100000||typeof fields.replace_nl_to_br!=='boolean')throw new AuthoringApiError('unsupported');
   desired=fields.task_text;replaceNewlines=fields.replace_nl_to_br;const formPath=`/Administration/Games/TaskEdit.aspx?gid=${this.#context.binding.gameId}&level=${before.level.level_number}`;
   createForm=parseLegacyTextForm(await this.#context.dispatch({kind:'task-add-read',effect:'read',method:'GET',path:formPath},init.signal??undefined),this.#context.binding,formPath,{text:'inputTask',recipient:'forMemberID',submit:'btnAdd'});
   recipient=resolveLegacyRecipient(fields,createForm.recipientOptions,0,await this.#context.recipientKind?.(init.signal??undefined));
   const controls=createForm.controls.filter(([name])=>name!=='chkReplaceNlToBr').map(([name,value]):[string,string]=>[name,name==='inputTask'?fields.task_text:name==='forMemberID'?String(recipient):value]);
   if(createForm.controlCounts.chkReplaceNlToBr!==1||createForm.checkboxValues.chkReplaceNlToBr===undefined)throw new AuthoringApiError('unsupported');
   if(replaceNewlines)controls.push(['chkReplaceNlToBr',createForm.checkboxValues.chkReplaceNlToBr]);
   const body=new URLSearchParams(controls.map(([name,value])=>[name,value.replace(/\r\n|\r|\n/g,'\r\n')])).toString();
   recipe={kind:'task-create',effect:'mutation',method:'POST',path:formPath,body};
  }else{
   if(init.body!==undefined&&init.body!==null||!before.tasks.some(row=>row.task_id===Number(match[2])))throw new AuthoringApiError('unsupported');
   recipe={kind:'task-delete',effect:'mutation',method:'GET',path:`/Administration/Games/TaskEdit.aspx?gid=${this.#context.binding.gameId}&level=${before.level.level_number}&action=TaskDelete&tid=${match[2]}`};
  }
  // An inventory fingerprint is specific to task membership and exact task forms.
  if((await this.read(levelId,init.signal??undefined)).version!==before.version)return new Response(null,{status:409});
  try{await this.#context.dispatch(recipe,init.signal??undefined);}catch{/* No retry: verify the result independently. */}
  try{
   const after=await this.read(levelId,init.signal??undefined);if(after.level.level_number!==before.level.level_number)throw new Error();
   if(remove){const expectedRows=before.tasks.filter(row=>row.task_id!==Number(match[2]));if(JSON.stringify(after.tasks)!==JSON.stringify(expectedRows))throw new Error();return Response.json({...after,deleted_task_id:Number(match[2]),warnings:['legacy-no-server-cas']});}
   const ids=new Set(before.tasks.map(row=>row.task_id)),added=after.tasks.filter(row=>!ids.has(row.task_id));
   if(added.length!==1||after.tasks.length!==before.tasks.length+1||JSON.stringify(after.tasks.filter(row=>ids.has(row.task_id)))!==JSON.stringify(before.tasks)||added[0].task_text!==legacyText(desired!))throw new Error();
   const exact=await this.#context.exact(levelId,Number(added[0].task_id),init.signal??undefined);
   if(exact.form.recipient!==recipient||exact.form.replaceNewlines!==replaceNewlines||!legacyFormPreserved(createForm!,exact.form,['inputTask','forMemberID','chkReplaceNlToBr','btnAdd.x','btnAdd.y']))throw new Error();
   return Response.json({...after,created_task_id:added[0].task_id,warnings:['legacy-no-server-cas','legacy-literal-text-newline-display-flag']});
  }catch{throw new AuthoringApiError('unknown-after-dispatch');}
 }
}
