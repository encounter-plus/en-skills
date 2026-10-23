import {legacyRecipientFields,legacyRecipientKind,resolveLegacyRecipient,type LegacyRecipientOption,type LegacyRecipientKind} from './legacy-recipients.ts';
import {AuthoringApiError,sameAuthoringBinding,type AuthoringBinding} from './authoring-api.ts';
import {parseLegacyLevelIndex,type LegacySessionPort,type LegacyRecipe} from './legacy-authoring.ts';
import {extraTree,extraNodes,extraTag,extraAttr,extraForm,extraValue,extraRevision,extraPreserved,extraFail,type ExtraForm} from './legacy-extra-form.ts';
import {parseFragment,serializeOuter,type DefaultTreeAdapterMap} from 'parse5';
export interface LegacyAnswerLevel {level_id:number;level_number:number;level_name:string}
export interface LegacyAnswer {answer_id:number;answer_text:string;sector_id:number;for_member_id:number;for_user_id?:number;for_team_id?:number;recipient:{kind:'user'|'team'|'unknown';member_id:number;options:LegacyRecipientOption[]}}
export interface LegacyAnswerSectorRead {id:number;path:string;form:ExtraForm;answers:LegacyAnswer[]}
export interface LegacyAnswerSectorRef {id:number;form:DefaultTreeAdapterMap['element'];container:DefaultTreeAdapterMap['element'];name?:string;empty?:true}
const recipientOptions=(form:ExtraForm,name:string):LegacyRecipientOption[]=>{const fields=form.fields.filter(field=>field.name===name&&!field.disabled);if(fields.length!==1||!fields[0].options||!fields[0].options.length)return extraFail();const field=fields[0],options=field.options!.map((raw,index)=>{if(!/^(?:0|[1-9]\d*)$/.test(raw)||!Number.isSafeInteger(Number(raw)))return extraFail();return {member_id:Number(raw),label:field.optionLabels?.[index]??raw};});if(new Set(options.map(row=>row.member_id)).size!==options.length)return extraFail();return options;};
const positive=(raw:string|undefined)=>{if(!raw||!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<1)return extraFail();return Number(raw);};
/** Concrete object=3 codec; disabled/template controls cannot become active answers. */
export function parseLegacyAnswerSector(page:Parameters<typeof extraForm>[0],binding:AuthoringBinding,path:string,sectorId:number,mode:'update'|'delete'='update',kind:LegacyRecipientKind='unknown'):LegacyAnswerSectorRead {
 const form=extraForm(page,binding,path,['updateanswers'],name=>name===(mode==='delete'?'btnDelete':'ctl01_ctl00_btnUpdate'),'/Administration/Games/LevelEditor.aspx');
 if(extraValue(form,'updateanswers')!==String(sectorId))return extraFail();
 const answers:LegacyAnswer[]=[],seen=new Set<number>();
 for(const field of form.fields.filter(row=>!row.disabled&&/^txtAnswer_[1-9]\d*$/.test(row.name))){const id=positive(field.name.slice('txtAnswer_'.length));if(seen.has(id)||field.values.length!==1)return extraFail();seen.add(id);answers.push({answer_id:id,answer_text:field.values[0],sector_id:sectorId,...legacyRecipientFields(Number(extraValue(form,'ddlAnswerFor_'+id)),recipientOptions(form,'ddlAnswerFor_'+id),kind)});}
 if(form.fields.some(row=>/^chkDeleteAnswer_/.test(row.name)&&row.checked&&!row.disabled))return extraFail();
 return {id:sectorId,path:form.action,form,answers};
}
export class LegacyAnswers {
 readonly #session:LegacySessionPort;readonly #binding:AuthoringBinding;
 constructor(session:LegacySessionPort){this.#session=session;this.#binding={...session.binding};}
 async #dispatch(recipe:LegacyRecipe,signal?:AbortSignal){if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('session-changed');signal?.throwIfAborted();const page=await this.#session.dispatch(Object.freeze(recipe),signal);if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('session-changed');return page;}
 async #level(id:number,signal?:AbortSignal):Promise<LegacyAnswerLevel>{const path=`/Administration/Games/LevelManager.aspx?gid=${this.#binding.gameId}`,rows=parseLegacyLevelIndex(await this.#dispatch({kind:'level-index',effect:'read',method:'GET',path},signal),this.#binding),level=rows.find(row=>row.level_id===id);if(!level)return extraFail();return level;}
 async #sectors(level:LegacyAnswerLevel,signal?:AbortSignal){
  const path=`/ALoader/LevelInfo.aspx?gid=${this.#binding.gameId}&level=${level.level_number}&task=0&object=2`,page=await this.#dispatch({kind:'answer-list-read',effect:'read',method:'GET',path},signal),root=extraTree(page,this.#binding,path),refs:LegacyAnswerSectorRef[]=[],nodes=extraNodes(root);
  for(const node of nodes.filter(node=>/^divAnswersEdit_[1-9]\d*$/.test(extraAttr(node,'id')??''))){
   if(!('tagName'in node))return extraFail();const id=positive(extraAttr(node,'id')?.slice('divAnswersEdit_'.length));let parent:'parentNode' extends keyof typeof node?typeof node.parentNode:never=node.parentNode;
   while(parent&&extraTag(parent)!=='form')parent='parentNode'in parent?parent.parentNode:null;
   if(!parent||!('tagName'in parent)||(extraAttr(parent,'method')??'get').toLowerCase()!=='post')return extraFail();
   const action=new URL(extraAttr(parent,'action')??'',`https://${this.#binding.domain}`);if(action.origin!==`https://${this.#binding.domain}`||action.pathname!=='/Administration/Games/LevelEditor.aspx'||action.searchParams.get('gid')!==String(this.#binding.gameId)||action.searchParams.get('level')!==String(level.level_number))return extraFail();
   const manages=nodes.filter(row=>extraAttr(row,'id')==='divSectorManage_'+id);if(manages.length>1)return extraFail();const titles=manages.flatMap(extraNodes).filter(row=>extraTag(row)==='span'&&(extraAttr(row,'id')??'').endsWith('_lblSectorName'));
   if(titles.length>1)return extraFail();const name=titles.length===1?extraNodes(titles[0]).filter(row=>'value'in row).map(row=>'value'in row?row.value:'').join(''):undefined;
   refs.push({id,form:parent,container:node,...(name===undefined?{}:{name})});
  }
  for(const manage of nodes.filter(node=>/^divSectorManage_[1-9]\d*$/.test(extraAttr(node,'id')??''))){
   const id=positive(extraAttr(manage,'id')?.slice('divSectorManage_'.length));if(refs.some(ref=>ref.id===id))continue;
   const unique=(marker:string)=>{const found=nodes.filter(node=>extraAttr(node,'id')===marker);if(found.length!==1||!('tagName'in found[0]))return extraFail();return found[0];};
   const add=unique('divSectorsAnswersAdd_'+id),holder=unique('divSectorsAddAnswersRows_'+id);if(!extraNodes(add).includes(holder)||extraNodes(holder).some(node=>extraAttr(node,'name')!==undefined))return extraFail();
   const titles=extraNodes(manage).filter(node=>extraTag(node)==='span'&&(extraAttr(node,'id')??'').endsWith('_lblSectorName'));if(titles.length!==1)return extraFail();
   for(const action of ['renamesector','delsector']){const links=extraNodes(manage).filter(node=>{const raw=extraAttr(node,'href');if(!raw)return false;const u=new URL(raw,`https://${this.#binding.domain}`);return u.origin===`https://${this.#binding.domain}`&&u.pathname==='/Administration/Games/LevelEditor.aspx'&&[...u.searchParams.keys()].sort().join(',')===['gid','level','swanswers',action].sort().join(',')&&u.searchParams.get('gid')===String(this.#binding.gameId)&&u.searchParams.get('level')===String(level.level_number)&&u.searchParams.get('swanswers')==='1'&&u.searchParams.get(action)===String(id);});if(links.length!==1)return extraFail();}
   let form=holder.parentNode;while(form&&extraTag(form)!=='form')form='parentNode'in form?form.parentNode:null;if(!form||!('tagName'in form))return extraFail();
   const parsed=extraForm({...page,html:serializeOuter(form)},this.#binding,path,['ddlSector','saveanswers'],name=>/^ctl01_SectorsRepeater_ctl\d+_pnlNewAnswers_btnSave$/.test(name),'/Administration/Games/LevelEditor.aspx');
   const u=new URL(parsed.action,`https://${this.#binding.domain}`);if(u.searchParams.get('gid')!==String(this.#binding.gameId)||u.searchParams.get('level')!==String(level.level_number)||extraValue(parsed,'ddlSector')!==String(id)||extraValue(parsed,'saveanswers')!=='1'||parsed.fields.some(field=>/^txtAnswer_|^ddlAnswerFor_|^chkDeleteAnswer_/.test(field.name)))return extraFail();
   const name=extraNodes(titles[0]).filter(node=>'value'in node).map(node=>'value'in node?node.value:'').join('');refs.push({id,form,container:holder,name,empty:true});
  }
  refs.sort((a,b)=>a.id-b.id);
  if(refs.length>500||new Set(refs.map(ref=>ref.id)).size!==refs.length)return extraFail();
  // Unknown list markup must not be converted into an allegedly empty editor.
  if(!refs.length&&(!nodes.some(node=>extraAttr(node,'id')==='divSectorEditorTemplate')||nodes.some(node=>/^txtAnswer_|^chkDeleteAnswer_/.test(extraAttr(node,'name')??''))))return extraFail();
  return refs;
 }
 async #sector(level:LegacyAnswerLevel,ref:LegacyAnswerSectorRef,mode:'update'|'delete',signal?:AbortSignal,kind:LegacyRecipientKind='unknown'){
  const path=`/ALoader/LevelInfo.aspx?object=3&gid=${this.#binding.gameId}&level=${level.level_number}&sector=${ref.id}`,page=await this.#dispatch({kind:'answer-edit-read',effect:'read',method:'GET',path},signal),fragment=extraTree(page,this.#binding,path);
  if(extraNodes(fragment).some(node=>extraTag(node)==='form'))return extraFail();
  const content=parseFragment(ref.container,page.html,{});ref.container.childNodes=content.childNodes;for(const node of ref.container.childNodes)node.parentNode=ref.container;
  return parseLegacyAnswerSector({...page,html:serializeOuter(ref.form)},this.#binding,path,ref.id,mode,kind);
 }
 async #creation(level:LegacyAnswerLevel,signal?:AbortSignal){
  const path=`/Administration/Games/LevelEditor.aspx?gid=${this.#binding.gameId}&level=${level.level_number}`,page=await this.#dispatch({kind:'level-editor-read',effect:'read',method:'GET',path},signal),root=extraTree(page,this.#binding,path),nodes=extraNodes(root);
  const one=(id:string)=>{const matches=nodes.filter(node=>extraAttr(node,'id')===id);if(matches.length!==1||!('tagName'in matches[0]))return extraFail();return matches[0];};
  const holder=one('AnswersTable_ctl00_divCreateAnswers'),target=one('AnswersTable_ctl00_NewAnswerEditor'),template=one('divNewAnswersTemplateHolder');
  let owner=holder.parentNode;while(owner&&extraTag(owner)!=='form')owner='parentNode'in owner?owner.parentNode:null;
  if(!owner||!('tagName'in owner)||!extraNodes(holder).includes(target)||extraNodes(template).some(node=>extraTag(node)==='form')||extraNodes(target).some(node=>/^txtAnswer_\d+$/.test(extraAttr(node,'name')??'')))return extraFail();
  // The observed EnsureAddAnswersBlock clones this exact inert template into this target.
  if(template.parentNode&&'childNodes'in template.parentNode)template.parentNode.childNodes=template.parentNode.childNodes.filter(node=>node!==template);
  target.childNodes.push(template);template.parentNode=target;
  const form=extraForm({...page,html:serializeOuter(owner)},this.#binding,path,['saveanswers','ddlSector'],name=>name==='AnswersTable_ctl00_NewAnswerEditor_ctl00_btnSave','/Administration/Games/LevelEditor.aspx');
  if(extraValue(form,'saveanswers')!=='1')return extraFail();
  for(let slot=0;slot<10;slot++)if(extraValue(form,'txtAnswer_'+slot)!==''||extraValue(form,'ddlAnswerFor_'+slot)!=='0')return extraFail();
  return form;
 }
 async #recipientKind(signal?:AbortSignal):Promise<LegacyRecipientKind>{try{const path=`/GameDetails.aspx?gid=${this.#binding.gameId}`;return legacyRecipientKind(await this.#dispatch({kind:'game-read',effect:'read',method:'GET',path},signal),this.#binding);}catch(error){if(signal?.aborted||error instanceof AuthoringApiError&&error.code==='session-changed')throw error;return 'unknown';}}
 async read(levelId:number,signal?:AbortSignal,preserveTarget?:number,includeCreation=false,deleteTarget=false,deleteSector?:number){
  const kind=await this.#recipientKind(signal);
  const level=await this.#level(levelId,signal),refs=await this.#sectors(level,signal),forms:LegacyAnswerSectorRead[]=[],answers:LegacyAnswer[]=[];
  for(const ref of refs){if(ref.empty)continue;const sector=await this.#sector(level,ref,'update',signal,kind);forms.push(sector);answers.push(...sector.answers);}
  if(new Set(answers.map(row=>row.answer_id)).size!==answers.length)return extraFail();
  const projection:ExtraForm={action:'',submitter:'',controls:[],fields:forms.flatMap(form=>form.form.fields.filter(field=>!['__VIEWSTATE','__VIEWSTATEGENERATOR','__EVENTVALIDATION'].includes(field.name)).map(field=>({...field,name:`sector:${form.id}:${field.name}`})))};
  const ignored=preserveTarget===undefined?[]:['txtAnswer_'+preserveTarget,'ddlAnswerFor_'+preserveTarget,'chkDeleteAnswer_'+preserveTarget];
  const candidateId=deleteSector??forms.find(row=>row.answers.some(answer=>answer.answer_id===preserveTarget))?.id,candidate=forms.find(row=>row.id===candidateId);
  const deletedOwner=deleteTarget&&candidateId!==undefined&&(!candidate||candidate.answers.length===1&&candidate.answers[0].answer_id===preserveTarget)?candidateId:undefined;
  const preservation={...projection,fields:projection.fields.filter(field=>deletedOwner===undefined?!ignored.some(name=>field.name.endsWith(':'+name)):!field.name.startsWith('sector:'+deletedOwner+':'))};
  const inventoryPreservation={...projection,fields:projection.fields.filter(field=>!/^sector:\d+:(?:txtAnswer_|ddlAnswerFor_|chkDeleteAnswer_)\d+$/.test(field.name))};
  const creation=includeCreation?await this.#creation(level,signal):undefined,creationFields=creation?{...creation,fields:creation.fields.filter(field=>!/^txtAnswer_\d$|^ddlAnswerFor_\d$|^ddlSector$/.test(field.name))}:undefined;
  const formProofs=await Promise.all(forms.map(async row=>({sector_id:row.id,preservation_version:await extraRevision(this.#binding,`answer-form-${row.id}`,{...row.form,fields:row.form.fields.filter(field=>!/^txtAnswer_|^ddlAnswerFor_|^chkDeleteAnswer_/.test(field.name))})})));
  const versionProjection={...projection,fields:[...projection.fields,...refs.map(ref=>({name:'sector:'+ref.id,values:[ref.name??''],type:'sector',disabled:false,checked:false}))]};
  return {level,forms,refs,creation,kind,body:{game_id:this.#binding.gameId,level_id:levelId,answers,...(creation?{recipient_options:recipientOptions(creation,'ddlAnswerFor_0')}:{}),answer_form_proofs:formProofs,inventory_preservation_version:await extraRevision(this.#binding,`answer-inventory-${levelId}`,inventoryPreservation),sectors:refs.map(ref=>({sector_id:ref.id,...(ref.name===undefined?{}:{sector_name:ref.name})})),version:await extraRevision(this.#binding,`answers-${levelId}`,versionProjection),preservation_version:await extraRevision(this.#binding,`answer-siblings-${levelId}-${preserveTarget??'all'}`,preservation),...(creationFields?{creation_preservation_version:await extraRevision(this.#binding,`answer-creation-${levelId}`,creationFields)}:{})}};
 }
 async request(path:string,init:RequestInit={}):Promise<Response|undefined>{
  const match=path.match(new RegExp(`^/admin/games/${this.#binding.gameId}/levels/([1-9]\\d*)/answers(?:/([1-9]\\d*))?$`));if(!match)return undefined;const method=(init.method??'GET').toUpperCase();if(method!=='GET'&&!['POST','PUT','DELETE'].includes(method))throw new AuthoringApiError('unsupported');
  const rawTarget=new Headers(init.headers).get('X-Authoring-Preserve-Answer'),preserveTarget=match[2]?Number(match[2]):rawTarget?positive(rawTarget):undefined;
  const deleting=method==='DELETE'||new Headers(init.headers).get('X-Authoring-Delete-Answer')==='1',rawSector=new Headers(init.headers).get('X-Authoring-Answer-Sector'),deleteSector=rawSector?positive(rawSector):undefined;
  const levelId=Number(match[1]),create=method==='POST'&&!match[2],includeCreation=create||new Headers(init.headers).get('X-Authoring-Answer-Create')==='1',before=await this.read(levelId,init.signal??undefined,preserveTarget,includeCreation,deleting,deleteSector);if(method==='GET'){if(match[2]){const row=before.body.answers.find(row=>row.answer_id===Number(match[2]));if(!row)return extraFail();return Response.json({...row,version:before.body.version,preservation_version:before.body.preservation_version});}return Response.json(before.body);}
  if(create){
   if(new Headers(init.headers).get('If-Match')!==before.body.version)return new Response(null,{status:409});
   let patch:any;try{patch=JSON.parse(String(init.body));}catch{throw new AuthoringApiError('unsupported');}
   if(!patch||Object.keys(patch).some(key=>!['answer_text','sector_id','for_member_id','for_user_id','for_team_id'].includes(key))||typeof patch.answer_text!=='string'||!patch.answer_text||patch.answer_text.length>100000||!Number.isSafeInteger(patch.sector_id)||!before.refs.some(ref=>ref.id===patch.sector_id))throw new AuthoringApiError('unsupported');
   const form=before.creation!,member=resolveLegacyRecipient(patch,recipientOptions(form,'ddlAnswerFor_0'),0,before.kind);const sector=form.fields.filter(field=>field.name==='ddlSector');if(sector.length!==1||!sector[0].options?.includes(String(patch.sector_id)))return extraFail();
   const fresh=await this.read(levelId,init.signal??undefined,undefined,true);if(fresh.body.version!==before.body.version||fresh.body.creation_preservation_version!==before.body.creation_preservation_version)return new Response(null,{status:409});
   const controls=new URLSearchParams(fresh.creation!.controls);controls.set('txtAnswer_0',patch.answer_text);controls.set('ddlAnswerFor_0',String(member));controls.set('ddlSector',String(patch.sector_id));
   try{await this.#dispatch({kind:'answer-create',effect:'mutation',method:'POST',path:fresh.creation!.action,body:controls.toString()},init.signal??undefined);}catch{/* Reconcile without repeating the write. */}
   try{const after=await this.read(levelId,init.signal??undefined,undefined,true),oldIds=new Set(before.body.answers.map(row=>row.answer_id)),created=after.body.answers.filter(row=>!oldIds.has(row.answer_id));
    if(after.level.level_number!==before.level.level_number||after.body.creation_preservation_version!==before.body.creation_preservation_version||!before.body.answer_form_proofs.every(proof=>after.body.answer_form_proofs.some(row=>row.sector_id===proof.sector_id&&row.preservation_version===proof.preservation_version))||created.length!==1||created[0].answer_text!==patch.answer_text||created[0].sector_id!==patch.sector_id||created[0].for_member_id!==member||JSON.stringify(after.body.answers.filter(row=>oldIds.has(row.answer_id)))!==JSON.stringify(before.body.answers)||JSON.stringify(after.body.sectors)!==JSON.stringify(before.body.sectors))throw new Error();
    for(const old of before.forms){const current=after.forms.find(row=>row.id===old.id);if(!current||!extraPreserved(old.form,current.form,created[0].sector_id===old.id?['txtAnswer_'+created[0].answer_id,'ddlAnswerFor_'+created[0].answer_id,'chkDeleteAnswer_'+created[0].answer_id]:[]))throw new Error();}
    return Response.json({...after.body,created_answer_id:created[0].answer_id});
   }catch{throw new AuthoringApiError('unknown-after-dispatch');}
  }
  if(!match[2])throw new AuthoringApiError('unsupported');const expected=new Headers(init.headers).get('If-Match');if(!expected||expected!==before.body.version)return new Response(null,{status:409});
  const id=Number(match[2]),owner=before.forms.find(form=>form.answers.some(row=>row.answer_id===id));if(!owner)return extraFail();let desired:string|undefined,member=owner.answers.find(row=>row.answer_id===id)!.for_member_id;
  if(method==='PUT'){let patch:any;try{patch=JSON.parse(String(init.body));}catch{throw new AuthoringApiError('unsupported');}if(!patch||typeof patch!=='object'||Object.keys(patch).some(key=>!['answer_text','for_member_id','for_user_id','for_team_id'].includes(key))||patch.answer_text!==undefined&&(typeof patch.answer_text!=='string'||patch.answer_text.length>100000)||!Object.keys(patch).length)throw new AuthoringApiError('unsupported');desired=patch.answer_text??owner.answers.find(row=>row.answer_id===id)!.answer_text;member=resolveLegacyRecipient(patch,recipientOptions(owner.form,'ddlAnswerFor_'+id),member,before.kind);}
  else if(init.body!==undefined&&init.body!==null)throw new AuthoringApiError('unsupported');
  const form=method==='DELETE'?(await this.#sector(before.level,before.refs.find(ref=>ref.id===owner.id)!,'delete',init.signal??undefined)).form:owner.form;
  const afterFormRead=await this.read(levelId,init.signal??undefined);if(afterFormRead.body.version!==before.body.version)return new Response(null,{status:409});
  const controls=new URLSearchParams(form.controls);if(method==='PUT'){controls.set('txtAnswer_'+id,desired!);controls.set('ddlAnswerFor_'+id,String(member));}else {const checkbox=form.fields.filter(row=>row.name==='chkDeleteAnswer_'+id&&!row.disabled);if(checkbox.length!==1||checkbox[0].values.length!==1||checkbox[0].values[0]!==String(id))return extraFail();controls.append('chkDeleteAnswer_'+id,checkbox[0].values[0]);}
  const action=new URL(form.action,`https://${this.#binding.domain}`);if(action.searchParams.get('gid')!==String(this.#binding.gameId)||action.searchParams.get('level')!==String(before.level.level_number))return extraFail();
  try{await this.#dispatch({kind:'answer-write',effect:'mutation',method:'POST',path:form.action,body:controls.toString()},init.signal??undefined);}catch{/* Read back without repeating the POST. */}
  try{
   const after=await this.read(levelId,init.signal??undefined,preserveTarget,false,deleting,method==='DELETE'?owner.id:undefined);if(after.level.level_number!==before.level.level_number||after.body.preservation_version!==before.body.preservation_version)throw new Error();
   const expectedAnswers=method==='DELETE'?before.body.answers.filter(row=>row.answer_id!==id):before.body.answers.map(row=>row.answer_id===id?{answer_id:row.answer_id,answer_text:desired!,sector_id:row.sector_id,...legacyRecipientFields(member,row.recipient.options,before.kind)}:row);if(JSON.stringify(after.body.answers)!==JSON.stringify(expectedAnswers)||JSON.stringify(after.body.sectors)!==JSON.stringify(before.body.sectors))throw new Error();
   for(const sector of before.forms){const actual=after.forms.find(row=>row.id===sector.id);if(!actual&&method==='DELETE'&&sector.id===owner.id&&sector.answers.length===1&&after.refs.some(ref=>ref.id===sector.id&&ref.empty))continue;if(!actual||!extraPreserved(sector.form,actual.form,sector.id===owner.id?method==='PUT'?['txtAnswer_'+id,'ddlAnswerFor_'+id]:['txtAnswer_'+id,'ddlAnswerFor_'+id,'chkDeleteAnswer_'+id]:[]))throw new Error();}
   return Response.json(after.body);
  }catch{throw new AuthoringApiError('unknown-after-dispatch');}
 }
}
