import {sameAuthoringBinding, type AuthoringCapability} from '../../src/authoring-api.ts';
import type {EncounterOperations} from './operations-core.js';
import {enforceRisk} from './policy.js';
import {safeError} from './redaction.js';

export const contentResources = ['tasks','sectors','bonuses','bonus-create','hints','meta','autopass','completion'] as const;
export type ContentResource = typeof contentResources[number];
const capabilities:Record<ContentResource,AuthoringCapability> = {hints:'hint-create',tasks:'task-create',sectors:'sector-create',bonuses:'bonus-create','bonus-create':'bonus-create',meta:'level-settings-update',autopass:'level-settings-update',completion:'level-settings-update'};
function resourcePath(gameId:number,levelId:number,resource:ContentResource) {
  if(!Number.isSafeInteger(gameId)||gameId<=0||!Number.isSafeInteger(levelId)||levelId<=0||!contentResources.includes(resource))throw new Error('Invalid content scope');
  return `/admin/games/${gameId}/levels/${levelId}/`+(resource==='hints'?'helps':resource==='completion'?'settings?section=sectors':resource==='bonus-create'?'bonuses/creation':resource);
}
async function port(ops:EncounterOperations,gameId:number){
  const api=await ops.api.authoringPort?.(gameId);
  if(!api||api.metadata.binding.engine!=='legacy'||api.metadata.binding.gameId!==gameId)throw new Error('Level content operations require a scoped legacy adapter');
  return api;
}
export async function summarizeBonusTexts(value:Record<string,unknown>){
 if(!Array.isArray(value.bonuses))return value;
 const bonuses=await Promise.all(value.bonuses.map(async(row:Record<string,unknown>)=>{
  const result={...row},content_summary:Record<string,unknown>={};
  for(const key of ['bonus_text','help_text'])if(typeof result[key]==='string'){
   const text=result[key] as string,bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
   content_summary[key]={characters:text.length,sha256:Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('')};delete result[key];
  }
  return {...result,content_summary};
 }));return {...value,bonuses,texts_omitted:true};
}
export async function readLevelContent(ops:EncounterOperations,input:{gameId:number;levelId:number;resource:ContentResource;includeText?:boolean}){
  const path=resourcePath(input.gameId,input.levelId,input.resource),api=await port(ops,input.gameId),response=await api.request(path);
  if(!response.ok)throw new Error(`Content read rejected: ${response.status}`);
  const value=await response.json();return input.resource==='bonuses'&&!input.includeText?summarizeBonusTexts(value):value;
}
/** One adapter-verified mutation; never retry an uncertain outcome. */
export async function writeLevelContent(...args:Parameters<typeof performContentWrite>){try{return await performContentWrite(...args);}catch(error){if((error as {code?:string}).code!=='unknown-after-dispatch')Object.assign(error as Error,{dispatchState:'not-dispatched'});throw error;}}
async function performContentWrite(ops:EncounterOperations,input:{gameId:number;levelId:number;resource:ContentResource;expectedVersion:string;fields:Record<string,unknown>;confirmed?:boolean},signal?:AbortSignal,prepared?:Record<string,unknown>){
  const path=resourcePath(input.gameId,input.levelId,input.resource),updatingTask=input.resource==='tasks'&&Number.isSafeInteger(input.fields.task_id),capability=updatingTask?'task-update':capabilities[input.resource];
  const ensure=()=>{signal?.throwIfAborted();if(!ops.host.writesEnabled())throw new Error('Writes are disabled by host');};
  ensure();const api=await port(ops,input.gameId),binding=api.metadata.binding;
  const permitted=async()=>{ensure();const current=await port(ops,input.gameId);ensure();if(!sameAuthoringBinding(binding,current.metadata.binding)||!current.metadata.capabilities[capability]?.available)throw new Error('Content binding/capability changed');};
  await permitted();let before=prepared;
  if(!before){const response=await api.request(path,{signal});if(!response.ok)throw new Error('Content inventory unavailable');before=await response.json() as Record<string,unknown>;}
  // Host-only preflight reuse; native adapter rechecks the version before dispatch.
  if(!input.expectedVersion||before.version!==input.expectedVersion)return {status:'conflict',changed:false};
  const index=await ops.listLevels(input.gameId) as {levels?:Record<string,unknown>[]},level=index.levels?.find(row=>row.level_id===input.levelId);
  if(!level||!Number.isInteger(level.level_number))throw new Error('Level identity unavailable');
  const live=await ops.getLiveLevelState(input.gameId,Number(level.level_number));
  const risk=enforceRisk('write-level-content',live,input.confirmed===true);
  const snapshotPath=await ops.host.saveSnapshot({operation:'write-level-content',gameId:input.gameId,levelId:input.levelId,capturedAt:new Date().toISOString(),binding,input,before,live,dispatchIntent:'one-adapter-write-no-automatic-retry'});
  await permitted();
  const create=['tasks','sectors','bonuses','bonus-create','hints'].includes(input.resource);
  const header=input.resource==='tasks'?'X-Authoring-Expected-Revision':'If-Match';
  let dispatched=false;
  try {
    dispatched=true;
    let target=path,revision=input.expectedVersion,body=input.fields;
    if(updatingTask){const task=(before.tasks as Record<string,unknown>[]|undefined)?.find(t=>t.task_id===input.fields.task_id);if(!task||typeof task._authoring_revision!=='string')return {status:'rejected',changed:false};target+='/'+input.fields.task_id;revision=task._authoring_revision;body={...input.fields};delete body.task_id;}
    const result=await api.request(target,{method:create&&!updatingTask?'POST':'PUT',headers:{[header]:revision,'Content-Type':'application/json'},body:JSON.stringify(body),signal});
    if(!result.ok)return {status:result.status===409?'conflict':[400,401,403,404,405,422,428].includes(result.status)?'rejected':'unknown',changed:[400,401,403,404,405,409,422,428].includes(result.status)?false:null,httpStatus:result.status,snapshotPath};
    const receipt=await result.json();await permitted();
    // These legacy routes only acknowledge success after their own exact readback.
    return {status:'applied',changed:true,receipt,snapshotPath,live,risk,verification:'adapter-readback',warnings:['no-server-cas','no-automatic-retry']};
  }catch(error){if(!dispatched)throw error;throw Object.assign(new Error('Content write outcome unknown; read this resource and reconcile before another write'),{code:'unknown-after-dispatch',details:{snapshotPath,gameId:input.gameId,levelId:input.levelId,resource:input.resource,cause:safeError(error),noAutomaticRetry:true}});}
}
