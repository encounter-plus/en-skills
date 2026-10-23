import {z} from 'zod';
import {createHash} from 'node:crypto';

const text=z.string().min(1).refine(v=>v.trim().length>0,{message:'Nonblank text required'}),key=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/).refine(v=>!['constructor','prototype','__proto__'].includes(v)),id=z.number().int().positive();
const source=z.object({key,reference:text,role:z.enum(['player-content','author-requirement','reference','excluded']),text:text}).strict();
const duration=z.number().int().min(0);
const setting=z.discriminatedUnion('resource',[
 z.object({resource:z.literal('autopass'),fields:z.object({timeout_hours:duration,timeout_minutes:duration.max(59),timeout_seconds:duration.max(59),penalty_enabled:z.boolean(),penalty_hours:duration,penalty_minutes:duration.max(59),penalty_seconds:duration.max(59)}).strict()}).strict(),
 z.object({resource:z.literal('completion'),fields:z.object({all_sectors:z.boolean(),required_sectors_count:z.number().int().positive().optional()}).strict().refine(v=>v.all_sectors||v.required_sectors_count!==undefined,{message:'Required sector threshold missing'})}).strict()
]);
const task=z.object({text,sourceKeys:z.array(text).min(1),replaceNlToBr:z.boolean().default(false),forMemberId:z.number().int().nonnegative().optional(),targetTaskId:id.optional()}).strict();
const sector=z.object({key,name:text,answers:z.array(text).min(1).max(200)}).strict();
const bonus=z.object({key,name:text,text:z.string(),help:z.string(),answers:z.array(text).min(1),rewardSeconds:duration,isNegative:z.boolean(),forMemberId:z.literal(0).optional()}).strict();
const hint=z.object({key,text,timeout:duration,isPenalty:z.boolean(),penaltyComment:z.string().optional(),penaltyTime:duration.optional(),requestPenaltyConfirm:z.boolean().optional()}).strict().refine(v=>!v.isPenalty||(v.penaltyComment!==undefined&&v.penaltyTime!==undefined&&v.requestPenaltyConfirm!==undefined),{message:'Penalty hint needs all penalty fields'});
const level=z.object({key,name:text,sourceKeys:z.array(text).min(1),task,additionalTasks:z.array(task).optional(),targetLevelId:id.optional(),expectedResources:z.record(z.string(),text).optional(),sectors:z.array(sector).optional(),bonuses:z.array(bonus).optional(),hints:z.array(hint).optional(),messages:z.array(z.object({key,text}).strict()).optional(),settings:z.array(setting).default([])}).strict();
export const assetSchema=z.object({key,filename:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(css|png|jpg|gif)$/),mime:z.enum(['text/css','image/png','image/jpeg','image/gif']),content:text,encoding:z.enum(['utf8','base64']),sourceKeys:z.array(text).min(1)}).strict();
export const importPlanSchema=z.object({schemaVersion:z.literal(1),domain:text,gameId:id,request:text,sources:z.array(source).min(1),levels:z.array(level).min(1).max(20),assets:z.array(assetSchema).optional(),organizer:z.object({sourceKeys:z.array(text).min(1),text,allLevels:z.literal(true)}).strict().optional(),unresolved:z.array(text).describe('Blocking requirements inside the requested scope that cannot yet be fulfilled. Use [] when none. Explicitly excluded sections and author-approved unchanged settings are NOT blockers; mark excluded source roles instead.')}).strict().superRefine((p,ctx)=>{
 const keys=new Map(p.sources.map(s=>[s.key,s]));
 if(keys.size!==p.sources.length||new Set(p.levels.map(l=>l.key)).size!==p.levels.length)ctx.addIssue({code:'custom',message:'Source and level keys must be unique'});
 for(const l of p.levels){
  for(const k of [...l.sourceKeys,...[l.task,...l.additionalTasks??[]].flatMap(t=>t.sourceKeys)])if(!keys.has(k))ctx.addIssue({code:'custom',message:'Unknown source key: '+k});
  for(const t of [l.task,...l.additionalTasks??[]])for(const k of t.sourceKeys)if(keys.get(k)?.role!=='player-content')ctx.addIssue({code:'custom',message:'Task sources must be player-content: '+k});
  if(p.sources.some(s=>s.role==='author-requirement'&&s.text===l.task.text))ctx.addIssue({code:'custom',message:'Author requirement cannot be the player task'});
  if(new Set(l.settings.map(s=>s.resource)).size!==l.settings.length)ctx.addIssue({code:'custom',message:'Duplicate settings resource'});
  for(const values of [l.sectors??[],l.bonuses??[],l.hints??[],l.messages??[]])if(new Set(values.map(v=>v.key)).size!==values.length)ctx.addIssue({code:'custom',message:'Duplicate entity key'});
  for(const values of [l.sectors??[],l.bonuses??[]]){if(new Set(values.map(v=>v.name)).size!==values.length)ctx.addIssue({code:'custom',message:'Duplicate entity name'});for(const v of values)if(new Set(v.answers).size!==v.answers.length)ctx.addIssue({code:'custom',message:'Duplicate exact answer'});}
  const tasks=[l.task,...l.additionalTasks??[]].map(t=>JSON.stringify([t.text,t.forMemberId??0,t.targetTaskId??null]));if(new Set(tasks).size!==tasks.length)ctx.addIssue({code:'custom',message:'Ambiguous duplicate task'});
  if(l.targetLevelId&&!l.expectedResources)ctx.addIssue({code:'custom',message:'Existing level requires expectedResources from inspect_import_level'});
 }
 const targets=p.levels.flatMap(l=>l.targetLevelId?[l.targetLevelId]:[]);if(new Set(targets).size!==targets.length)ctx.addIssue({code:'custom',message:'Duplicate target level'});
 const assets=p.assets??[];if(new Set(assets.map(a=>a.key)).size!==assets.length||new Set(assets.map(a=>a.filename)).size!==assets.length)ctx.addIssue({code:'custom',message:'Duplicate asset key or filename'});
 for(const a of assets){for(const k of a.sourceKeys)if(!keys.has(k))ctx.addIssue({code:'custom',message:'Unknown asset source'});if(a.filename.endsWith('.css')!==(a.mime==='text/css')||(a.mime==='text/css'&&a.encoding!=='utf8'))ctx.addIssue({code:'custom',message:'CSS requires utf8 and text/css'});}
 for(const m of JSON.stringify(p).matchAll(/\{\{asset:([a-zA-Z0-9_-]+)\}\}/g))if(!assets.some(a=>a.key===m[1]))ctx.addIssue({code:'custom',message:'Unknown asset placeholder: '+m[1]});
 for(const k of p.organizer?.sourceKeys??[])if(keys.get(k)?.role!=='author-requirement')ctx.addIssue({code:'custom',message:'Organizer source must be an author requirement'});
 const used=new Set([...p.levels.flatMap(l=>[...l.sourceKeys,...l.task.sourceKeys]),...assets.flatMap(a=>a.sourceKeys),...(p.organizer?.sourceKeys??[])]);
 for(const s of p.sources)if(s.role==='author-requirement'&&!used.has(s.key)&&!p.unresolved.length)ctx.addIssue({code:'custom',message:'Unaccounted author requirement: '+s.key});
});
export type ImportPlan=z.infer<typeof importPlanSchema>;
export type Asset=z.infer<typeof assetSchema>;
export type Data=Record<string,unknown>;
type Intent={kind:'create'|'write'|'message'|'asset';levelKey?:string;levelId?:number;resource?:string;wanted?:Data;before?:Data;asset?:Asset;assetKey?:string};
export type Step={status:'prepared'|'dispatching'|'applied'|'rejected'|'unknown';error?:string;intent?:Intent};
export type Journal={planRef:string;binding?:string;levels:Record<string,number>;assets?:Record<string,string>;resourceVersions?:Record<string,string>;steps:Record<string,Step>};
export interface ImportStore {exclusive<T>(work:()=>Promise<T>):Promise<T>;load():Promise<Journal|undefined>;save(j:Journal):Promise<void>}
export interface PlanHost {
 domain:string;identity(gameId:number):Promise<string>;preflight(plan:ImportPlan):Promise<void>;
 index(gameId:number):Promise<{levels:{level_id:number;level_name:string}[]}>;
 create(gameId:number):Promise<{status?:string;created?:{level_id:number}[]}>;
 read(gameId:number,levelId:number,resource:string):Promise<Data>;
 write(gameId:number,levelId:number,resource:string,fields:Data,version:string):Promise<{status?:string}>;
 message(gameId:number,levelId:number,text:string,levelIds:number[],allLevels?:boolean):Promise<void>;
 answer?(gameId:number,levelId:number,sectorId:number,answer:string):Promise<void>;
 asset?(gameId:number,asset:Asset,upload:boolean):Promise<{url:string;sha256:string}|undefined>;
}
const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Data)[k])).join(',')+'}':JSON.stringify(v);
export const resourceFingerprint=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export const planReference=(p:ImportPlan)=>resourceFingerprint(p);
export const planError=(code:string,message:string)=>Object.assign(new Error(message),{code});
const rows=(v:unknown):Data[]=>Array.isArray(v)?v as Data[]:[];
const fields=(v:Data)=>v.fields&&typeof v.fields==='object'?v.fields as Data:v;
const equal=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const subset=(actual:Data,expected:Data)=>Object.entries(expected).every(([k,v])=>equal(actual[k],v));
export const assetBytes=(a:Asset)=>Buffer.from(a.content,a.encoding==='utf8'?'utf8':'base64');
export const assetHash=(a:Asset)=>createHash('sha256').update(assetBytes(a)).digest('hex');
const uncertain=(s:Step)=>s.status==='dispatching'||s.status==='unknown';
function binding(p:ImportPlan,h:PlanHost){if(p.domain!==h.domain)throw planError('plan-scope-mismatch','Plan domain differs from active host');}
async function checkJournal(p:ImportPlan,h:PlanHost,j:Journal){binding(p,h);if(j.planRef!==planReference(p))throw planError('plan-mismatch','Journal belongs to a different plan');if(j.binding&&j.binding!==await h.identity(p.gameId))throw planError('plan-session-mismatch','Stored import belongs to a different host session or principal');}
function render(value:string,j:Journal){return value.replace(/\{\{asset:([a-zA-Z0-9_-]+)\}\}/g,(_,key)=>{const url=j.assets?.[key];if(!url)throw planError('asset-missing','Upload and verify asset first: '+key);return url.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll("'",'&#39;');});}
const taskFields=(t:ImportPlan['levels'][number]['task'],j:Journal)=>({task_text:render(t.text,j),replace_nl_to_br:t.replaceNlToBr,for_member_id:t.forMemberId??0,...(t.targetTaskId?{task_id:t.targetTaskId}:{})});
function entities(l:ImportPlan['levels'][number],j:Journal,lid:number):{key:string;resource:string;wanted:Data}[]{return [
 ...[l.task,...l.additionalTasks??[]].map((t,i)=>({key:'task-'+i,resource:'tasks',wanted:taskFields(t,j)})),
 ...(l.sectors??[]).map(s=>({key:'sector-'+s.key,resource:'sectors',wanted:{sector_name:s.name,new_answers:s.answers} as Data})),
 ...(l.bonuses??[]).map(b=>({key:'bonus-'+b.key,resource:'bonuses',wanted:{bonus_name:b.name,bonus_text:render(b.text,j),help_text:render(b.help,j),new_answers:b.answers,reward_seconds:b.rewardSeconds,is_negative:b.isNegative,all_levels:false,level_ids:[lid]} as Data})),
 ...(l.messages??[]).map(m=>({key:'message-'+m.key,resource:'messages',wanted:{message_text:render(m.text,j),all_levels:false,level_ids:[lid]} as Data})),
 ...(l.hints??[]).map(v=>({key:'hint-'+v.key,resource:'hints',wanted:{help_text:render(v.text,j),timeout:v.timeout,is_penalty:v.isPenalty,for_member_id:0,...(v.isPenalty?{penalty_comment:v.penaltyComment,penalty_time:v.penaltyTime,request_penalty_confirm:v.requestPenaltyConfirm}:{})} as Data})),
 ];}
