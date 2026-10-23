import {AuthoringApiError,sameAuthoringBinding,type AuthoringBinding} from './authoring-api.ts';
import {parseLegacyLevelIndex,type LegacySessionPort,type LegacyRecipe} from './legacy-authoring.ts';
import {extraForm,extraValue,extraRadio,extraChecked,extraNumber,extraRevision,extraPreserved,extraTree,extraNodes,extraAttr,extraTag,extraFail,type ExtraForm} from './legacy-extra-form.ts';
type Level={level_id:number;level_number:number;level_name:string};
const integer=(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)return extraFail();return value;};
const copyBody=(form:ExtraForm)=>new URLSearchParams(form.controls);
const expectedVersion=(init:RequestInit,version:string)=>{const expected=new Headers(init.headers).get('If-Match');return !expected?Response.json({error:'legacy-observed-revision-required'},{status:428}):expected!==version?Response.json({error:'conflict'},{status:409}):null;};
function patchObject(init:RequestInit){if(typeof init.body!=='string')throw new AuthoringApiError('unsupported');let value:unknown;try{value=JSON.parse(init.body);}catch{return extraFail();}if(!value||typeof value!=='object'||Array.isArray(value))return extraFail();return value as Record<string,unknown>;}
function only(value:Record<string,unknown>,names:string[]){if(!Object.keys(value).length||Object.keys(value).some(name=>!names.includes(name)))throw new AuthoringApiError('unsupported');}
const string=(value:unknown,max=100000)=>{if(typeof value!=='string'||value.length>max)return extraFail();return value;};
const crlf=(value:string)=>value.replace(/\r\n|\r|\n/g,'\r\n');
const leaf=(value:string)=>value.replace(/\r\n|\r/g,'\n');
type Section='meta'|'autopass'|'blocking'|'sectors';
interface ReadSection {version:string;fields:Record<string,unknown>;form:ExtraForm;level:Level;path:string;kind:Section}
const sectionRequired:Record<Section,string[]>={meta:['txtLevelName','txtLevelComment'],autopass:['txtApHours','txtApMinutes','txtApSeconds','chkTimeoutPenalty','txtApPenaltyHours','txtApPenaltyMinutes','txtApPenaltySeconds'],blocking:['txtAttemptsNumber','txtAttemptsPeriodHours','txtAttemptsPeriodMinutes','txtAttemptsPeriodSeconds','rbApplyForPlayer'],sectors:['rbSectorCompleteType','txtRequiredSectorsCount']};
const sectionSubmit:Record<Section,(name:string)=>boolean>={meta:name=>name==='btnUpdate',autopass:name=>/^ctl\d+_ctl\d+_ctl\d+$/.test(name),blocking:name=>name==='pnlSettings_AnswerBlockingSettings_ctl00_ctl08',sectors:name=>name==='pnlSettings_SectorsCompletionSettings_ctl00_btnSave'};
function sectionFields(kind:Section,form:ExtraForm):Record<string,unknown>{
 if(kind==='meta')return {level_name:extraValue(form,'txtLevelName'),comment:extraValue(form,'txtLevelComment')};
 if(kind==='autopass')return {timeout_hours:extraNumber(form,'txtApHours',999999),timeout_minutes:extraNumber(form,'txtApMinutes',59),timeout_seconds:extraNumber(form,'txtApSeconds',59),penalty_enabled:extraChecked(form,'chkTimeoutPenalty'),penalty_hours:extraNumber(form,'txtApPenaltyHours',999999),penalty_minutes:extraNumber(form,'txtApPenaltyMinutes',59),penalty_seconds:extraNumber(form,'txtApPenaltySeconds',59)};
 if(kind==='blocking'){const mode=extraRadio(form,'rbApplyForPlayer');if(!['1','2'].includes(mode))return extraFail();return {attempts_number:extraNumber(form,'txtAttemptsNumber',999999),attempts_period_hours:extraNumber(form,'txtAttemptsPeriodHours',999999),attempts_period_minutes:extraNumber(form,'txtAttemptsPeriodMinutes',59),attempts_period_seconds:extraNumber(form,'txtAttemptsPeriodSeconds',59),block_type_id:Number(mode)};}
 const mode=extraRadio(form,'rbSectorCompleteType');if(!['1','2'].includes(mode))return extraFail();return {all_sectors:mode==='1',required_sectors_count:mode==='1'?null:extraNumber(form,'txtRequiredSectorsCount',999999)};
}
function sectionPatch(read:ReadSection,patch:Record<string,unknown>){
 const {kind,form}=read,fields={...read.fields},body=copyBody(form),changed:string[]=[];
 const set=(name:string,value:string)=>{body.set(name,value);changed.push(name);};
 const number=(api:string,control:string,max=Number.MAX_SAFE_INTEGER)=>{if(Object.hasOwn(patch,api)){const value=integer(patch[api],0,max);fields[api]=value;set(control,String(value));}};
 if(kind==='meta') {only(patch,['level_name','comment']);if(Object.hasOwn(patch,'level_name')){fields.level_name=string(patch.level_name,2000);set('txtLevelName',fields.level_name as string);}if(Object.hasOwn(patch,'comment')){fields.comment=leaf(string(patch.comment));set('txtLevelComment',crlf(fields.comment as string));}}
 if(kind==='autopass'){
  only(patch,['timeout_hours','timeout_minutes','timeout_seconds','penalty_enabled','penalty_hours','penalty_minutes','penalty_seconds']);
  for(const [api,control,max]of [['timeout_hours','txtApHours',999999],['timeout_minutes','txtApMinutes',59],['timeout_seconds','txtApSeconds',59],['penalty_hours','txtApPenaltyHours',999999],['penalty_minutes','txtApPenaltyMinutes',59],['penalty_seconds','txtApPenaltySeconds',59]]as const)number(api,control,max);
  if(Object.hasOwn(patch,'penalty_enabled')){if(typeof patch.penalty_enabled!=='boolean')return extraFail();fields.penalty_enabled=patch.penalty_enabled;changed.push('chkTimeoutPenalty');if(patch.penalty_enabled){const checkbox=form.fields.find(row=>row.name==='chkTimeoutPenalty')!;body.set('chkTimeoutPenalty',checkbox.values[0]);}else body.delete('chkTimeoutPenalty');}
  if(fields.penalty_enabled){for(const [api,control]of [['penalty_hours','txtApPenaltyHours'],['penalty_minutes','txtApPenaltyMinutes'],['penalty_seconds','txtApPenaltySeconds']]as const){body.set(control,String(fields[api]));changed.push(control);}}
  else for(const [api,control]of [['penalty_hours','txtApPenaltyHours'],['penalty_minutes','txtApPenaltyMinutes'],['penalty_seconds','txtApPenaltySeconds']]as const){
   // The native server clears disabled penalty duration; omitted inputs do not retain it.
   if(Object.hasOwn(patch,api)&&patch[api]!==0)throw new AuthoringApiError('unsupported');
   fields[api]=0;body.delete(control);changed.push(control);
  }
 }
 if(kind==='blocking'){
  only(patch,['attempts_number','attempts_period_hours','attempts_period_minutes','attempts_period_seconds','block_type_id']);for(const [api,control,max]of [['attempts_number','txtAttemptsNumber',999999],['attempts_period_hours','txtAttemptsPeriodHours',999999],['attempts_period_minutes','txtAttemptsPeriodMinutes',59],['attempts_period_seconds','txtAttemptsPeriodSeconds',59]]as const)number(api,control,max);
  if(Object.hasOwn(patch,'block_type_id')){fields.block_type_id=integer(patch.block_type_id,1,2);set('rbApplyForPlayer',String(fields.block_type_id));}
 }
 if(kind==='sectors'){
  only(patch,['all_sectors','required_sectors_count']);if(Object.hasOwn(patch,'all_sectors')){if(typeof patch.all_sectors!=='boolean')return extraFail();fields.all_sectors=patch.all_sectors;}
  if(Object.hasOwn(patch,'required_sectors_count')){fields.required_sectors_count=integer(patch.required_sectors_count,1,999999);if(!Object.hasOwn(patch,'all_sectors'))fields.all_sectors=false;}
  if(fields.all_sectors){fields.required_sectors_count=null;set('rbSectorCompleteType','1');body.delete('txtRequiredSectorsCount');changed.push('txtRequiredSectorsCount');}
  else {integer(fields.required_sectors_count,1,999999);set('rbSectorCompleteType','2');set('txtRequiredSectorsCount',String(fields.required_sectors_count));}
 }
 return {fields,body,changed};
}
interface Message {message_id:number;message_text:string;all_levels:boolean;level_ids:number[];replace_nl_to_br:boolean;_authoring_revision:string;_authoring_preservation:string}
interface MessageRead {dto:Message;form:ExtraForm;path:string}

