import {AuthoringApiError,sameAuthoringBinding,type AuthoringApiPort,type AuthoringBinding,type AuthoringCapability} from './authoring-api.ts';
export interface LegacyBatchCommand {id:string;kind:'level.create'|'task.create'|'sector.create'|'sector.rename'|'sector.delete';levelId?:number|{createdBy:string};sectorId?:number;taskText?:string;sectorName?:string}
export interface LegacyBatchPlan {schemaVersion:1;kind:'legacy-command-batch';binding:AuthoringBinding;commands:LegacyBatchCommand[];snapshots:Record<string,unknown>;planHash:string}
export interface LegacyBatchJournal {schemaVersion:1;planHash:string;binding:AuthoringBinding;status:'running'|'complete'|'blocked'|'unknown';steps:{id:string;status:'pending'|'dispatching'|'succeeded'|'blocked'|'unknown';createdId?:number;httpStatus?:number}[];expected:Record<string,unknown>;idMapping:Record<string,number>}
/** save must resolve only after durable storage; exclusive must fence concurrent executors. */
export interface LegacyBatchJournalStore {exclusive<T>(work:()=>Promise<T>):Promise<T>;load():Promise<LegacyBatchJournal|undefined>;save(value:LegacyBatchJournal):Promise<void>}
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
export const batchCanonical=(value:unknown):string=>Array.isArray(value)?'['+value.map(batchCanonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+batchCanonical((value as Record<string,unknown>)[key])).join(',')+'}':JSON.stringify(value);
const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(batchCanonical(value)))),b=>b.toString(16).padStart(2,'0')).join('');
const capabilities:Record<LegacyBatchCommand['kind'],AuthoringCapability>={'level.create':'level-create','task.create':'task-create','sector.create':'sector-create','sector.rename':'sector-update','sector.delete':'sector-delete'};
export function validateLegacyBatchCommands(value:unknown):LegacyBatchCommand[]{
 if(!Array.isArray(value)||!value.length||value.length>100)throw new AuthoringApiError('unsupported');const seen=new Map<string,LegacyBatchCommand>(),deletedSectors=new Set<string>();
 return value.map(item=>{if(!item||typeof item!=='object'||Array.isArray(item))throw new AuthoringApiError('unsupported');const row=item as LegacyBatchCommand;
  if(typeof row.id!=='string'||!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(row.id)||seen.has(row.id)||!Object.hasOwn(capabilities,row.kind))throw new AuthoringApiError('unsupported');
  const allowed=row.kind==='level.create'?['id','kind']:row.kind==='task.create'?['id','kind','levelId','taskText']:row.kind==='sector.create'?['id','kind','levelId','sectorName']:row.kind==='sector.rename'?['id','kind','levelId','sectorId','sectorName']:['id','kind','levelId','sectorId'];
  if(Object.keys(row).some(key=>!allowed.includes(key)))throw new AuthoringApiError('unsupported');
  if(row.kind!=='level.create'){const ref=row.levelId;if(!positive(ref)&&!(ref&&typeof ref==='object'&&Object.keys(ref).length===1&&seen.get(ref.createdBy)?.kind==='level.create'))throw new AuthoringApiError('unsupported');}
  if(row.kind==='task.create'&&(typeof row.taskText!=='string'||row.taskText.length>100000)||['sector.create','sector.rename'].includes(row.kind)&&(typeof row.sectorName!=='string'||!row.sectorName.trim()||row.sectorName.length>1000)||['sector.rename','sector.delete'].includes(row.kind)&&!positive(row.sectorId))throw new AuthoringApiError('unsupported');
  if(['sector.rename','sector.delete'].includes(row.kind)){if(!positive(row.levelId))throw new AuthoringApiError('unsupported');const target=row.levelId+':'+row.sectorId;if(deletedSectors.has(target))throw new AuthoringApiError('unsupported');if(row.kind==='sector.delete')deletedSectors.add(target);}
  const command=structuredClone(row);seen.set(row.id,command);return command;
 });
}
function supported(api:AuthoringApiPort,commands:LegacyBatchCommand[]){if(api.metadata.binding.engine!=='legacy')throw new AuthoringApiError('unsupported');for(const command of commands)if(!api.metadata.capabilities[capabilities[command.kind]]?.available)throw new AuthoringApiError('unsupported');}
const collection=(api:AuthoringApiPort,command:LegacyBatchCommand,levelId?:number)=>`/admin/games/${api.metadata.binding.gameId}/levels`+(command.kind==='level.create'?'':`/${levelId}/${command.kind==='task.create'?'tasks':'sectors'}`);
function validSnapshot(value:unknown,path:string,gameId:number):boolean {
 const match=path.match(new RegExp(`^/admin/games/${gameId}/levels(?:/([1-9]\\d*)/(tasks|sectors))?$`));if(!match||!value||typeof value!=='object'||Array.isArray(value))return false;const snapshot=value as Record<string,any>,section=match[2]??'levels',idField=section==='levels'?'level_id':section==='tasks'?'task_id':'sector_id',rows=snapshot[section];
 return snapshot.game_id===gameId&&typeof snapshot.version==='string'&&snapshot.version.length>0&&(!match[1]||[snapshot.level_id,snapshot.level&&typeof snapshot.level==='object'?snapshot.level.level_id:undefined].filter(value=>value!==undefined).length>0&&[snapshot.level_id,snapshot.level&&typeof snapshot.level==='object'?snapshot.level.level_id:undefined].filter(value=>value!==undefined).every(value=>value===Number(match[1])))&&Array.isArray(rows)&&rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row)&&positive(row[idField])&&(section==='levels'?positive(row.level_number):section==='tasks'?typeof row.task_text==='string':typeof row.sector_name==='string'))&&new Set(rows.map(row=>row[idField])).size===rows.length;
}
async function read(api:AuthoringApiPort,path:string,signal?:AbortSignal){const response=await api.request(path,{method:'GET',signal});if(!response.ok)throw new AuthoringApiError('incomplete-read');const value=await response.json();if(!validSnapshot(value,path,api.metadata.binding.gameId))throw new AuthoringApiError('incomplete-read');return value;}
export async function prepareLegacyCommandBatch(api:AuthoringApiPort,input:unknown,signal?:AbortSignal):Promise<LegacyBatchPlan>{
 const commands=validateLegacyBatchCommands(input);supported(api,commands);const snapshots:Record<string,unknown>={};
 for(const command of commands){if(command.kind!=='level.create'&&!positive(command.levelId))continue;const path=collection(api,command,command.levelId as number);if(!Object.hasOwn(snapshots,path))snapshots[path]=await read(api,path,signal);if(['sector.rename','sector.delete'].includes(command.kind)&&!(snapshots[path] as {sectors:{sector_id:number}[]}).sectors.some(row=>row.sector_id===command.sectorId))throw new AuthoringApiError('invalid-scope');}
 const plan={schemaVersion:1 as const,kind:'legacy-command-batch' as const,binding:{...api.metadata.binding},commands,snapshots};return {...plan,planHash:await hash(plan)};
}
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
function validateJournal(api:AuthoringApiPort,plan:LegacyBatchPlan,value:unknown):asserts value is LegacyBatchJournal {
 const fail=():never=>{throw new AuthoringApiError('invalid-scope');};
 if(!object(value)||Object.keys(value).sort().join(',')!=='binding,expected,idMapping,planHash,schemaVersion,status,steps'||value.schemaVersion!==1||value.planHash!==plan.planHash||!object(value.binding)||!sameAuthoringBinding(value.binding as AuthoringBinding,plan.binding)||!['running','complete','blocked','unknown'].includes(value.status)||!Array.isArray(value.steps)||value.steps.length!==plan.commands.length||!object(value.expected)||!object(value.idMapping))return fail();
 const mapping:Record<string,number>={},paths=new Set(Object.keys(plan.snapshots)),touched=new Set<string>();let stopped=false,terminal:string|undefined;
 for(let index=0;index<plan.commands.length;index++){
  const command=plan.commands[index],step=value.steps[index];
  if(!object(step)||Object.keys(step).some(key=>!['id','status','createdId','httpStatus'].includes(key))||step.id!==command.id||!['pending','dispatching','succeeded','blocked','unknown'].includes(step.status)||step.httpStatus!==undefined&&(!Number.isInteger(step.httpStatus)||step.httpStatus<100||step.httpStatus>599))return fail();
  if(step.status==='succeeded'){
   if(stopped||step.httpStatus===undefined||step.httpStatus<200||step.httpStatus>299)return fail();
   if(command.kind.endsWith('.create')){if(!positive(step.createdId))return fail();mapping[command.id]=step.createdId;}else if(step.createdId!==undefined)return fail();
   const levelId=positive(command.levelId)?command.levelId:command.levelId?mapping[command.levelId.createdBy]:undefined;if(command.kind!=='level.create'&&!positive(levelId))return fail();const path=collection(api,command,levelId);paths.add(path);touched.add(path);
  }else {
   if(step.createdId!==undefined||step.status==='pending'&&step.httpStatus!==undefined)return fail();
   if(step.status!=='pending'){if(stopped)return fail();terminal=step.status;}stopped=true;
  }
 }
 if(value.status==='complete'&&stopped||value.status==='running'&&terminal&&terminal!=='dispatching'||value.status==='blocked'&&terminal!=='blocked'||value.status==='unknown'&&terminal!=='unknown')return fail();
 if(batchCanonical(value.idMapping)!==batchCanonical(mapping)||Object.keys(value.expected).length!==paths.size||Object.keys(value.expected).some(path=>!paths.has(path)))return fail();
 for(const path of paths){
  if(!Object.hasOwn(value.expected,path))return fail();const snapshot=value.expected[path],match=path.match(new RegExp(`^/admin/games/${plan.binding.gameId}/levels(?:/([1-9]\\d*)/(tasks|sectors))?$`));
  if(!match||!validSnapshot(snapshot,path,plan.binding.gameId))return fail();
  if(!touched.has(path)&&batchCanonical(snapshot)!==batchCanonical(plan.snapshots[path]))return fail();
 }
 for(const command of plan.commands){if(!Object.hasOwn(mapping,command.id))continue;const levelId=positive(command.levelId)?command.levelId:command.levelId?mapping[command.levelId.createdBy]:undefined,path=collection(api,command,levelId),section=command.kind==='level.create'?'levels':command.kind==='task.create'?'tasks':'sectors',idField=command.kind==='level.create'?'level_id':command.kind==='task.create'?'task_id':'sector_id';
  if(value.expected[path][section].filter((row:any)=>object(row)&&row[idField]===mapping[command.id]).length!==1)return fail();
 }
}
/** Sequential, non-atomic native commands. A persisted dispatch intent can never be replayed. */
export async function executeLegacyCommandBatch(api:AuthoringApiPort,plan:LegacyBatchPlan,store:LegacyBatchJournalStore,signal?:AbortSignal):Promise<LegacyBatchJournal>{
 const commands=validateLegacyBatchCommands(plan.commands);supported(api,commands);const {planHash,...unsigned}=plan;if(!sameAuthoringBinding(api.metadata.binding,plan.binding)||plan.schemaVersion!==1||plan.kind!=='legacy-command-batch'||await hash(unsigned)!==planHash)throw new AuthoringApiError('invalid-scope');
 return store.exclusive(async()=>{
  let journal=await store.load();if(journal)validateJournal(api,plan,journal);
  if(journal?.steps.some(step=>step.status==='dispatching')){journal.status='unknown';for(const step of journal.steps)if(step.status==='dispatching')step.status='unknown';await store.save(journal);return journal;}
  if(journal&&journal.status!=='running')return journal;
  if(!journal){for(const [path,expected]of Object.entries(plan.snapshots))if(batchCanonical(await read(api,path,signal))!==batchCanonical(expected))throw new AuthoringApiError('conflict');journal={schemaVersion:1,planHash,binding:{...plan.binding},status:'running',steps:commands.map(row=>({id:row.id,status:'pending'})),expected:structuredClone(plan.snapshots),idMapping:{}};await store.save(journal);}
  for(let index=0;index<commands.length;index++){
   const command=commands[index],step=journal.steps[index];if(step.status==='succeeded')continue;if(step.status!=='pending'){journal.status='unknown';await store.save(journal);return journal;}signal?.throwIfAborted();
   const levelId=positive(command.levelId)?command.levelId:command.levelId?journal.idMapping[command.levelId.createdBy]:undefined;if(command.kind!=='level.create'&&!positive(levelId))throw new AuthoringApiError('invalid-scope');
   const path=collection(api,command,levelId),before=await read(api,path,signal);if(Object.hasOwn(journal.expected,path)&&batchCanonical(journal.expected[path])!==batchCanonical(before)){step.status='blocked';journal.status='blocked';await store.save(journal);return journal;}
   if(['sector.rename','sector.delete'].includes(command.kind)&&(!Array.isArray(before.sectors)||!before.sectors.some((row:any)=>row.sector_id===command.sectorId))){step.status='blocked';journal.status='blocked';await store.save(journal);return journal;}
   const method=command.kind==='sector.delete'?'DELETE':command.kind==='sector.rename'?'PUT':'POST',target=path+(['sector.rename','sector.delete'].includes(command.kind)?'/'+command.sectorId:'');
   const group=command.kind==='level.create'?commands.slice(index,index+20).filter((row,offset,rows)=>rows.slice(0,offset+1).every((r,n)=>r.kind==='level.create'&&journal!.steps[index+n].status==='pending')):[command];
   const body=command.kind==='level.create'?{count:group.length}:command.kind==='task.create'?{task_text:command.taskText,for_member_id:0,replace_nl_to_br:false}:command.kind==='sector.delete'?undefined:{sector_name:command.sectorName};
   step.status='dispatching';await store.save(journal);
   try{
    signal?.throwIfAborted();const response=await api.request(target,{method,headers:{'Content-Type':'application/json',[command.kind.startsWith('sector.')?'If-Match':'X-Authoring-Expected-Revision']:before.version},...(body?{body:JSON.stringify(body)}:{}),signal});step.httpStatus=response.status;
    if(!response.ok){step.status=response.status===409||[400,401,403,404,405,422,428].includes(response.status)?'blocked':'unknown';journal.status=step.status;await store.save(journal);return journal;}
    const receipt=await response.json(),created=command.kind==='level.create'?receipt.created?.length===group.length?receipt.created[0].level_id:undefined:command.kind==='task.create'?receipt.created_task_id:command.kind==='sector.create'?receipt.created_sector_id:undefined;
    if(command.kind.endsWith('.create')&&!positive(created))throw new Error('Missing verified ID mapping');
    const after=await read(api,path,signal),same=(a:unknown,b:unknown)=>batchCanonical(a)===batchCanonical(b);
    if(command.kind==='level.create'){if(!Array.isArray(before.levels)||!Array.isArray(after.levels)||after.levels.length!==before.levels.length+group.length||!same(after.levels.slice(before.levels.length),receipt.created)||receipt.created.some((row:any)=>!positive(row.level_id))||new Set(receipt.created.map((row:any)=>row.level_id)).size!==group.length||!same(after.levels.slice(0,before.levels.length),before.levels))throw new Error('Level readback mismatch');}
    else if(command.kind==='task.create'){if(!Array.isArray(before.tasks)||!Array.isArray(after.tasks)||after.tasks.length!==before.tasks.length+1||!same(after.tasks.filter((row:any)=>row.task_id!==created),before.tasks)||after.tasks.find((row:any)=>row.task_id===created)?.task_text!==command.taskText!.replace(/\r\n|\r/g,'\n'))throw new Error('Task readback mismatch');}
    else {const prior=before.sectors,actual=after.sectors;if(!Array.isArray(prior)||!Array.isArray(actual))throw new Error('Sector readback incomplete');
     const expected=command.kind==='sector.delete'?prior.filter((row:any)=>row.sector_id!==command.sectorId):command.kind==='sector.rename'?prior.map((row:any)=>row.sector_id===command.sectorId?{...row,sector_name:command.sectorName}:row):prior;
     if(command.kind==='sector.create'){if(actual.length!==prior.length+1||actual.find((row:any)=>row.sector_id===created)?.sector_name!==command.sectorName||!same(actual.filter((row:any)=>row.sector_id!==created),expected))throw new Error('Sector readback mismatch');}else if(!same(actual,expected))throw new Error('Sector readback mismatch');
    }
    if(command.kind==='level.create'){group.forEach((row,offset)=>{const grouped=journal!.steps[index+offset];grouped.createdId=receipt.created[offset].level_id;grouped.httpStatus=response.status;grouped.status='succeeded';journal!.idMapping[row.id]=grouped.createdId!;});}else if(command.kind.endsWith('.create')){step.createdId=created;journal.idMapping[command.id]=created;}journal.expected[path]=after;step.status='succeeded';await store.save(journal);
   }catch{step.status='unknown';journal.status='unknown';await store.save(journal);return journal;}
  }
  journal.status='complete';await store.save(journal);return journal;
 });
}
