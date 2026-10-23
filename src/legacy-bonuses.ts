import {AuthoringApiError,sameAuthoringBinding,type AuthoringBinding} from './authoring-api.ts';
import {parseLegacyLevelIndex,type LegacySessionPort,type LegacyRecipe} from './legacy-authoring.ts';
import {extraForm,extraValue,extraRadio,extraChecked,extraNumber,extraRevision,extraPreserved,extraTree,extraNodes,extraAttr,extraFail,type ExtraForm} from './legacy-extra-form.ts';
type Level={level_id:number;level_number:number;level_name:string};
type Row=Record<string,unknown>&{bonus_id:number;answers:{answer_id:number;answer_text:string}[]};
interface Merge {body:URLSearchParams;changed:string[];expected:Row;newAnswers:string[]}
const sameUrl=(a:URL,b:URL)=>a.origin===b.origin&&a.pathname===b.pathname&&!a.hash&&!b.hash&&JSON.stringify([...a.searchParams].sort())===JSON.stringify([...b.searchParams].sort());
const normalized=(value:string)=>value.replace(/\r\n|\r/g,'\n');
const number=(value:unknown,min=0):number=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min)return extraFail();return value;};
const text=(value:unknown,max=100000):string=>{if(typeof value!=='string'||value.length>max)return extraFail();return normalized(value);};
const scalar={bonus_name:'txtBonusName',bonus_text:'txtTask',help_text:'txtHelp',absolute_from:'txtValidFrom',absolute_to:'txtValidTo'}as const;
const flags={absolute_enabled:'chkAbsoluteLimit',delay_enabled:'chkDelay',relative_enabled:'chkRelativeLimit',is_negative:'negative'}as const;
const durations={reward_seconds:['txtHours','txtMinutes','txtSeconds'],delay_seconds:['txtDelayHours','txtDelayMinutes','txtDelaySeconds'],relative_seconds:['txtValidHours','txtValidMinutes','txtValidSeconds']}as const;
const timingToggles={absolute_enabled:['txtValidFrom','txtValidTo'],delay_enabled:durations.delay_seconds,relative_enabled:durations.relative_seconds}as const;
const timingControls=Object.values(timingToggles).flat()as readonly string[];
const mapped=(name:string)=>Object.values(scalar).includes(name as never)||Object.values(flags).includes(name as never)||Object.values(durations).flat().includes(name as never)||name==='rbAllLevels'||/^level_[1-9]\d*$/.test(name)||/^answer_-?[1-9]\d*$/.test(name)||['btnAdd','btnUpdate'].includes(name);
async function hash(binding:AuthoringBinding,kind:string,value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({binding,kind,value})));return 'legacy-observed:'+kind+':'+Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');}
async function preservation(binding:AuthoringBinding,form:ExtraForm){return hash(binding,'bonus-preserved',{
 controls:form.fields.filter(row=>!mapped(row.name)&&!row.name.startsWith('__')),
 topology:form.fields.filter(row=>mapped(row.name)&&!/^answer_/.test(row.name)&&!['btnAdd','btnUpdate'].includes(row.name)).map(row=>({name:row.name,type:row.type,disabled:timingControls.includes(row.name)?false:row.disabled,...(row.options?{options:row.options}:{}),...(['checkbox','radio'].includes(row.type)?{wire_values:row.values}:{})})),
});}
export class LegacyBonuses {
 readonly #session:LegacySessionPort;readonly #binding:AuthoringBinding;
 constructor(session:LegacySessionPort){this.#session=session;this.#binding={...session.binding};}
 async #dispatch(recipe:LegacyRecipe,signal?:AbortSignal){if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('session-changed');signal?.throwIfAborted();const page=await this.#session.dispatch(Object.freeze(recipe),signal);if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('session-changed');return page;}
 async #levels(signal?:AbortSignal){const path=`/Administration/Games/LevelManager.aspx?gid=${this.#binding.gameId}`;return parseLegacyLevelIndex(await this.#dispatch({kind:'level-index',effect:'read',method:'GET',path},signal),this.#binding);}
 async #level(id:number,signal?:AbortSignal){const row=(await this.#levels(signal)).find(row=>row.level_id===id);if(!row)return extraFail();return row;}
 #url(level:Level,id:number|undefined,action:string){return `/Administration/Games/BonusEdit.aspx?gid=${this.#binding.gameId}&level=${level.level_number}${id===undefined?'':'&bonus='+id}&action=${action}`;}
 async #refs(level:Level,signal?:AbortSignal){
  const path=`/Administration/Games/LevelEditor.aspx?gid=${this.#binding.gameId}&level=${level.level_number}`,root=extraTree(await this.#dispatch({kind:'level-editor-read',effect:'read',method:'GET',path},signal),this.#binding,path),ids=new Set<number>();let add=false;
  for(const node of extraNodes(root))for(const key of ['href','onclick']){const raw=extraAttr(node,key);if(!raw||!raw.includes('BonusEdit.aspx'))continue;const candidates=raw.includes('GameEditor(')?[...raw.matchAll(/['"]([^'"]*BonusEdit\.aspx[^'"]*)['"]/g)].map(row=>row[1]):[raw];
   for(const value of candidates){let url:URL;try{url=new URL(value,`https://${this.#binding.domain}/Administration/Games/`);}catch{return extraFail();}const keys=[...url.searchParams.keys()];if(url.origin!==`https://${this.#binding.domain}`||url.pathname!=='/Administration/Games/BonusEdit.aspx'||url.searchParams.get('gid')!==String(this.#binding.gameId)||url.searchParams.get('level')!==String(level.level_number)||new Set(keys).size!==keys.length||keys.some(k=>!['gid','level','bonus','action'].includes(k)))return extraFail();const action=url.searchParams.get('action');if(action==='add'&&!url.searchParams.has('bonus'))add=true;else if(['view','edit'].includes(action??'')&&/^[1-9]\d*$/.test(url.searchParams.get('bonus')??'')){ids.add(number(Number(url.searchParams.get('bonus')),1));}else return extraFail();}
  }
  if(ids.size>200||!ids.size&&!add)return extraFail();return {ids:[...ids].sort((a,b)=>a-b),add};
 }
 async #exact(level:Level,id:number|undefined,signal?:AbortSignal){
  const path=this.#url(level,id,id===undefined?'add':'edit'),page=await this.#dispatch({kind:'bonus-form-read',effect:'read',method:'GET',path},signal),form=extraForm(page,this.#binding,path,['ddlBonusFor','txtBonusName','txtTask','rbAllLevels','txtHelp',...Object.values(flags),...Object.values(durations).flat(),'txtValidFrom','txtValidTo'],name=>name===(id===undefined?'btnAdd':'btnUpdate'),'/Administration/Games/BonusEdit.aspx');
  const expected=new URL(this.#url(level,id??0,id===undefined?'save':'update'),`https://${this.#binding.domain}`),target=new URL(form.action,`https://${this.#binding.domain}`);
  if(!sameUrl(target,expected))return extraFail();
  const mode=extraRadio(form,'rbAllLevels');if(!['0','1'].includes(mode))return extraFail();
  const row:Row={bonus_id:id??0,recipient_member_id:extraNumber(form,'ddlBonusFor'),all_levels:mode==='0',level_ids:[],answers:[]};
  const targets=form.fields.filter(field=>/^level_[1-9]\d*$/.test(field.name));if(!targets.length||targets.some(field=>field.type!=='checkbox'))return extraFail();
  row.level_ids=targets.filter(field=>field.checked).map(field=>Number(field.name.slice(6))).sort((a,b)=>a-b);
  for(const [key,name]of Object.entries(scalar))row[key]=normalized(extraValue(form,name));
  for(const [key,name]of Object.entries(flags))row[key]=extraChecked(form,name);
  for(const [key,names]of Object.entries(durations)){row[key]=extraNumber(form,names[0])*3600+extraNumber(form,names[1],59)*60+extraNumber(form,names[2],59);number(row[key]);}
  const answerFields=form.fields.filter(field=>/^answer_-?[1-9]\d*$/.test(field.name));if(!answerFields.length||new Set(answerFields.map(field=>field.name)).size!==answerFields.length||answerFields.some(field=>field.values.length!==1||field.disabled))return extraFail();
  for(const field of answerFields){const answerId=Number(field.name.slice(7));if(answerId>0)row.answers.push({answer_id:number(answerId,1),answer_text:normalized(field.values[0])});else if(field.values[0]!=='')return extraFail();}
  row._authoring_revision=await extraRevision(this.#binding,`bonus:${level.level_id}:${id??0}`,form);row._authoring_preservation=await preservation(this.#binding,form);
  row._authoring_timing_disabled=Object.fromEntries(form.fields.filter(field=>timingControls.includes(field.name)).map(field=>[field.name,field.disabled]));
  return {row,form,path,page};
 }
 async #listing(level:Level,signal?:AbortSignal){
  const refs=await this.#refs(level,signal),bonuses:Row[]=[];for(const id of refs.ids)bonuses.push((await this.#exact(level,id,signal)).row);
  const creation=refs.add?(await this.#exact(level,undefined,signal)).row:null;
  const available=await this.#levels(signal),fresh=available.find(row=>row.level_id===level.level_id);if(!fresh)return extraFail();const end=await this.#refs(fresh,signal);if(fresh.level_number!==level.level_number||JSON.stringify(refs)!==JSON.stringify(end))return extraFail();
  const value={game_id:this.#binding.gameId,level_id:level.level_id,available_level_ids:available.map(row=>row.level_id),bonuses,creation_template:creation};return {...value,version:await hash(this.#binding,'bonuses',value)};
 }
 /** Creation only touches a new native form. Fence membership/template without rereading every sibling body. */
 async #creationListing(level:Level,signal?:AbortSignal){
  const refs=await this.#refs(level,signal);if(!refs.add)throw new AuthoringApiError('unsupported');
  const creation=(await this.#exact(level,undefined,signal)).row,available=await this.#levels(signal),fresh=available.find(row=>row.level_id===level.level_id);
  if(!fresh||fresh.level_number!==level.level_number||JSON.stringify(refs)!==JSON.stringify(await this.#refs(fresh,signal)))return extraFail();
  const value={game_id:this.#binding.gameId,level_id:level.level_id,available_level_ids:available.map(row=>row.level_id),bonus_ids:refs.ids,bonuses:[] as Row[],creation_template:creation,verification_scope:'creation-template-and-membership'};
  return {...value,version:await hash(this.#binding,'bonus-creation',value)};
 }
 #patch(form:ExtraForm,row:Row,patch:Record<string,unknown>,levelIds:number[],create:boolean):Merge{
  const allowed=[...Object.keys(scalar),...Object.keys(flags),...Object.keys(durations),'all_levels','level_ids','answers','new_answers','delete_answer_ids'];if(!Object.keys(patch).length||Object.keys(patch).some(k=>!allowed.includes(k)))throw new AuthoringApiError('unsupported');
  if(create&&(row.recipient_member_id!==0||['bonus_name','bonus_text','help_text','reward_seconds','is_negative','all_levels','level_ids','new_answers'].some(k=>!Object.hasOwn(patch,k))))throw new AuthoringApiError('unsupported');
  const expected=structuredClone(row),body=new URLSearchParams(form.controls),changed:string[]=[];
  const disabled=(name:string)=>{const toggle=Object.entries(timingToggles).find(([,names])=>(names as readonly string[]).includes(name));return toggle&&typeof patch[toggle[0]]==='boolean'?!patch[toggle[0]]:form.fields.find(field=>field.name===name)?.disabled;};
  const set=(name:string,value:string)=>{body.set(name,value);changed.push(name);};
  for(const [key,name]of Object.entries(scalar))if(Object.hasOwn(patch,key)){const value=text(patch[key]);if(disabled(name)||key.startsWith('absolute_')&&value!==''&&!/^\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:\d{2} [AP]M$/.test(value))throw new AuthoringApiError('unsupported');expected[key]=value;set(name,value);}
  for(const [key,name]of Object.entries(flags))if(Object.hasOwn(patch,key)){if(typeof patch[key]!=='boolean')return extraFail();expected[key]=patch[key];changed.push(name);body.delete(name);if(patch[key]){const field=form.fields.find(field=>field.name===name)!;if(field.disabled)return extraFail();body.set(name,field.values[0]);}}
  for(const [key,names]of Object.entries(durations))if(Object.hasOwn(patch,key)){let value=number(patch[key]);expected[key]=value;for(const [index,unit]of [3600,60,1].entries()){const field=form.fields.find(field=>field.name===names[index]);if(!field||disabled(names[index]))throw new AuthoringApiError('unsupported');set(names[index],String(Math.floor(value/unit)));value%=unit;}}
  for(const [key,names]of Object.entries(timingToggles))if(Object.hasOwn(patch,key)){const states=expected._authoring_timing_disabled as Record<string,boolean>;for(const name of names){states[name]=!patch[key];changed.push(name);if(patch[key]){if(!body.has(name))body.set(name,extraValue(form,name));}else body.delete(name);}}
  if(Object.hasOwn(patch,'all_levels')||Object.hasOwn(patch,'level_ids')){
   if(typeof patch.all_levels!=='boolean'||!Array.isArray(patch.level_ids)||!patch.all_levels&&!patch.level_ids.length||patch.level_ids.some(id=>typeof id!=='number'||!levelIds.includes(id))||new Set(patch.level_ids).size!==patch.level_ids.length)return extraFail();
   const ids=[...patch.level_ids].sort((a,b)=>a-b)as number[];expected.all_levels=patch.all_levels;expected.level_ids=ids;set('rbAllLevels',patch.all_levels?'0':'1');
   for(const field of form.fields.filter(field=>/^level_\d+$/.test(field.name))){body.delete(field.name);changed.push(field.name);if(ids.includes(Number(field.name.slice(6))))body.set(field.name,field.values[0]);}
  }
  const answers=structuredClone(row.answers),deleted=patch.delete_answer_ids??[],updates=patch.answers??[],created=patch.new_answers??[];
  if(!Array.isArray(deleted)||!Array.isArray(updates)||!Array.isArray(created)||create&&(deleted.length||updates.length))return extraFail();
  const seen=new Set<number>();for(const value of updates){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='answer_id,answer_text')return extraFail();const id=number(value.answer_id,1),answer=answers.find(row=>row.answer_id===id);if(!answer||seen.has(id))return extraFail();seen.add(id);answer.answer_text=text(value.answer_text);if(!answer.answer_text)throw new AuthoringApiError('unsupported');set('answer_'+id,answer.answer_text);}
  for(const value of deleted){const id=number(value,1);if(!answers.some(row=>row.answer_id===id)||seen.has(id))return extraFail();seen.add(id);set('answer_'+id,'');}
  const slots=form.fields.filter(field=>/^answer_-[1-9]\d*$/.test(field.name));if(created.length>slots.length)return extraFail();const newAnswers=created.map(value=>text(value));if(newAnswers.some(value=>!value))return extraFail();for(const [index,value]of newAnswers.entries())set(slots[index].name,value);
  expected.answers=answers.filter(row=>!deleted.includes(row.answer_id));return {body,changed,expected,newAnswers};
 }
 async request(path:string,init:RequestInit):Promise<Response|undefined>{
  const creationOnly=path.endsWith('/bonuses/creation');if(creationOnly)path=path.slice(0,-'/creation'.length);
  const match=path.match(/^\/admin\/games\/([1-9]\d*)\/levels\/([1-9]\d*)\/bonuses(?:\/([1-9]\d*))?$/);if(!match)return;const method=(init.method??'GET').toUpperCase(),id=match[3]?Number(match[3]):undefined;
  if(Number(match[1])!==this.#binding.gameId)throw new AuthoringApiError('invalid-scope');if(!['GET','POST','PUT','PATCH','DELETE'].includes(method)||method==='POST'&&id!==undefined||['PUT','PATCH','DELETE'].includes(method)&&id===undefined)throw new AuthoringApiError('unsupported');
  if(creationOnly&&(id!==undefined||!['GET','POST'].includes(method)))throw new AuthoringApiError('unsupported');
  const signal=init.signal??undefined,level=await this.#level(Number(match[2]),signal),creationBefore=creationOnly?await this.#creationListing(level,signal):undefined,before=creationBefore??await this.#listing(level,signal);if(method==='GET'){if(creationBefore){const {bonuses:omitted,...dto}=creationBefore;return Response.json({...dto,bonus_bodies_omitted:true});}return id?Response.json(before.bonuses.find(row=>row.bonus_id===id)??null):Response.json(before);}
  const version=new Headers(init.headers).get('If-Match');if(!version)return Response.json({error:'legacy-observed-revision-required'},{status:428});if(version!==before.version)return Response.json({error:'conflict'},{status:409});
  const old=id===undefined?before.creation_template:before.bonuses.find(row=>row.bonus_id===id);if(!old)return extraFail();const exact=await this.#exact(level,id,signal);if(exact.row._authoring_revision!==old._authoring_revision)return Response.json({error:'conflict'},{status:409});
  let recipe:LegacyRecipe,merged:Merge|undefined;
  if(method==='DELETE'){
   const viewPath=this.#url(level,id,'view'),view=await this.#dispatch({kind:'bonus-form-read',effect:'read',method:'GET',path:viewPath},signal),root=extraTree(view,this.#binding,viewPath);let deletion:string|undefined;
   for(const node of extraNodes(root))for(const key of ['href','onclick']){const raw=extraAttr(node,key);if(!raw||!raw.includes('BonusEdit.aspx'))continue;const candidates=raw.includes('(')?[...raw.matchAll(/['"]([^'"]*BonusEdit\.aspx[^'"]*)['"]/g)].map(row=>row[1]):[raw];for(const value of candidates){const url=new URL(value,`https://${this.#binding.domain}/Administration/Games/`);if(sameUrl(url,new URL(this.#url(level,id,'delete'),`https://${this.#binding.domain}`)))deletion=url.pathname+url.search;}}
   if(!deletion)throw new AuthoringApiError('unsupported');recipe={kind:'bonus-delete',effect:'mutation',method:'GET',path:deletion};
  }else{
   if(typeof init.body!=='string')throw new AuthoringApiError('unsupported');let patch:Record<string,unknown>;try{patch=JSON.parse(init.body);}catch{return extraFail();}if(!patch||typeof patch!=='object'||Array.isArray(patch))return extraFail();merged=this.#patch(exact.form,exact.row,patch,(await this.#levels(signal)).map(row=>row.level_id),id===undefined);
   recipe={kind:'bonus-write',effect:'mutation',method:'POST',path:exact.form.action,body:new URLSearchParams([...merged.body].map(([key,value])=>[key,value.replace(/\r\n|\r|\n/g,'\r\n')])).toString()};
  }
  if((await this.#level(level.level_id,signal)).level_number!==level.level_number)return Response.json({error:'conflict'},{status:409});
  try{await this.#dispatch(recipe,signal);}catch{/* Reconcile once without retry. */}
  try{
   const fresh=await this.#level(level.level_id,signal);if(fresh.level_number!==level.level_number)throw new Error();
   let after:{bonuses:Row[]};let verifiedForm:ExtraForm|undefined;
   if(creationOnly){
    if(!creationBefore)throw new Error();const refs=await this.#refs(fresh,signal),oldIds=creationBefore.bonus_ids;
    const added=refs.ids.filter(value=>!oldIds.includes(value));
    if(!refs.add||added.length!==1||refs.ids.length!==oldIds.length+1||oldIds.some(value=>!refs.ids.includes(value)))throw new Error();
    const verified=await this.#exact(fresh,added[0],signal);verifiedForm=verified.form;after={bonuses:[verified.row]};
   }else after=await this.#listing(fresh,signal);
   if(method==='DELETE'){if(after.bonuses.some(row=>row.bonus_id===id)||JSON.stringify(before.bonuses.filter(row=>row.bonus_id!==id))!==JSON.stringify(after.bonuses))throw new Error();return new Response(null,{status:204});}
   const candidates=id===undefined?after.bonuses.filter(row=>!before.bonuses.some(old=>old.bonus_id===row.bonus_id)):after.bonuses.filter(row=>row.bonus_id===id);if(candidates.length!==1||!merged)throw new Error();const row=candidates[0],target=row.bonus_id;
   if(JSON.stringify(before.bonuses.filter(row=>row.bonus_id!==id))!==JSON.stringify(after.bonuses.filter(row=>row.bonus_id!==target)))throw new Error();
   for(const [key,value]of Object.entries(merged.expected))if(!['bonus_id','answers','_authoring_revision','_authoring_preservation'].includes(key)&&JSON.stringify(value)!==JSON.stringify(row[key]))throw new Error();
   const retained=merged.expected.answers;if(!retained.every(answer=>row.answers.some(actual=>actual.answer_id===answer.answer_id&&actual.answer_text===answer.answer_text)))throw new Error();const additions=row.answers.filter(actual=>!retained.some(answer=>answer.answer_id===actual.answer_id));if(additions.some(answer=>exact.row.answers.some(old=>old.answer_id===answer.answer_id))||JSON.stringify(additions.map(answer=>answer.answer_text))!==JSON.stringify(merged.newAnswers))throw new Error();
   const result=verifiedForm?{form:verifiedForm}:await this.#exact(fresh,target,signal);if(!extraPreserved(exact.form,result.form,[...merged.changed,'btnAdd.x','btnAdd.y','btnUpdate.x','btnUpdate.y',...exact.form.fields.filter(field=>/^answer_-\d+$/.test(field.name)).map(field=>field.name),...result.form.fields.filter(field=>/^answer_[1-9]\d*$/.test(field.name)&&!exact.form.fields.some(old=>old.name===field.name)).map(field=>field.name)]))throw new Error();
   return Response.json(creationOnly?{...row,verification_scope:'created-bonus-and-membership',warnings:['sibling-content-not-reread']} :row,{status:id===undefined?201:200});
  }catch{throw new AuthoringApiError('unknown-after-dispatch');}
 }
}