function collection(v:Data,r:string){return r==='hints'?[...rows(v.helps),...rows(v.penalty_helps)]:rows(v[r]);}
function matches(v:Data,r:string,w:Data){return collection(v,r).filter(row=>Object.entries(w).every(([k,value])=>k==='new_answers'?equal((r==='sectors'?rows(v.answers).filter(a=>a.sector_id===row.sector_id):rows(row.answers)).map(a=>a.answer_text),value):equal(row[k],value)));}
const isCollection=(r:string)=>['tasks','sectors','bonuses','hints','messages'].includes(r);
function satisfied(v:Data,r:string,w:Data){return isCollection(r)?matches(v,r,w).length===1:subset(fields(v),w);}
export async function inspectImportLevel(h:PlanHost,gameId:number,levelId:number){const resources:Record<string,Data>={},fingerprints:Record<string,string>={};for(const r of ['meta','tasks','sectors','bonuses','hints','messages','autopass','completion']){resources[r]=await h.read(gameId,levelId,r);fingerprints[r]=resourceFingerprint(resources[r]);}return {levelId,resources,expectedResources:fingerprints};}
export async function verifyImportPlan(p:ImportPlan,h:PlanHost,j:Journal){
 await checkJournal(p,h,j);const issues:{key:string;reason:string}[]=p.unresolved.map(reason=>({key:'unresolved',reason}));
 for(const a of p.assets??[]){try{const observed=await h.asset?.(p.gameId,a,false);if(!observed||observed.sha256!==assetHash(a)||j.assets?.[a.key]!==observed.url)issues.push({key:a.key,reason:'asset-missing-or-content-mismatch'});}catch{issues.push({key:a.key,reason:'asset-read-unavailable'});}}
 const index=await h.index(p.gameId);let last=-1;
 for(const l of p.levels){const lid=j.levels[l.key],position=index.levels.findIndex(x=>x.level_id===lid),actual=index.levels[position];if(!actual){issues.push({key:l.key,reason:'level-missing'});continue;}
  if(position<=last)issues.push({key:l.key,reason:'level-order-mismatch'});last=position;if(actual.level_name!==l.name)issues.push({key:l.key,reason:'level-name-mismatch'});
  try{for(const e of entities(l,j,lid)){if(!satisfied(await h.read(p.gameId,lid,e.resource),e.resource,e.wanted))issues.push({key:l.key,reason:e.resource==='tasks'?'task-content-or-recipient-mismatch':e.key+'-mismatch'});}for(const s of l.settings)if(!subset(fields(await h.read(p.gameId,lid,s.resource)),s.fields))issues.push({key:l.key,reason:s.resource+'-mismatch'});}catch{issues.push({key:l.key,reason:'read-unavailable'});}
 }
 if(p.organizer){try{const messages=rows((await h.read(p.gameId,j.levels[p.levels[0]!.key]!,'messages')).messages);if(messages.filter(m=>m.message_text===render(p.organizer!.text,j)&&m.all_levels===true).length!==1)issues.push({key:'organizer',reason:'organizer-text-or-all-levels-mismatch'});}catch{issues.push({key:'organizer',reason:'read-unavailable'});}}
 for(const [key,s]of Object.entries(j.steps))if(s.status!=='applied')issues.push({key,reason:uncertain(s)?'uncertain-dispatch-reconciliation-required':'step-not-applied'});
 return {status:issues.length?(Object.keys(j.levels).length?'partial':'blocked'):'complete',planRef:j.planRef,levels:j.levels,issues};
}
/** Reconciliation changes the local journal only. Absence after a timeout never proves non-dispatch. */
export async function reconcileImportPlan(p:ImportPlan,h:PlanHost,store:ImportStore,attribution?:{levelKey:string;levelId:number;authorConfirmation:string}){return store.exclusive(async()=>{
 const j=await store.load();if(!j)throw planError('journal-missing','No dispatched import to reconcile');await checkJournal(p,h,j);
 const resolutions:{step:string;status:string;reason?:string}[]=[];
 for(const [name,s]of Object.entries(j.steps)){if(!uncertain(s)||!s.intent)continue;const i=s.intent;let applied=false;
  try{if(i.kind==='create'){const before=rows(i.before?.levels),after=(await h.index(p.gameId)).levels,candidates=after.filter(a=>!before.some(b=>b.level_id===a.level_id));
    // A lost anonymous create cannot be attributed safely, even if only one new ID exists.
    if(attribution&&attribution.levelKey===i.levelKey){const candidate=candidates.find(a=>a.level_id===attribution.levelId);if(!attribution.authorConfirmation.trim()||candidates.length!==1||!candidate||candidate.level_name!==''||Object.values(j.levels).includes(candidate.level_id)||before.some(b=>!after.some(a=>a.level_id===b.level_id&&a.level_name===b.level_name)))throw planError('ambiguous-created-level','Attribution does not identify one unchanged empty new level');const tasks=await h.read(p.gameId,candidate.level_id,'tasks');if(rows(tasks.tasks).length)throw planError('created-level-not-empty','Candidate already has content; explicit existing-level plan required');j.levels[i.levelKey!]=candidate.level_id;}
    applied=!!j.levels[i.levelKey!]&&candidates.some(a=>a.level_id===j.levels[i.levelKey!]);
    if(!applied){resolutions.push({step:name,status:'unknown',reason:'Creation has no receipt. Inspect candidate IDs '+candidates.map(c=>c.level_id).join(',')+'; explicit attribution is required.'});continue;}
   }else if(i.kind==='asset'){const planned=i.asset??p.assets?.find(a=>a.key===i.assetKey);if(!planned)throw planError('asset-missing','Asset absent from immutable plan');const a=await h.asset?.(p.gameId,planned,false);applied=!!a&&a.sha256===assetHash(planned);if(applied)(j.assets??={})[planned.key]=a!.url;
   }else {const observed=await h.read(p.gameId,i.levelId!,i.resource!);applied=i.kind==='message'?rows(observed.messages).filter(m=>subset(m,i.wanted!)).length===1:satisfied(observed,i.resource!,i.wanted!);if(applied&&(i.kind==='write'||i.kind==='message'))(j.resourceVersions??={})[i.levelId+':'+i.resource]=resourceFingerprint(observed);}
   if(applied){s.status='applied';delete s.error;await store.save(j);}resolutions.push({step:name,status:s.status,...(!applied?{reason:'No unique exact result; no mutation replay permitted'}:{})});
  }catch(e){resolutions.push({step:name,status:'unknown',reason:(e as Error).message});}
 }
 return {...await verifyImportPlan(p,h,j),resolutions};
 });}
