import {AuthoringApiError,type AuthoringApiPort} from './authoring-api.ts';

type Json = null|boolean|number|string|Json[]|{[key:string]:Json};
function json(value:unknown):Json {
  if(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number'&&Number.isFinite(value))return value;
  if(Array.isArray(value))return value.map(json);
  if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,json(item)]));
  throw new Error('Export drafts must be finite JSON values');
}
const sha=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,'0')).join('');
export interface ExportRead {path:string;status:'captured'|'unsupported'|'failed';rawJson?:string;value?:Json;sha256?:string;error?:string;verifiedUnchanged?:boolean}
/** Read-only evidence package, deliberately distinct from a complete game backup. */
export async function captureAuthoringExport(api:AuthoringApiPort,options:{maxLevels?:number;draftPresentation?:unknown;signal?:AbortSignal}={}) {
  const {binding}=api.metadata,maxLevels=options.maxLevels??200;
  if(!Number.isSafeInteger(maxLevels)||maxLevels<1||maxLevels>1000)throw new Error('maxLevels must be 1..1000');
  const draftPresentation=options.draftPresentation===undefined?null:json(options.draftPresentation);
  const reads:ExportRead[]=[],blockers:string[]=[];let halted=false,totalBytes=0;
  const read=async(path:string):Promise<ExportRead>=>{
    options.signal?.throwIfAborted();
    if(halted)return {path,status:'failed',error:'Capture stopped after a prior failed read; no retry performed'};
    try {
      const response=await api.request(path,{method:'GET',signal:options.signal});
      if(!response.ok)throw new Error('Read HTTP '+response.status);
      const rawJson=await response.text();
      totalBytes+=new TextEncoder().encode(rawJson).length;
      if(new TextEncoder().encode(rawJson).length>20_000_000||totalBytes>64_000_000)throw new Error('Read exceeds export size limit; no truncated content retained');
      const value=json(JSON.parse(rawJson));
      const object=value&&typeof value==='object'&&!Array.isArray(value)?value:undefined;
      const game=object?.game;
      const declaredGames=[object?.game_id,game&&typeof game==='object'&&!Array.isArray(game)?game.id:undefined].filter(value=>value!==undefined);
      const level=object?.level;
      const declaredLevels=[object?.level_id,level&&typeof level==='object'&&!Array.isArray(level)?level.level_id:undefined].filter(value=>value!==undefined);
      const expectedLevel=path.match(/\/levels\/([1-9]\d*)\/editor$/)?.[1];
      if(declaredGames.some(value=>value!==binding.gameId)||expectedLevel&&declaredLevels.some(value=>value!==Number(expectedLevel)))throw new AuthoringApiError('invalid-scope');
      return {path,status:'captured',rawJson,value,sha256:await sha(rawJson)};
    }catch(error){options.signal?.throwIfAborted();if(error instanceof AuthoringApiError&&['session-changed','invalid-scope'].includes(error.code))throw error;const unsupported=error instanceof AuthoringApiError&&error.code==='unsupported';if(!unsupported)halted=true;return {path,status:unsupported?'unsupported':'failed',error:error instanceof Error?error.message:'Read failed'};}
  };
  const game=await read(`/admin/games/${binding.gameId}`),index=await read(`/admin/games/${binding.gameId}/levels`);reads.push(game,index);
  const indexValue=index.value as {levels?:unknown}|undefined;
  const levels=Array.isArray(indexValue?.levels)?indexValue.levels:[];
  if(index.status!=='captured'||!Array.isArray(indexValue?.levels))blockers.push('Level inventory is unavailable or not structurally complete');
  const ids:number[]=[],seen=new Set<number>();
  for(const level of levels){const id=level?.level_id;if(!Number.isSafeInteger(id)||id<1||seen.has(id)){blockers.push('Ambiguous or invalid stable level identity');continue;}seen.add(id);ids.push(id);}
  if(ids.length>maxLevels)blockers.push('Level capture cap reached; remaining editors were not read');
  for(const id of ids.slice(0,maxLevels))reads.push(await read(`/admin/games/${binding.gameId}/levels/${id}/editor`));
  if(binding.engine==='legacy')reads.push(await read(`/admin/games/${binding.gameId}/files`),await read(`/admin/games/${binding.gameId}/scenario-export`));
  // This is an observed collection consistency check, never a server CAS or an
  // atomic multi-entity snapshot. A changed/failed reread blocks preparation.
  for(const row of reads.filter(row=>row.status==='captured'&&!/\/(?:files|scenario-export)$/.test(row.path))) {
    const after=await read(row.path);row.verifiedUnchanged=after.status==='captured'&&row.sha256===after.sha256;
    if(!row.verifiedUnchanged)blockers.push('Source changed or could not be revalidated: '+row.path);
  }
  for(const row of reads)if(row.status!=='captured')blockers.push(row.status+': '+row.path);
  const uncovered=['Full game settings and original editor controls','Complete answers/sectors/bonuses/messages/settings/recipients coverage for every level','Authoritative file inventory and exact attachment bytes','Native important block mapping','Poster assignment/display and media bytes'];
  blockers.push(...uncovered.map(field=>'Not certified by this export: '+field));
  return {schemaVersion:1,kind:'encounter-authoring-export',purpose:'migration-preparation',createdAt:new Date().toISOString(),binding:{registryVersion:binding.registryVersion,engine:binding.engine,domain:binding.domain,gameId:binding.gameId},captureSessionFingerprint:await sha(binding.sessionEpoch),runtimeProfile:api.metadata.profile.runtime,capabilities:api.metadata.capabilities,revisionSemantics:api.metadata.revision,reads,draftPresentation:{source:'user-draft',value:draftPresentation,applied:false},coverage:{completeBackup:false,capturedEditors:reads.filter(row=>/\/editor$/.test(row.path)&&row.status==='captured').length,indexedLevels:levels.length,uncovered,consistentObservedCollection:reads.filter(row=>row.verifiedUnchanged!==undefined).every(row=>row.verifiedUnchanged)&&index.status==='captured'},migration:{ready:false,writesPerformed:0,blockers:[...new Set(blockers)]},limitations:['Raw JSON responses and literal author strings are retained without text normalization.','This is not a complete backup, a restore plan, or proof of lossless server round-trip.','Re-reading detects observed changes only; no atomic server snapshot or legacy CAS is claimed.']};
}
