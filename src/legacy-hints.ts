import {AuthoringApiError, type AuthoringBinding} from './authoring-api.ts';
import {legacyDocument, legacyNodes, legacyText, legacyFormPreserved, legacyFormPreservationVersion, parseLegacyTextForm, type LegacyPage, type LegacyRecipe, type LegacyTextForm} from './legacy-authoring.ts';
type Level = {level_id:number;level_number:number;level_name:string};
export interface LegacyHintContext {
  binding: AuthoringBinding;
  level(id:number,signal?:AbortSignal): Promise<Level>;
  editor(ordinal:number,signal?:AbortSignal): Promise<LegacyPage>;
  dispatch(recipe:LegacyRecipe,signal?:AbortSignal):Promise<LegacyPage>;
}
const fail = ():never=>{throw new AuthoringApiError('incomplete-read');};
const attr=(node:any,key:string):string|undefined=>node.attrs?.find((value:any)=>value.name===key)?.value;
const one=(form:LegacyTextForm,name:string):string=>{const values=form.controls.filter(([key])=>key===name).map(([,value])=>value);if(values.length!==1)return fail();return values[0];};
function number(form:LegacyTextForm,name:string,max=Number.MAX_SAFE_INTEGER):number {const value=one(form,name);if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>max)return fail();return Number(value);}
async function revision(binding:AuthoringBinding,level:Level,id:number,penalty:boolean,form:LegacyTextForm) {
  const value=JSON.stringify({profile:'legacy-hint-v1',binding,levelId:level.level_id,ordinal:level.level_number,id,penalty,controls:form.controls.filter(([name])=>!['btnUpdate.x','btnUpdate.y'].includes(name))});
  return 'legacy-observed:hint-v1:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export class LegacyHints {
  readonly #context:LegacyHintContext;
  constructor(context:LegacyHintContext){this.#context=context;}
  async #refs(level:Level,signal?:AbortSignal) {
    const binding=this.#context.binding,path=`/Administration/Games/LevelEditor.aspx?gid=${binding.gameId}&level=${level.level_number}`;
    const root=legacyDocument(await this.#context.editor(level.level_number,signal),binding,path),refs=new Map<number,{id:number;penalty:boolean}>();
    for(const node of legacyNodes(root)) {
      if(!('tagName' in node)||node.tagName!=='a')continue;const href=attr(node,'href')??'';if(!/PromptEdit\.aspx/i.test(href))continue;
      const call=href.match(/^javascript:GameEditor\(\s*(['"])([^'"]+)\1\s*,\s*(['"])(Prompt_\d+_\d+(?:_\d+)?)\3(?:\s*,\s*\d+\s*,\s*\d+)?\s*\)\s*;?$/);if(!call)return fail();
      const url=new URL(call[2],`https://${binding.domain}/Administration/Games/`),id=url.searchParams.get('prid');
      if(url.origin!==`https://${binding.domain}`||url.pathname!=='/Administration/Games/PromptEdit.aspx'||url.searchParams.get('gid')!==String(binding.gameId)||url.searchParams.get('level')!==String(level.level_number)||[...url.searchParams.keys()].some(key=>!['gid','level','prid','penalty'].includes(key))||url.searchParams.has('penalty')&&url.searchParams.get('penalty')!=='1')return fail();
      const expected=`Prompt_${binding.gameId}_${level.level_number}${id?'_'+id:''}`;if(call[4]!==expected)return fail();
      if(id===null)continue;if(!/^[1-9]\d*$/.test(id)||!Number.isSafeInteger(Number(id)))return fail();
      const ref={id:Number(id),penalty:url.searchParams.get('penalty')==='1'},old=refs.get(ref.id);if(old&&old.penalty!==ref.penalty)return fail();refs.set(ref.id,ref);
    }
    if(refs.size>200)return fail();return [...refs.values()];
  }
  #path(level:Level,id:number,penalty:boolean){return `/Administration/Games/PromptEdit.aspx?gid=${this.#context.binding.gameId}&level=${level.level_number}&action=PromptEdit&prid=${id}${penalty?'&penalty=1':''}`;}
  async #exact(level:Level,id:number,penalty:boolean,signal?:AbortSignal) {
    const path=this.#path(level,id,penalty),form=parseLegacyTextForm(await this.#context.dispatch({kind:'hint-edit-read',effect:'read',method:'GET',path},signal),this.#context.binding,path,{text:'NewPrompt',recipient:'ForMemberID',submit:'btnUpdate'});
    const timeout=number(form,'NewPromptTimeoutDays')*86400+number(form,'NewPromptTimeoutHours',23)*3600+number(form,'NewPromptTimeoutMinutes',59)*60+number(form,'NewPromptTimeoutSeconds',59);
    if(!Number.isSafeInteger(timeout))return fail();
    const row:Record<string,unknown>={help_id:id,help_text:form.text,timeout,is_penalty:penalty,for_member_id:0,for_user_id:0,for_team_id:0};
    if(penalty) {
      if(form.controlCounts.chkRequestPenaltyConfirm!==1||!Object.hasOwn(form.checkboxValues,'chkRequestPenaltyConfirm'))return fail();
      row.penalty_comment=legacyText(one(form,'txtPenaltyComment'));row.request_penalty_confirm=form.controls.some(([name])=>name==='chkRequestPenaltyConfirm');
      row.penalty_time=number(form,'PenaltyPromptHours')*3600+number(form,'PenaltyPromptMinutes',59)*60+number(form,'PenaltyPromptSeconds',59);if(!Number.isSafeInteger(row.penalty_time))return fail();
    }
    row._authoring_revision=await revision(this.#context.binding,level,id,penalty,form);
    row._authoring_preservation=await legacyFormPreservationVersion(this.#context.binding,`hint:${level.level_id}:${id}`,form,['NewPrompt','NewPromptTimeoutDays','NewPromptTimeoutHours','NewPromptTimeoutMinutes','NewPromptTimeoutSeconds']);
    return {row,form,path};
  }
  async read(levelId:number,signal?:AbortSignal) {
    const level=await this.#context.level(levelId,signal),refs=await this.#refs(level,signal),helps:Record<string,unknown>[]=[],penalty_helps:Record<string,unknown>[]=[];
    for(const ref of refs){const {row}=await this.#exact(level,ref.id,ref.penalty,signal);(ref.penalty?penalty_helps:helps).push(row);}
    return {helps,penalty_helps};
  }
  async #listing(levelId:number,signal?:AbortSignal){const result=await this.read(levelId,signal),value=JSON.stringify({binding:this.#context.binding,levelId,...result});const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return {...result,game_id:this.#context.binding.gameId,level_id:levelId,version:'legacy-observed:hints:'+Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('')};}
  async #crud(levelId:number,id:number|undefined,method:string,init:RequestInit):Promise<Response>{
    const level=await this.#context.level(levelId,init.signal??undefined),before=await this.#listing(levelId,init.signal??undefined);if(method==='GET')return Response.json(before);
    const expected=new Headers(init.headers).get('If-Match');if(!expected)return Response.json({error:'legacy-observed-revision-required'},{status:428});if(expected!==before.version)return Response.json({error:'conflict'},{status:409});
    const allBefore=[...before.helps,...before.penalty_helps],existing=id===undefined?undefined:allBefore.find(row=>row.help_id===id);if(id!==undefined&&!existing)return fail();
    let recipe:LegacyRecipe,form:LegacyTextForm|undefined,patch:Record<string,unknown>|undefined,penalty=false;
    if(method==='DELETE'){
      penalty=existing!.is_penalty===true;const path=`/Administration/Games/PromptEdit.aspx?gid=${this.#context.binding.gameId}&level=${level.level_number}&prid=${id}${penalty?'&penalty=1':''}`,page=await this.#context.dispatch({kind:'hint-view-read',effect:'read',method:'GET',path},init.signal??undefined),root=legacyDocument(page,this.#context.binding,path);let deletion:string|undefined;
      for(const node of legacyNodes(root)){const raw=attr(node,'href')??'',candidates=raw.startsWith('javascript:')?[...raw.matchAll(/['"]([^'"]*PromptEdit\.aspx[^'"]*)['"]/g)].map(match=>match[1]):[raw];for(const value of candidates){let url:URL;try{url=new URL(value,`https://${this.#context.binding.domain}/Administration/Games/`);}catch{continue;}const keys=[...url.searchParams.keys()];if(['http:','https:'].includes(url.protocol)&&url.hostname===this.#context.binding.domain&&!url.port&&!url.username&&!url.password&&!url.hash&&url.pathname==='/Administration/Games/PromptEdit.aspx'&&url.searchParams.get('gid')===String(this.#context.binding.gameId)&&url.searchParams.get('level')===String(level.level_number)&&url.searchParams.get('prid')===String(id)&&url.searchParams.get('action')==='PromptDelete'&&keys.length===new Set(keys).size&&keys.every(key=>['gid','level','prid','action','penalty'].includes(key))&&url.searchParams.has('penalty')===penalty&&(!penalty||url.searchParams.get('penalty')==='1')){deletion=url.pathname+url.search;}}}
      if(!deletion)throw new AuthoringApiError('unsupported');recipe={kind:'hint-delete',effect:'mutation',method:'GET',path:deletion};
    }else {
      try{patch=JSON.parse(String(init.body));}catch{throw new AuthoringApiError('unsupported');}
      if(!patch||typeof patch!=='object'||Array.isArray(patch)||typeof patch.is_penalty!=='boolean'||typeof patch.help_text!=='string'||patch.help_text.length>100000||!Number.isSafeInteger(patch.timeout)||Number(patch.timeout)<0||Object.keys(patch).some(key=>!['help_text','timeout','is_penalty','for_member_id','for_user_id','for_team_id','penalty_comment','penalty_time','request_penalty_confirm'].includes(key))||['for_member_id','for_user_id','for_team_id'].some(key=>patch![key]!==undefined&&patch![key]!==0))throw new AuthoringApiError('unsupported');
      penalty=patch.is_penalty;if(!penalty&&['penalty_comment','penalty_time','request_penalty_confirm'].some(key=>patch![key]!==undefined))throw new AuthoringApiError('unsupported');
      if(penalty&&(typeof patch.penalty_comment!=='string'||patch.penalty_comment.length>100000||!Number.isSafeInteger(patch.penalty_time)||Number(patch.penalty_time)<0||typeof patch.request_penalty_confirm!=='boolean'))throw new AuthoringApiError('unsupported');
      const path=`/Administration/Games/PromptEdit.aspx?gid=${this.#context.binding.gameId}&level=${level.level_number}${penalty?'&penalty=1':''}`;
      form=parseLegacyTextForm(await this.#context.dispatch({kind:'hint-add-read',effect:'read',method:'GET',path},init.signal??undefined),this.#context.binding,path,{text:'NewPrompt',recipient:'ForMemberID',submit:'btnAdd'});
      if(form.replaceNewlines)throw new AuthoringApiError('unsupported');
      const body=new URLSearchParams(form.controls),duration=(value:number,names:string[],units:number[])=>{for(let index=0;index<names.length;index++){body.set(names[index],String(Math.floor(value/units[index])));value%=units[index];}};
      body.set('NewPrompt',String(patch.help_text));duration(Number(patch.timeout),['NewPromptTimeoutDays','NewPromptTimeoutHours','NewPromptTimeoutMinutes','NewPromptTimeoutSeconds'],[86400,3600,60,1]);
      if(penalty){body.set('txtPenaltyComment',String(patch.penalty_comment));duration(Number(patch.penalty_time),['PenaltyPromptHours','PenaltyPromptMinutes','PenaltyPromptSeconds'],[3600,60,1]);body.delete('chkRequestPenaltyConfirm');if(patch.request_penalty_confirm){if(!Object.hasOwn(form.checkboxValues,'chkRequestPenaltyConfirm'))return fail();body.set('chkRequestPenaltyConfirm',form.checkboxValues.chkRequestPenaltyConfirm);}}
      recipe={kind:'hint-create',effect:'mutation',method:'POST',path,body:new URLSearchParams([...body].map(([name,value])=>[name,value.replace(/\r\n|\r|\n/g,'\r\n')])).toString()};
    }
    const fresh=await this.#context.level(levelId,init.signal??undefined);if(fresh.level_number!==level.level_number)return new Response(null,{status:409});
    try{await this.#context.dispatch(recipe,init.signal??undefined);}catch{/* One request only. Read back independently. */}
    try {
      const afterLevel=await this.#context.level(levelId,init.signal??undefined);if(afterLevel.level_number!==level.level_number)throw new Error();const after=await this.#listing(levelId,init.signal??undefined),rows=[...after.helps,...after.penalty_helps];
      const omit=(values:Record<string,unknown>[],target:number)=>values.filter(row=>row.help_id!==target);
      if(method==='DELETE'){if(rows.some(row=>row.help_id===id)||JSON.stringify(omit(allBefore,id!))!==JSON.stringify(rows))throw new Error();return new Response(null,{status:204});}
      const candidates=rows.filter(row=>!allBefore.some(old=>old.help_id===row.help_id));if(candidates.length!==1||!patch||!form)throw new Error();const actual=candidates[0];
      for(const [key,value]of Object.entries(patch))if(actual[key]!==(['help_text','penalty_comment'].includes(key)&&typeof value==='string'?legacyText(value):value))throw new Error();
      if(actual.is_penalty!==penalty||JSON.stringify(allBefore)!==JSON.stringify(omit(rows,Number(actual.help_id))))throw new Error();
      const exact=await this.#exact(afterLevel,Number(actual.help_id),penalty,init.signal??undefined),changes=['NewPrompt','NewPromptTimeoutDays','NewPromptTimeoutHours','NewPromptTimeoutMinutes','NewPromptTimeoutSeconds','btnAdd.x','btnAdd.y',...(penalty?['txtPenaltyComment','PenaltyPromptHours','PenaltyPromptMinutes','PenaltyPromptSeconds','chkRequestPenaltyConfirm']:[])];
      if(!legacyFormPreserved(form,exact.form,changes))throw new Error();return Response.json(actual,{status:201});
    }catch{throw new AuthoringApiError('unknown-after-dispatch');}
  }
  async request(path:string,init:RequestInit={}):Promise<Response|undefined> {
    const collection=path.match(new RegExp(`^/admin/games/${this.#context.binding.gameId}/levels/([1-9]\\d*)/helps$`)),method=(init.method??'GET').toUpperCase();if(collection&&['GET','POST'].includes(method))return this.#crud(Number(collection[1]),undefined,method,init);
    const match=path.match(new RegExp(`^/admin/games/${this.#context.binding.gameId}/levels/([1-9]\\d*)/helps/([1-9]\\d*)$`));if(!match)return undefined;
    if(method==='DELETE')return this.#crud(Number(match[1]),Number(match[2]),method,init);if(!['GET','PUT'].includes(method))throw new AuthoringApiError('unsupported');
    const levelId=Number(match[1]),id=Number(match[2]),level=await this.#context.level(levelId,init.signal??undefined),ref=(await this.#refs(level,init.signal??undefined)).find(row=>row.id===id);if(!ref)return fail();
    const before=await this.#exact(level,id,ref.penalty,init.signal??undefined);if(method==='GET')return Response.json(before.row);
    const expected=new Headers(init.headers).get('X-Authoring-Expected-Revision');if(!expected||expected!==before.row._authoring_revision)return new Response(null,{status:409});
    let patch:any;try{patch=JSON.parse(String(init.body));}catch{throw new AuthoringApiError('unsupported');}
    const allowed=['help_text','timeout','is_penalty','for_member_id','for_user_id','for_team_id',...(ref.penalty?['penalty_comment','penalty_time','request_penalty_confirm']:[])];
    if(!patch||typeof patch!=='object'||Array.isArray(patch)||!Object.keys(patch).length||Object.keys(patch).some(key=>!allowed.includes(key))||['for_member_id','for_user_id','for_team_id'].some(key=>patch[key]!==undefined&&patch[key]!==0)||patch.is_penalty!==undefined&&patch.is_penalty!==ref.penalty)throw new AuthoringApiError('unsupported');
    for(const key of ['help_text','penalty_comment'])if(patch[key]!==undefined&&(typeof patch[key]!=='string'||patch[key].length>100000))throw new AuthoringApiError('unsupported');
    for(const key of ['timeout','penalty_time'])if(patch[key]!==undefined&&(!Number.isSafeInteger(patch[key])||patch[key]<0))throw new AuthoringApiError('unsupported');
    if(patch.request_penalty_confirm!==undefined&&typeof patch.request_penalty_confirm!=='boolean')throw new AuthoringApiError('unsupported');
    const changes=new Map<string,string>();
    if(patch.help_text!==undefined)changes.set('NewPrompt',patch.help_text);
    if(patch.penalty_comment!==undefined)changes.set('txtPenaltyComment',patch.penalty_comment);
    const duration=(value:number,names:string[],units:number[])=>{for(let index=0;index<names.length;index++){const part=Math.floor(value/units[index]);changes.set(names[index],String(part));value%=units[index];}};
    if(patch.timeout!==undefined)duration(patch.timeout,['NewPromptTimeoutDays','NewPromptTimeoutHours','NewPromptTimeoutMinutes','NewPromptTimeoutSeconds'],[86400,3600,60,1]);
    if(patch.penalty_time!==undefined)duration(patch.penalty_time,['PenaltyPromptHours','PenaltyPromptMinutes','PenaltyPromptSeconds'],[3600,60,1]);
    const controls=before.form.controls.filter(([name])=>name!=='chkRequestPenaltyConfirm'||patch.request_penalty_confirm!==false).map(([name,value]):[string,string]=>[name,changes.get(name)??value]);
    if(patch.request_penalty_confirm===true&&!controls.some(([name])=>name==='chkRequestPenaltyConfirm'))controls.push(['chkRequestPenaltyConfirm',before.form.checkboxValues.chkRequestPenaltyConfirm]);
    const fresh=await this.#context.level(levelId,init.signal??undefined);if(fresh.level_number!==level.level_number)return new Response(null,{status:409});
    const body=new URLSearchParams(controls.map(([name,value])=>[name,value.replace(/\r\n|\r|\n/g,'\r\n')])).toString();
    try{await this.#context.dispatch({kind:'hint-update',effect:'mutation',method:'POST',path:before.path,body},init.signal??undefined);}catch{/* Verify independently, never repeat the POST. */}
    try {
      const afterLevel=await this.#context.level(levelId,init.signal??undefined);if(afterLevel.level_number!==level.level_number)throw new Error();
      const afterRefs=await this.#refs(afterLevel,init.signal??undefined);if(!afterRefs.some(row=>row.id===id&&row.penalty===ref.penalty))throw new Error();
      const after=await this.#exact(afterLevel,id,ref.penalty,init.signal??undefined);
      if(!legacyFormPreserved(before.form,after.form,[...changes.keys(),...(patch.request_penalty_confirm===undefined?[]:['chkRequestPenaltyConfirm'])]))throw new Error();
      const expectedRow={...before.row,...patch};delete expectedRow._authoring_revision;delete expectedRow._authoring_preservation;
      for(const [key,value] of Object.entries(expectedRow))if(after.row[key]!==(['help_text','penalty_comment'].includes(key)&&typeof value==='string'?legacyText(value):value))throw new Error();
      return Response.json(after.row);
    }catch{throw new AuthoringApiError('unknown-after-dispatch');}
  }
}