/** Persist intent before dispatch, fence existing resources, never repeat uncertain mutations. */
export async function createLevelFromPlan(p:ImportPlan,key:string,h:PlanHost,store:ImportStore,confirmed:boolean){
 if(!confirmed)throw planError('confirmation-required','Confirm complete import plan');binding(p,h);if(p.unresolved.length)throw planError('plan-unresolved','Resolve in-scope blockers before writing');
 const l=p.levels.find(l=>l.key===key);if(!l)throw planError('unknown-plan-level','Choose a stored level key');
 return store.exclusive(async()=>{const ref=planReference(p),j=await store.load()??{planRef:ref,levels:{},steps:{}};await checkJournal(p,h,j);
 if(Object.values(j.steps).some(uncertain))return {status:'partial',planRef:ref,levels:j.levels,error:{code:'unknown-after-dispatch',message:'Call reconcile_import_plan before further writes'},steps:j.steps};
 j.binding=await h.identity(p.gameId);await store.save(j);await h.preflight(p);
 const run=async(name:string,intent:Intent,work:()=>Promise<{status?:string}|void>)=>{if(j.steps[name]?.status==='applied')return;j.steps[name]={status:'prepared',intent};await store.save(j);j.steps[name]!.status='dispatching';await store.save(j);
  try{const result=await work();if(result?.status&&result.status!=='applied'){j.steps[name]!.status=['conflict','rejected'].includes(result.status)?'rejected':'unknown';await store.save(j);throw planError('write-'+result.status,'Write stopped: '+name);}j.steps[name]!.status='applied';await store.save(j);}catch(e){if(j.steps[name]!.status!=='rejected')j.steps[name]!.status=(e as {dispatchState?:string}).dispatchState==='not-dispatched'?'rejected':'unknown';j.steps[name]!.error=(e as Error).message;await store.save(j);throw e;}};
 try{
  for(const previous of p.levels.slice(0,p.levels.indexOf(l)))if(!j.levels[previous.key])throw planError('plan-order','Apply preceding plan levels first');
  for(const a of p.assets??[]){if(j.steps['asset:'+a.key]?.status==='applied')continue;if(!h.asset)throw planError('asset-unsupported','Host does not support resource uploads');const existing=await h.asset(p.gameId,a,false);if(existing){if(existing.sha256!==assetHash(a))throw planError('asset-conflict','Existing filename has different bytes: '+a.filename);(j.assets??={})[a.key]=existing.url;j.steps['asset:'+a.key]={status:'applied'};await store.save(j);continue;}
   await run('asset:'+a.key,{kind:'asset',assetKey:a.key},async()=>{const uploaded=await h.asset!(p.gameId,a,true);if(!uploaded||uploaded.sha256!==assetHash(a))throw planError('asset-unverified','Upload bytes not verified');(j.assets??={})[a.key]=uploaded.url;});}
  if(!j.levels[key]){const before=await h.index(p.gameId);if(l.targetLevelId){if(!before.levels.some(v=>v.level_id===l.targetLevelId))throw planError('target-missing','Specified level ID does not exist');if(!l.expectedResources)throw planError('snapshot-required','Inspect existing level before preparing the plan');j.levels[key]=l.targetLevelId;await store.save(j);}else await run(key+':create',{kind:'create',levelKey:key,before},async()=>{const r=await h.create(p.gameId);if(r.status!=='applied'||r.created?.length!==1)return {status:r.status??'unknown'};j.levels[key]=r.created[0]!.level_id;await store.save(j);return r;});}
  const lid=j.levels[key]!;
  const put=async(name:string,r:string,wanted:Data)=>{if(j.steps[name]?.status==='applied')return;const before=await h.read(p.gameId,lid,r);
   if(satisfied(before,r,wanted)){j.steps[name]={status:'applied'};await store.save(j);return;}
   const expected=j.resourceVersions?.[lid+':'+r]??(l.targetLevelId?l.expectedResources?.[r]:undefined);
   if(expected&&resourceFingerprint(before)!==expected||l.targetLevelId&&!expected)throw planError('content-conflict','Existing resource changed since inspection: '+r);
   if(r==='tasks'&&wanted.task_id&&!rows(before.tasks).some(t=>t.task_id===wanted.task_id))throw planError('task-not-found','Target task ID absent; inspect the level');
   if(r==='sectors'&&rows(before.sectors).some(s=>s.sector_name===wanted.sector_name)||r==='bonuses'&&rows(before.bonuses).some(b=>b.bonus_name===wanted.bonus_name))throw planError('content-conflict','Named entity already exists with different content: '+r);
   if(r==='messages'){await run(name,{kind:'message',levelId:lid,resource:r,wanted,before},async()=>{await h.message(p.gameId,lid,String(wanted.message_text),[lid],false);const after=await h.read(p.gameId,lid,r);if(!satisfied(after,r,wanted))throw planError('readback-mismatch','Message result does not match plan');(j.resourceVersions??={})[lid+':'+r]=resourceFingerprint(after);});return;}
   if(typeof before.version!=='string')throw planError('missing-read-version','Complete version required: '+r);
   await run(name,{kind:'write',levelId:lid,resource:r,wanted,before},async()=>{const result=await h.write(p.gameId,lid,r,wanted,before.version as string);if(result.status==='applied'){const after=await h.read(p.gameId,lid,r);if(!satisfied(after,r,wanted))throw planError('readback-mismatch','Write result does not match plan');(j.resourceVersions??={})[lid+':'+r]=resourceFingerprint(after);}return result;});};
  await put(key+':meta','meta',{level_name:l.name});
  for(const e of entities(l,j,lid)){
   const answers=e.wanted.new_answers as string[]|undefined;
   if(e.resource!=='sectors'||!answers||answers.length<=10){await put(key+':'+e.key,e.resource,e.wanted);continue;}
   const full=await h.read(p.gameId,lid,'sectors');if(satisfied(full,'sectors',e.wanted))continue;
   if(!h.answer)throw planError('answer-unsupported','Host cannot append sector answers');
   await put(key+':'+e.key,'sectors',{...e.wanted,new_answers:answers.slice(0,10)});
   for(let i=10;i<answers.length;i++){const name=key+':'+e.key+':answer-'+i;if(j.steps[name]?.status==='applied')continue;
    const before=await h.read(p.gameId,lid,'sectors'),wanted={...e.wanted,new_answers:answers.slice(0,i+1)};
    if(satisfied(before,'sectors',wanted)){j.steps[name]={status:'applied'};await store.save(j);continue;}
    const previous={...e.wanted,new_answers:answers.slice(0,i)},sector=matches(before,'sectors',previous);
    if(sector.length!==1||j.resourceVersions?.[lid+':sectors']&&resourceFingerprint(before)!==j.resourceVersions[lid+':sectors'])throw planError('answer-conflict','Sector changed before appending exact answer');
    await run(name,{kind:'write',levelId:lid,resource:'sectors',wanted,before},async()=>{await h.answer!(p.gameId,lid,Number(sector[0]!.sector_id),answers[i]!);const after=await h.read(p.gameId,lid,'sectors');if(!satisfied(after,'sectors',wanted))throw planError('readback-mismatch','Answer append did not verify');(j.resourceVersions??={})[lid+':sectors']=resourceFingerprint(after);});
   }
  }
  for(const s of l.settings)await put(key+':'+s.resource,s.resource,s.fields);
  if(p.organizer&&p.levels.every(l=>j.levels[l.key])&&j.steps.organizer?.status!=='applied'){const first=j.levels[p.levels[0]!.key]!,wanted={message_text:render(p.organizer.text,j),all_levels:true},before=await h.read(p.gameId,first,'messages');if(rows(before.messages).filter(m=>subset(m,wanted)).length===1){j.steps.organizer={status:'applied'};await store.save(j);}else await run('organizer',{kind:'message',levelId:first,resource:'messages',wanted,before},async()=>h.message(p.gameId,first,wanted.message_text,(await h.index(p.gameId)).levels.map(l=>l.level_id)));}
 }catch(e){return {status:'partial',planRef:ref,levels:j.levels,error:{code:(e as Error&{code?:string}).code??'import-stopped',message:(e as Error).message},steps:j.steps};}
 return {...await verifyImportPlan(p,h,j),steps:j.steps};});
}