export class LegacyLevelExtras {
 readonly #session:LegacySessionPort;readonly #binding:AuthoringBinding;constructor(session:LegacySessionPort){this.#session=session;this.#binding={...session.binding};}
 async #dispatch(recipe:LegacyRecipe,signal?:AbortSignal){if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('session-changed');signal?.throwIfAborted();const page=await this.#session.dispatch(Object.freeze(recipe),signal);if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('session-changed');return page;}
 async #levels(signal?:AbortSignal){const path=`/Administration/Games/LevelManager.aspx?gid=${this.#binding.gameId}`;return parseLegacyLevelIndex(await this.#dispatch({kind:'level-index',effect:'read',method:'GET',path},signal),this.#binding);}
 async #level(id:number,signal?:AbortSignal){const level=(await this.#levels(signal)).find(row=>row.level_id===id);if(!level)return extraFail();return level;}
 async #section(level:Level,kind:Section,signal?:AbortSignal):Promise<ReadSection>{
  const game=this.#binding.gameId,ordinal=level.level_number;
  const path=kind==='meta'?`/Administration/Games/NameCommentEdit.aspx?gid=${game}&level=${ordinal}`:kind==='autopass'?`/ALoader/LevelInfo.aspx?gid=${game}&level=${ordinal}&object=4`:`/Administration/Games/LevelEditor.aspx?gid=${game}&level=${ordinal}`;
  const page=await this.#dispatch({kind:'level-extra-read',effect:'read',method:'GET',path},signal),target=kind==='meta'?'/Administration/Games/NameCommentEdit.aspx':'/Administration/Games/LevelEditor.aspx';
  if(kind==='sectors'){
   const nodes=extraNodes(extraTree(page,this.#binding,path));
   const hasEditor=nodes.some(node=>extraAttr(node,'id')==='AnswersTable_ctl00_lnkAnswersToggle');
   if(hasEditor&&!nodes.some(node=>sectionRequired.sectors.includes(extraAttr(node,'name')??'')))throw Object.assign(new AuthoringApiError('incomplete-read'),{details:{section:'sectors',reason:'native-form-not-rendered',retryWithoutStateChange:false,fieldsObserved:false}});
  }
  const form=extraForm(page,this.#binding,path,sectionRequired[kind],sectionSubmit[kind],target,()=>false,kind==='autopass'?`/Administration/Games/LevelEditor.aspx?gid=${game}&level=${ordinal}`:path);
  const action=new URL(form.action,`https://${this.#binding.domain}`);if(action.searchParams.get('gid')!==String(game)||action.searchParams.get('level')!==String(ordinal))return extraFail();
  if(kind==='autopass'&&!form.controls.some(([name])=>name==='updateautopass'))return extraFail();if(kind==='blocking'&&!form.controls.some(([name,value])=>name==='action'&&value==='upansblock'))return extraFail();if(kind==='sectors'&&!form.controls.some(([name,value])=>name==='action'&&value==='upsecsett'))return extraFail();
  return {kind,form,fields:sectionFields(kind,form),version:await extraRevision(this.#binding,'level-'+level.level_id+'-'+kind,form),level,path};
 }
 async #messageLinks(level:Level,signal?:AbortSignal){
  const path=`/Administration/Games/LevelEditor.aspx?gid=${this.#binding.gameId}&level=${level.level_number}`,root=extraTree(await this.#dispatch({kind:'level-editor-read',effect:'read',method:'GET',path},signal),this.#binding,path),ids=new Map<number,{deletePath?:string}>();
  for(const node of extraNodes(root).filter(n=>extraTag(n)==='a')){const href=extraAttr(node,'href')??'',candidates=href.startsWith('javascript:')?[...href.matchAll(/['"]([^'"]*MessageEdit\.aspx[^'"]*)['"]/g)].map(match=>match[1]):[href];
   for(const value of candidates){let url:URL;try{url=new URL(value,`https://${this.#binding.domain}/Administration/Games/`);}catch{continue;}if(url.pathname!=='/Administration/Games/MessageEdit.aspx')continue;if(url.origin!==`https://${this.#binding.domain}`||url.searchParams.get('gid')!==String(this.#binding.gameId)||url.searchParams.get('level')!==String(level.level_id))return extraFail();const raw=url.searchParams.get('mid');if(!raw)continue;if(!/^[1-9]\d*$/.test(raw))return extraFail();const id=integer(Number(raw),1),entry=ids.get(id)??{};if(url.searchParams.get('action')==='delete')entry.deletePath=url.pathname+url.search;ids.set(id,entry);}
  }return ids;
 }
 #message(form:ExtraForm,id:number,version:string,preserved:string,levels:Level[]):Message {
  const mode=extraRadio(form,'rbShowOnLevels');if(!['1','2'].includes(mode))return extraFail();
  const targets=form.fields.filter(row=>/^lvl_[1-9]\d*$/.test(row.name)&&row.checked&&!row.disabled).map(row=>Number(row.name.slice(4)));
  if(targets.some(id=>!levels.some(level=>level.level_id===id))||new Set(targets).size!==targets.length)return extraFail();
  if(mode==='2'&&!targets.length)return extraFail();
  return {message_id:id,message_text:extraValue(form,'txtMessage'),all_levels:mode==='1',level_ids:mode==='1'?levels.map(row=>row.level_id):targets,replace_nl_to_br:extraChecked(form,'chkReplaceNlToBr'),_authoring_revision:version,_authoring_preservation:preserved};
 }
 async #messageForm(level:Level,id:number|undefined,signal?:AbortSignal):Promise<MessageRead>{const path=`/Administration/Games/MessageEdit.aspx?gid=${this.#binding.gameId}&level=${level.level_id}&action=${id===undefined?'add':'edit&mid='+id}`,page=await this.#dispatch({kind:'message-form',effect:'read',method:'GET',path},signal),form=extraForm(page,this.#binding,path,['txtMessage','rbShowOnLevels','chkReplaceNlToBr'],name=>name===(id===undefined?'btnSave':'btnUpdate'),'/Administration/Games/MessageEdit.aspx',name=>/^lvl_[1-9]\d*$/.test(name));
  const action=new URL(form.action,`https://${this.#binding.domain}`);if(action.searchParams.get('gid')!==String(this.#binding.gameId)||action.searchParams.get('level')!==String(level.level_id)||extraValue(form,'action')!==(id===undefined?'save':'update'))return extraFail();
  const revision=await extraRevision(this.#binding,'message-'+(id??'new')+'-'+level.level_id,form),preserved=await extraRevision(this.#binding,'message-siblings-'+level.level_id,{...form,fields:form.fields.filter(row=>!['txtMessage','rbShowOnLevels','chkReplaceNlToBr','action','gid','level','mid'].includes(row.name)&&!/^lvl_/.test(row.name)&&!['submit','image','button','reset'].includes(row.type))});return {dto:this.#message(form,id??0,revision,preserved,await this.#levels(signal)),form,path:form.action};
 }
 async messages(levelId:number,signal?:AbortSignal){const level=await this.#level(levelId,signal),links=await this.#messageLinks(level,signal),messages:Message[]=[];for(const id of links.keys())messages.push((await this.#messageForm(level,id,signal)).dto);const summary:ExtraForm={controls:[],fields:messages.map(row=>({name:String(row.message_id),values:[JSON.stringify(row)],type:'message',disabled:false,checked:false})),submitter:'',action:''};return {game_id:this.#binding.gameId,level_id:levelId,messages,version:await extraRevision(this.#binding,'messages-'+levelId,summary)};}
 async read(levelId:number,signal?:AbortSignal){
  const level=await this.#level(levelId,signal),meta=await this.#section(level,'meta',signal),blocking=await this.#section(level,'blocking',signal),sectors=await this.#section(level,'sectors',signal),autopass=await this.#section(level,'autopass',signal),messages=await this.messages(levelId,signal);
  return {level:{...level,...meta.fields},messages:messages.messages,...blocking.fields,...sectors.fields,...autopass.fields,legacy_extra_revisions:{meta:meta.version,blocking:blocking.version,sectors:sectors.version,autopass:autopass.version,messages:messages.version}};
 }
 async request(path:string,init:RequestInit={}):Promise<Response|undefined>{
  const url=new URL(path,`https://${this.#binding.domain}`),base=`/admin/games/${this.#binding.gameId}/levels/`,match=url.pathname.match(new RegExp('^'+base+'([1-9]\\d*)/(meta|settings|autopass|messages)(?:/([1-9]\\d*))?$'));if(!match)return;const method=(init.method??'GET').toUpperCase(),level=await this.#level(Number(match[1]),init.signal??undefined);
  if(match[2]!=='messages'){
   if(match[3]||!['GET','PUT'].includes(method))throw new AuthoringApiError('unsupported');const kind=(match[2]==='settings'?(url.searchParams.get('section')??(method==='PUT'?patchObject(init).section:undefined)):match[2])as Section;if(!['meta','autopass','blocking','sectors'].includes(kind)||[...url.searchParams.keys()].some(k=>k!=='section'))throw new AuthoringApiError('unsupported');const before=await this.#section(level,kind,init.signal??undefined);
   const response=async(value:ReadSection)=>Response.json({game_id:this.#binding.gameId,level_id:level.level_id,version:value.version,fields:value.fields,preservation_version:await extraRevision(this.#binding,'section-siblings-'+level.level_id+'-'+kind,{...value.form,fields:value.form.fields.filter(row=>!sectionRequired[kind].includes(row.name)&&!['submit','image','button','reset'].includes(row.type))})});if(method==='GET')return response(before);const rejected=expectedVersion(init,before.version);if(rejected)return rejected;const patch=patchObject(init);if(patch.section!==undefined){if(patch.section!==kind)throw new AuthoringApiError('unsupported');delete patch.section;}const next=sectionPatch(before,patch);
   if((await this.#level(level.level_id,init.signal??undefined)).level_number!==level.level_number)return new Response(null,{status:409});
   try{await this.#dispatch({kind:'level-extra-update',effect:'mutation',method:'POST',path:before.form.action,body:next.body.toString()},init.signal??undefined);}catch{/* Read back without a second mutation. */}
   let after:ReadSection;try{const afterLevel=await this.#level(level.level_id,init.signal??undefined);if(afterLevel.level_number!==level.level_number)throw new Error('Level order changed');after=await this.#section(afterLevel,kind,init.signal??undefined);}catch{throw new AuthoringApiError('unknown-after-dispatch');}
   if(JSON.stringify(after.fields)!==JSON.stringify(next.fields)||!extraPreserved(before.form,after.form,next.changed))throw new AuthoringApiError('unknown-after-dispatch');return response(after);
  }
  if(url.search)throw new AuthoringApiError('unsupported');const id=match[3]?Number(match[3]):undefined,before=await this.messages(level.level_id,init.signal??undefined);if(method==='GET')return Response.json(id===undefined?before:before.messages.find(row=>row.message_id===id)??{});if(!['POST','PUT','DELETE'].includes(method)||method==='POST'&&id!==undefined||method!=='POST'&&id===undefined)throw new AuthoringApiError('unsupported');const rejected=expectedVersion(init,before.version);if(rejected)return rejected;
  const existing=id===undefined?undefined:before.messages.find(row=>row.message_id===id);if(id!==undefined&&!existing)return extraFail();let wanted:Omit<Message,'message_id'|'_authoring_revision'|'_authoring_preservation'>|undefined;
  let recipe:LegacyRecipe;
  let source:ExtraForm|undefined;
  if(method==='DELETE'){
   const current=await this.#messageForm(level,id,init.signal??undefined);if(current.dto._authoring_revision!==existing!._authoring_revision)return new Response(null,{status:409});
   const viewPath=`/Administration/Games/MessageEdit.aspx?gid=${this.#binding.gameId}&level=${level.level_id}&mid=${id}`,view=await this.#dispatch({kind:'message-view-read',effect:'read',method:'GET',path:viewPath},init.signal??undefined),root=extraTree(view,this.#binding,viewPath);let deletion:string|undefined;
   for(const node of extraNodes(root).filter(node=>extraTag(node)==='a')){const href=extraAttr(node,'href');if(!href)continue;let target:URL;try{target=new URL(href,`https://${this.#binding.domain}/Administration/Games/`);}catch{continue;}if(['http:','https:'].includes(target.protocol)&&target.hostname===this.#binding.domain&&!target.port&&!target.username&&!target.password&&!target.hash&&target.pathname==='/Administration/Games/MessageEdit.aspx'&&[...target.searchParams.keys()].sort().join(',')==='action,gid,level,mid'&&target.searchParams.get('action')==='delete'&&target.searchParams.get('gid')===String(this.#binding.gameId)&&target.searchParams.get('level')===String(level.level_id)&&target.searchParams.get('mid')===String(id))deletion=target.pathname+target.search;}
   if(!deletion)throw new AuthoringApiError('unsupported');recipe={kind:'message-delete',effect:'mutation',method:'GET',path:deletion};
  }
  else {
   const patch=patchObject(init);only(patch,['message_text','all_levels','level_ids','replace_nl_to_br']);const read=await this.#messageForm(level,id,init.signal??undefined);source=read.form;const current=read.dto;if(existing&&current._authoring_revision!==existing._authoring_revision)return new Response(null,{status:409});
   if(method==='POST'&&!Object.hasOwn(patch,'message_text'))return extraFail();const message=Object.hasOwn(patch,'message_text')?leaf(string(patch.message_text)):current.message_text,allLevels=Object.hasOwn(patch,'all_levels')?patch.all_levels:current.all_levels;if(typeof allLevels!=='boolean')return extraFail();
   const levels=await this.#levels(init.signal??undefined),targets=Object.hasOwn(patch,'level_ids')?patch.level_ids:current.level_ids;if(!Array.isArray(targets)||!targets.length||targets.some(id=>typeof id!=='number'||!levels.some(level=>level.level_id===id))||new Set(targets).size!==targets.length||allLevels&&Object.hasOwn(patch,'level_ids')&&(targets.length!==levels.length||levels.some(level=>!targets.includes(level.level_id))))return extraFail();
   const replace=Object.hasOwn(patch,'replace_nl_to_br')?patch.replace_nl_to_br:current.replace_nl_to_br;if(typeof replace!=='boolean')return extraFail();wanted={message_text:message,all_levels:allLevels,level_ids:allLevels?levels.map(row=>row.level_id):read.form.fields.filter(row=>/^lvl_/.test(row.name)&&targets.includes(Number(row.name.slice(4)))).map(row=>Number(row.name.slice(4))),replace_nl_to_br:replace};
   const body=copyBody(read.form);body.set('txtMessage',crlf(message));body.set('rbShowOnLevels',allLevels?'1':'2');for(const field of read.form.fields.filter(row=>/^lvl_[1-9]\d*$/.test(row.name))){body.delete(field.name);if(!allLevels&&targets.includes(Number(field.name.slice(4))))body.set(field.name,field.values[0]);}body.delete('chkReplaceNlToBr');if(replace)body.set('chkReplaceNlToBr',read.form.fields.find(row=>row.name==='chkReplaceNlToBr')!.values[0]);recipe={kind:'message-write',effect:'mutation',method:'POST',path:read.path,body:body.toString()};
  }
  if((await this.#level(level.level_id,init.signal??undefined)).level_number!==level.level_number)return new Response(null,{status:409});
  try{await this.#dispatch(recipe,init.signal??undefined);}catch{/* One dispatch, then independent read-back. */}
  let after:Awaited<ReturnType<LegacyLevelExtras['messages']>>;try{if((await this.#level(level.level_id,init.signal??undefined)).level_number!==level.level_number)throw new Error('Level order changed');after=await this.messages(level.level_id,init.signal??undefined);}catch{throw new AuthoringApiError('unknown-after-dispatch');}
  const omit=(rows:Message[],target:number)=>rows.filter(row=>row.message_id!==target);if(method==='DELETE'){if(after.messages.some(row=>row.message_id===id)||JSON.stringify(omit(before.messages,id!))!==JSON.stringify(after.messages))throw new AuthoringApiError('unknown-after-dispatch');return new Response(null,{status:204});}
  const candidates=id===undefined?after.messages.filter(row=>!before.messages.some(old=>old.message_id===row.message_id)):after.messages.filter(row=>row.message_id===id);
  if(candidates.length!==1||!wanted)throw new AuthoringApiError('unknown-after-dispatch');const actual=candidates[0];if(Object.keys(wanted).some(key=>JSON.stringify(actual[key as keyof Message])!==JSON.stringify(wanted![key as keyof typeof wanted]))||JSON.stringify(omit(before.messages,actual.message_id))!==JSON.stringify(omit(after.messages,actual.message_id)))throw new AuthoringApiError('unknown-after-dispatch');
  if(source){let fresh:MessageRead;try{fresh=await this.#messageForm(level,actual.message_id,init.signal??undefined);}catch{throw new AuthoringApiError('unknown-after-dispatch');}const changed=['txtMessage','rbShowOnLevels','chkReplaceNlToBr','action',...source.fields.filter(row=>/^lvl_/.test(row.name)).map(row=>row.name)];if(!extraPreserved(source,fresh.form,changed))throw new AuthoringApiError('unknown-after-dispatch');}
  return Response.json(actual,{status:method==='POST'?201:200});
 }
}
