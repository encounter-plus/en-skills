import {AuthoringApiError,sameAuthoringBinding,type AuthoringApiPort,type AuthoringBinding} from './authoring-api.ts';
import {legacyAnswerOperation,requireLegacyCapability,type LegacyAnswerOperationArgs} from './legacy-operation-preparation.ts';
import {batchCanonical} from './legacy-command-batch.ts';

type Row=Record<string,unknown>;
export interface LegacyAnswerMoveArgs {levelId:number;answerId:number;sourceSectorId:number;destinationSectorId:number}
export interface LegacyAnswerMoveState {binding:AuthoringBinding;args:LegacyAnswerMoveArgs;sourceInventory:Row;creationInventory:Row}
export interface LegacyAnswerMovePlan {schemaVersion:1;kind:'legacy-answer-move';before:LegacyAnswerMoveState;source:Row;planHash:string}
type Step={status:'not-dispatched'|'dispatching'|'verified'|'rejected'|'unknown';httpStatus?:number;newAnswerId?:number};
export interface LegacyAnswerMoveJournal {schemaVersion:1;planHash:string;binding:AuthoringBinding;args:LegacyAnswerMoveArgs;source:Row;status:'prepared'|'deleting'|'deleted'|'creating'|'complete'|'rejected'|'conflict'|'partial'|'unknown';sourceState:'present'|'absent'|'unknown';delete:Step;create:Step;afterDelete?:LegacyAnswerMoveState;afterCreate?:LegacyAnswerMoveState;reason?:string}
/** save resolves only after durable storage; exclusive fences concurrent execution of the fixed plan. */
export interface LegacyAnswerMoveJournalStore {exclusive<T>(work:()=>Promise<T>):Promise<T>;load():Promise<LegacyAnswerMoveJournal|undefined>;save(journal:LegacyAnswerMoveJournal):Promise<void>}
const equal=(a:unknown,b:unknown)=>batchCanonical(a)===batchCanonical(b);
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
const rows=(value:Row,key:string)=>value[key]as Row[];
const fail=(code:'unsupported'|'incomplete-read'|'invalid-scope'='incomplete-read'):never=>{throw new AuthoringApiError(code);};
export function validateLegacyAnswerMoveArgs(value:unknown):LegacyAnswerMoveArgs {
 if(!value||typeof value!=='object'||Array.isArray(value))return fail('unsupported');const args=value as LegacyAnswerMoveArgs;
 if(Object.keys(args).some(key=>!['levelId','answerId','sourceSectorId','destinationSectorId'].includes(key))||![args.levelId,args.answerId,args.sourceSectorId,args.destinationSectorId].every(positive)||args.sourceSectorId===args.destinationSectorId)return fail('invalid-scope');return {...args};
}
const deleteArgs=(args:LegacyAnswerMoveArgs):LegacyAnswerOperationArgs=>({action:'delete',levelId:args.levelId,answerId:args.answerId,sectorId:args.sourceSectorId});
const createArgs=(args:LegacyAnswerMoveArgs,source:Row):LegacyAnswerOperationArgs=>({action:'create',levelId:args.levelId,sectorId:args.destinationSectorId,answerText:source.answer_text as string,forMemberId:source.for_member_id as number});
function scope(state:LegacyAnswerMoveState){
 const args=validateLegacyAnswerMoveArgs(state.args);
 if(state.binding.engine!=='legacy')return fail('invalid-scope');
 for(const inventory of [state.sourceInventory,state.creationInventory])if(inventory.game_id!==state.binding.gameId||inventory.level_id!==args.levelId||typeof inventory.version!=='string'||!Array.isArray(inventory.answers)||!Array.isArray(inventory.sectors)||new Set(rows(inventory,'answers').map(row=>row.answer_id)).size!==rows(inventory,'answers').length)return fail();
 if(!equal(state.sourceInventory.answers,state.creationInventory.answers)||!equal(state.sourceInventory.sectors,state.creationInventory.sectors)||state.sourceInventory.version!==state.creationInventory.version)return fail();
 if(![args.sourceSectorId,args.destinationSectorId].every(id=>rows(state.creationInventory,'sectors').filter(row=>row.sector_id===id).length===1))return fail('invalid-scope');
}
/** Reads remain valid after deletion; only checkBefore requires the original answer. */
export async function readLegacyAnswerMoveState(api:AuthoringApiPort,input:LegacyAnswerMoveArgs,signal?:AbortSignal):Promise<LegacyAnswerMoveState>{
 const args=validateLegacyAnswerMoveArgs(input);requireLegacyCapability(api,'answer-delete');requireLegacyCapability(api,'answer-create');
 const sourceInventory=await legacyAnswerOperation.read(api,deleteArgs(args),signal),creationInventory=await legacyAnswerOperation.read(api,{action:'create',levelId:args.levelId,sectorId:args.destinationSectorId},signal);
 const state={binding:{...api.metadata.binding},args,sourceInventory,creationInventory};scope(state);return state;
}
export function checkLegacyAnswerMoveBefore(state:LegacyAnswerMoveState):Row {
 scope(state);const {args}=state;legacyAnswerOperation.checkBefore(state.sourceInventory,deleteArgs(args));
 const source=rows(state.sourceInventory,'answers').find(row=>row.answer_id===args.answerId)!;
 if(typeof source.answer_text!=='string'||!source.answer_text||source.answer_text.length>100000||typeof source.for_member_id!=='number'||!Number.isSafeInteger(source.for_member_id)||source.for_member_id<0||!Array.isArray(state.creationInventory.recipient_options)||!(state.creationInventory.recipient_options as Row[]).some(option=>option.member_id===source.for_member_id))return fail('invalid-scope');
 legacyAnswerOperation.checkBefore(state.creationInventory,createArgs(args,source));return source;
}
export async function prepareLegacyAnswerMove(state:LegacyAnswerMoveState):Promise<LegacyAnswerMovePlan>{
 const source=structuredClone(checkLegacyAnswerMoveBefore(state)),before=structuredClone(state),unsigned={schemaVersion:1 as const,kind:'legacy-answer-move' as const,before,source};
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(batchCanonical(unsigned)));return {...unsigned,planHash:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')};
}
/** A move is explicitly delete then add. The new answer has a new persistent ID. */
export function verifyLegacyAnswerMove(before:LegacyAnswerMoveState,after:LegacyAnswerMoveState,journal?:LegacyAnswerMoveJournal):boolean{
 try{scope(before);scope(after);const source=checkLegacyAnswerMoveBefore(before),args=before.args;
  if(!sameAuthoringBinding(before.binding,after.binding)||!equal(args,after.args)||!equal(before.creationInventory.sectors,after.creationInventory.sectors))return false;
  const prior=rows(before.creationInventory,'answers'),current=rows(after.creationInventory,'answers'),oldIds=new Set(prior.map(row=>row.answer_id)),created=current.filter(row=>!oldIds.has(row.answer_id));
  if(created.length!==1||current.some(row=>row.answer_id===args.answerId)||created[0].sector_id!==args.destinationSectorId||created[0].answer_text!==source.answer_text||created[0].for_member_id!==source.for_member_id||!equal(prior.filter(row=>row.answer_id!==args.answerId),current.filter(row=>row.answer_id!==created[0].answer_id)))return false;
  if(!journal?.afterDelete)return false;scope(journal.afterDelete);
  return journal.delete.status==='verified'&&['dispatching','verified','unknown'].includes(journal.create.status)&&journal.create.newAnswerId!==undefined&&journal.create.newAnswerId===created[0].answer_id&&equal(journal.args,args)&&equal(journal.source,source)&&sameAuthoringBinding(journal.binding,before.binding)&&sameAuthoringBinding(journal.afterDelete.binding,before.binding)&&equal(journal.afterDelete.args,args)&&legacyAnswerOperation.verify(before.sourceInventory,journal.afterDelete.sourceInventory,deleteArgs(args))&&legacyAnswerOperation.verify(journal.afterDelete.creationInventory,after.creationInventory,createArgs(args,source));
 }catch{return false;}
}
export async function executeLegacyAnswerMove(api:AuthoringApiPort,plan:LegacyAnswerMovePlan,store:LegacyAnswerMoveJournalStore,signal?:AbortSignal):Promise<LegacyAnswerMoveJournal>{
 const expected=await prepareLegacyAnswerMove(plan.before);if(!equal(expected,plan)||!sameAuthoringBinding(api.metadata.binding,plan.before.binding))return fail('invalid-scope');requireLegacyCapability(api,'answer-delete');requireLegacyCapability(api,'answer-create');
 return store.exclusive(async()=>{
  const previous=await store.load();
  if(previous){
   if(previous.schemaVersion!==1||previous.planHash!==plan.planHash||!sameAuthoringBinding(previous.binding,plan.before.binding)||!equal(previous.args,plan.before.args)||!equal(previous.source,plan.source))return fail('invalid-scope');
   // Any existing execution is read-only. Persisted intents cannot be replayed after interruption.
   if(['dispatching'].includes(previous.delete.status)||['dispatching'].includes(previous.create.status)){previous.status='unknown';previous.reason='Interrupted dispatch; reconcile by reading only';await store.save(previous);}
   return previous;
  }
  const journal:LegacyAnswerMoveJournal={schemaVersion:1,planHash:plan.planHash,binding:{...plan.before.binding},args:{...plan.before.args},source:structuredClone(plan.source),status:'prepared',sourceState:'present',delete:{status:'not-dispatched'},create:{status:'not-dispatched'}};
  const save=()=>store.save(structuredClone(journal));await save();
  const read=()=>readLegacyAnswerMoveState(api,plan.before.args,signal);
  let current:LegacyAnswerMoveState;try{current=await read();}catch{journal.status='conflict';journal.reason='Cannot independently read source and destination inventories';await save();return journal;}
  if(!equal(current,plan.before)){journal.status='conflict';journal.reason='Source or destination changed since approval';await save();return journal;}
  journal.status='deleting';journal.delete.status='dispatching';await save();
  let response:Response|undefined,deleteError=false,deleteBlocked=false;try{response=await legacyAnswerOperation.request(api,deleteArgs(plan.before.args),current.sourceInventory);}catch(error){deleteError=true;deleteBlocked=(error as {code?:string})?.code==='move-dispatch-blocked';}
  if(response)journal.delete.httpStatus=response.status;
  let afterDelete:LegacyAnswerMoveState|undefined;try{afterDelete=await read();journal.sourceState=rows(afterDelete.sourceInventory,'answers').some(row=>row.answer_id===plan.before.args.answerId)?'present':'absent';}catch{journal.sourceState='unknown';}
  if(!response?.ok||deleteError||!afterDelete||!legacyAnswerOperation.verify(current.sourceInventory,afterDelete.sourceInventory,deleteArgs(plan.before.args))){
   const knownRejection=deleteBlocked||response&&[400,401,403,404,405,409,422,428].includes(response.status);
   journal.delete.status=deleteBlocked?'not-dispatched':knownRejection?'rejected':'unknown';journal.status=journal.sourceState==='absent'?'partial':deleteBlocked?'conflict':knownRejection?'rejected':'unknown';journal.reason='Deletion was not acknowledged and independently verified; destination creation was not attempted';if(afterDelete)journal.afterDelete=afterDelete;await save();return journal;
  }
  journal.delete.status='verified';journal.sourceState='absent';journal.status='deleted';journal.afterDelete=afterDelete;await save();
  // A fresh creation form must still offer the exact native recipient after deletion.
  try{signal?.throwIfAborted();const fresh=await read();if(!equal(fresh,afterDelete)||!(fresh.creationInventory.recipient_options as Row[]).some(option=>option.member_id===plan.source.for_member_id))throw new Error();legacyAnswerOperation.checkBefore(fresh.creationInventory,createArgs(plan.before.args,plan.source));current=fresh;}catch{journal.status='partial';journal.reason='Source deleted; destination changed or recipient unavailable; no creation attempted';await save();return journal;}
  journal.status='creating';journal.create.status='dispatching';await save();
  response=undefined;let createError=false,createBlocked=false;try{response=await legacyAnswerOperation.request(api,createArgs(plan.before.args,plan.source),current.creationInventory);}catch(error){createError=true;createBlocked=(error as {code?:string})?.code==='move-dispatch-blocked';}
  if(response)journal.create.httpStatus=response.status;
  let afterCreate:LegacyAnswerMoveState|undefined;try{afterCreate=await read();journal.afterCreate=afterCreate;const ids=new Set(rows(current.creationInventory,'answers').map(row=>row.answer_id)),created=rows(afterCreate.creationInventory,'answers').filter(row=>!ids.has(row.answer_id));if(created.length===1&&positive(created[0].answer_id)&&created[0].sector_id===plan.before.args.destinationSectorId&&created[0].answer_text===plan.source.answer_text&&created[0].for_member_id===plan.source.for_member_id)journal.create.newAnswerId=created[0].answer_id;}catch{/* The durable intent remains uncertain. */}
  if(response?.ok&&!createError&&afterCreate&&legacyAnswerOperation.verify(current.creationInventory,afterCreate.creationInventory,createArgs(plan.before.args,plan.source))&&verifyLegacyAnswerMove(plan.before,afterCreate,journal)){journal.status='complete';journal.create.status='verified';}
  else{journal.create.status=createBlocked?'not-dispatched':response&&[400,401,403,404,405,409,422,428].includes(response.status)?'rejected':'unknown';journal.status=['rejected','not-dispatched'].includes(journal.create.status)?'partial':'unknown';journal.reason=createBlocked?'Source deleted; destination creation was blocked before dispatch by changed policy, binding or capabilities. No automatic retry or rollback':'Source deleted; destination creation is incomplete or uncertain. No automatic retry or rollback';}
  await save();return journal;
 });
}
