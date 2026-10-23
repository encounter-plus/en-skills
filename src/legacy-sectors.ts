import {AuthoringApiError,sameAuthoringBinding,type AuthoringBinding} from './authoring-api.ts';
import {LegacyAnswers} from './legacy-answers.ts';
import type {LegacyRecipe,LegacySessionPort} from './legacy-authoring.ts';
import {extraForm,extraRevision,extraValue,extraPreserved,extraFail,extraTree,extraNodes,extraAttr,extraTag} from './legacy-extra-form.ts';
import {parseFragment,serializeOuter} from 'parse5';
const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
/** Native sectors retain stable IDs and verify codes/siblings after exactly one dispatch. */
export class LegacySectors {
 readonly #session:LegacySessionPort;readonly #binding:AuthoringBinding;readonly #answers:LegacyAnswers;
 constructor(session:LegacySessionPort){this.#session=session;this.#binding={...session.binding};this.#answers=new LegacyAnswers(session);}
 async #dispatch(recipe:LegacyRecipe,signal?:AbortSignal){if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('session-changed');const page=await this.#session.dispatch(Object.freeze(recipe),signal);if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('session-changed');return page;}
 async read(levelId:number,signal?:AbortSignal){const snapshot=await this.#answers.read(levelId,signal);if(snapshot.body.sectors.some(row=>row.sector_name===undefined))return extraFail();return {...snapshot,version:'legacy-sector-v1:'+await hash({binding:this.#binding,answers:snapshot.body.version,sectors:snapshot.body.sectors})};}
 async request(path:string,init:RequestInit={}):Promise<Response|undefined>{
  const match=path.match(new RegExp(`^/admin/games/${this.#binding.gameId}/levels/([1-9]\\d*)/sectors(?:/([1-9]\\d*))?$`));if(!match)return undefined;
  const method=(init.method??'GET').toUpperCase();if(!['GET','POST','PUT','DELETE'].includes(method)||method==='POST'&&match[2]||['PUT','DELETE'].includes(method)&&!match[2])throw new AuthoringApiError('unsupported');
  let initialAnswers:string[]=[];let desired:string|undefined;if(method==='PUT'||method==='POST'){let patch:any;try{patch=JSON.parse(String(init.body));}catch{throw new AuthoringApiError('unsupported');}if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!['sector_name',...(method==='POST'?['new_answers']:[])].includes(key))||typeof patch.sector_name!=='string'||!patch.sector_name.trim()||patch.sector_name.length>1000)throw new AuthoringApiError('unsupported');desired=patch.sector_name;if(patch.new_answers!==undefined){if(!Array.isArray(patch.new_answers)||patch.new_answers.length>10||patch.new_answers.some((v:unknown)=>typeof v!=='string'||!v||v.length>100000)||new Set(patch.new_answers).size!==patch.new_answers.length)throw new AuthoringApiError('unsupported');initialAnswers=patch.new_answers;}}else if(init.body!==undefined&&init.body!==null)throw new AuthoringApiError('unsupported');
  const levelId=Number(match[1]),id=match[2]?Number(match[2]):undefined,signal=init.signal??undefined,before=await this.read(levelId,signal);
  const dto=async(snapshot:typeof before)=>({game_id:this.#binding.gameId,level_id:levelId,sectors:snapshot.body.sectors,answers:snapshot.body.answers,sector_proofs:await Promise.all(snapshot.forms.map(async row=>({sector_id:row.id,preservation_version:await extraRevision(this.#binding,'sector-form-'+row.id,row.form)}))),version:snapshot.version});
  if(id&&!before.body.sectors.some(row=>row.sector_id===id))return extraFail();if(method==='GET')return Response.json(id?{...before.body.sectors.find(row=>row.sector_id===id),version:before.version}:await dto(before));
  if(new Headers(init.headers).get('If-Match')!==before.version)return new Response(null,{status:409});
  const base=`/Administration/Games/LevelEditor.aspx?level=${before.level.level_number}&gid=${this.#binding.gameId}`;
  let recipe:LegacyRecipe;
  if(method==='DELETE')recipe={kind:'sector-delete',effect:'mutation',method:'GET',path:base+'&swanswers=1&delsector='+id};
  else {
   const rename=method==='PUT',formPath=rename?`/ALoader/LevelInfo.aspx?gid=${this.#binding.gameId}&level=${before.level.level_number}&task=0&object=2`:base,marker=rename?'updatesector':'savesector';
   let page=await this.#dispatch({kind:rename?'answer-list-read':'sector-form-read',effect:'read',method:'GET',path:formPath},signal);
   if(rename){
    const root=extraTree(page,this.#binding,formPath),nodes=extraNodes(root),templates=nodes.filter(node=>extraAttr(node,'id')==='divSectorEditorTemplate'),holders=nodes.filter(node=>extraAttr(node,'id')==='divSectorEdit_'+id);
    if(templates.length!==1||holders.length!==1||!('childNodes'in templates[0])||!('tagName'in holders[0]))return extraFail();
    const holder=holders[0],fragment=parseFragment(holder,templates[0].childNodes.map(node=>serializeOuter(node)).join(''),{});holder.childNodes=fragment.childNodes;for(const node of holder.childNodes)node.parentNode=holder;
    for(const node of extraNodes(holder)){const name=extraAttr(node,'name');if((name==='updatesector'||name==='txtSectorName')&&'attrs'in node){const value=node.attrs.find(attr=>attr.name==='value');if(value)value.value=name==='updatesector'?String(id):before.body.sectors.find(row=>row.sector_id===id)!.sector_name!;else node.attrs.push({name:'value',value:name==='updatesector'?String(id):before.body.sectors.find(row=>row.sector_id===id)!.sector_name!});}}
    let parent=holder.parentNode;while(parent&&extraTag(parent)!=='form')parent='parentNode'in parent?parent.parentNode:null;if(!parent||!('tagName'in parent))return extraFail();page={...page,html:serializeOuter(parent)};
   }
   if(!rename){
    const nodes=extraNodes(extraTree(page,this.#binding,formPath)),templates=nodes.filter(node=>extraAttr(node,'id')==='divNewAnswersTemplateHolder'),holders=nodes.filter(node=>(extraAttr(node,'id')??'').endsWith('_divNewSectorAnswersHolder'));
    if(templates.length!==1||holders.length!==1||!('childNodes'in templates[0])||!('tagName'in holders[0]))return extraFail();
    const holder=holders[0],fragment=parseFragment(holder,templates[0].childNodes.map(node=>serializeOuter(node)).join(''),{});holder.childNodes=fragment.childNodes;for(const node of holder.childNodes)node.parentNode=holder;
    let parent=holder.parentNode;while(parent&&extraTag(parent)!=='form')parent='parentNode'in parent?parent.parentNode:null;if(!parent||!('tagName'in parent))return extraFail();page={...page,html:serializeOuter(parent)};
   }
   const form=extraForm(page,this.#binding,formPath,[marker,'txtSectorName'],name=>name==='btnSaveSector','/Administration/Games/LevelEditor.aspx',()=>false,base);
   const action=new URL(form.action,`https://${this.#binding.domain}`);if([...action.searchParams.keys()].sort().join(',')!=='gid,level'||action.searchParams.get('gid')!==String(this.#binding.gameId)||action.searchParams.get('level')!==String(before.level.level_number))return extraFail();
   if(extraValue(form,marker)!==(rename?String(id):'')||form.fields.some(field=>[marker,'txtSectorName'].includes(field.name)&&field.disabled))return extraFail();
   // Creation keeps only the observed empty, public answer slots. Recipient-specific
   // or populated template data requires an explicit model rather than inference.
   if(!rename&&form.fields.some(field=>!field.disabled&&((/^txtAnswer_/.test(field.name)&&field.values.some(value=>value!==''))||(/^ddlAnswerFor_/.test(field.name)&&field.values.some(value=>value!=='0')))))return extraFail();
   if(!rename){for(let slot=0;slot<10;slot++)if(extraValue(form,'txtAnswer_'+slot)!==''||extraValue(form,'ddlAnswerFor_'+slot)!=='0'||form.fields.some(field=>['txtAnswer_'+slot,'ddlAnswerFor_'+slot].includes(field.name)&&field.disabled))return extraFail();}
   const body=new URLSearchParams(form.controls);body.set('txtSectorName',desired!);initialAnswers.forEach((answer,slot)=>body.set('txtAnswer_'+slot,answer));recipe={kind:'sector-write',effect:'mutation',method:'POST',path:form.action,body:body.toString()};
  }
  if((await this.read(levelId,signal)).version!==before.version)return new Response(null,{status:409});
  try{await this.#dispatch(recipe,signal);}catch{/* The outcome is determined by readback; never replay the mutation. */}
  try{
   const after=await this.read(levelId,signal);if(after.level.level_number!==before.level.level_number)throw new Error();
   const expected=method==='DELETE'?before.body.sectors.filter(row=>row.sector_id!==id):method==='PUT'?before.body.sectors.map(row=>row.sector_id===id?{...row,sector_name:desired}:row):before.body.sectors;
   const created=method==='POST'?after.body.sectors.filter(row=>!before.body.sectors.some(old=>old.sector_id===row.sector_id)):[];
   if(method==='POST'&&(created.length!==1||created[0].sector_name!==desired))throw new Error();
   const actual=method==='POST'?after.body.sectors.filter(row=>!created.includes(row)):after.body.sectors;if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error();
   const expectedAnswers=method==='DELETE'?before.body.answers.filter(row=>row.sector_id!==id):before.body.answers;const added=created[0]?after.body.answers.filter(row=>row.sector_id===created[0].sector_id):[];if(JSON.stringify(added.map(row=>row.answer_text))!==JSON.stringify(initialAnswers)||added.some(row=>row.for_member_id!==0))throw new Error();if(JSON.stringify(after.body.answers.filter(row=>!added.includes(row)))!==JSON.stringify(expectedAnswers))throw new Error();
   for(const sector of before.forms){if(method==='DELETE'&&sector.id===id)continue;const current=after.forms.find(row=>row.id===sector.id);if(!current||!extraPreserved(sector.form,current.form,[]))throw new Error();}
   return Response.json({...await dto(after),...(created[0]?{created_sector_id:created[0].sector_id}:{})});
  }catch{throw new AuthoringApiError('unknown-after-dispatch');}
 }
}
