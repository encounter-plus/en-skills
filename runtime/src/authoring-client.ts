import {createAuthoringApi} from '../../src/authoring-factory.ts';
import {createNodeLegacySession,legacyCredentialKey,parseLegacyCookieJar} from '../../src/node-legacy-session.ts';
import {resolveEngineProfile} from '../../src/engine-profile.ts';
import type {AuthoringApiPort} from '../../src/authoring-api.ts';
import {EncounterApiClient,ApiError} from './api-client.js';
import type {ApiLike,ApiRequestOptions,CredentialStoreLike,EncounterProfile} from './types.js';

const ports=new Map<string,Promise<AuthoringApiPort>>();
const fetchIds=new WeakMap<typeof fetch,string>();
class LegacyNodeApiClient implements ApiLike {
  constructor(readonly profile:EncounterProfile,readonly credentials:CredentialStoreLike,readonly fetchImpl:typeof fetch){}
  async authoringMetadata(gameId:number){return (await runtimeAuthoringPort(this.profile,this.credentials,gameId,this.fetchImpl)).metadata;}
  async request<T=unknown>(method:string,path:string,options:ApiRequestOptions={}):Promise<T> {
    if(options.auth===false||options.retryAuth===true)throw new Error('Legacy cookie host does not support anonymous or automatic auth retry');
    const match=/^\/(?:admin\/)?games\/([1-9]\d*)(?:\/|$)/.exec(path);
    if(!match||!Number.isSafeInteger(Number(match[1])))throw new Error('Expected a scoped game authoring path');
    const gameId=Number(match[1]);
    const port=await runtimeAuthoringPort(this.profile,this.credentials,gameId,this.fetchImpl);
    const response=await port.request(path,{method,headers:options.headers,body:options.body===undefined?undefined:JSON.stringify(options.body)});
    if(!response.ok)throw new ApiError('Legacy authoring operation rejected',response.status,method,path);
    return (response.status===204?null:await response.json()) as T;
  }
}
/** Process-stable legacy binding; credential import/rotation selects a fresh opaque epoch. */
export async function runtimeAuthoringPort(profile:EncounterProfile,credentials:CredentialStoreLike,gameId:number,fetchImpl:typeof fetch=fetch):Promise<AuthoringApiPort> {
  if(resolveEngineProfile(profile.domain).engine==='modern')return createAuthoringApi({domain:profile.domain,gameId,sessionEpoch:crypto.randomUUID(),token:async()=>{const token=await credentials.get(profile.name);if(!token)throw new Error('Author authentication required');return token;},fetch:fetchImpl});
  const credential=await credentials.get(legacyCredentialKey(profile.name));if(!credential)throw new Error('Import an authorized legacy browser session with encounter-agent auth import-session');
  const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(credential))),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(!fetchIds.has(fetchImpl))fetchIds.set(fetchImpl,crypto.randomUUID());
  const cacheKey=JSON.stringify([profile.name,profile.domain,gameId,fingerprint,fetchIds.get(fetchImpl)]);
  let port=ports.get(cacheKey);
  if(!port){port=(async()=>{
    const session=await createNodeLegacySession({domain:profile.domain,gameId,fetch:fetchImpl,persistentBinding:true,credential:async()=>{
    const secret=await credentials.get(legacyCredentialKey(profile.name));
    if(!secret)throw new Error('Import an authorized legacy browser session with encounter-agent auth import-session');
    try{return parseLegacyCookieJar(JSON.parse(secret),profile.domain);}catch{throw new Error('Legacy cookie credential is invalid; import an authorized session again');}
    }});
    return createAuthoringApi({domain:profile.domain,gameId,sessionEpoch:session.binding.sessionEpoch,legacySession:session});
  })();ports.set(cacheKey,port);
    // A failed principal/transport initialization never becomes a permanently rejected cache entry.
    // This does not reconnect an existing invalidated port or replay a request.
    const pending=port;void pending.catch(()=>{if(ports.get(cacheKey)===pending)ports.delete(cacheKey);});
    if(ports.size>100)ports.delete(ports.keys().next().value!);}
  return port;
}
export function createRuntimeApi(profile:EncounterProfile,credentials:CredentialStoreLike,fetchImpl:typeof fetch=fetch):ApiLike {
  const api:ApiLike=resolveEngineProfile(profile.domain).engine==='legacy'?new LegacyNodeApiClient(profile,credentials,fetchImpl):new EncounterApiClient(profile,profile.name,credentials,fetchImpl);
  const scoped=new Map<number,Promise<AuthoringApiPort>>();
  api.authoringPort=async gameId=>{
    if(resolveEngineProfile(profile.domain).engine==='legacy')return runtimeAuthoringPort(profile,credentials,gameId,fetchImpl);
    let port=scoped.get(gameId);if(!port){port=runtimeAuthoringPort(profile,credentials,gameId,fetchImpl);scoped.set(gameId,port);}return port;
  };
  return api;
}
export function runtimeProfile(profile:EncounterProfile):EncounterProfile {
  const selected=resolveEngineProfile(profile.domain);
  return {...profile,previewUrlTemplate:profile.previewUrlTemplate??(selected.engine==='legacy'?`https://${selected.domain}/admin/games/levels/preview/{gameId}?level={levelNumber}`:`https://${selected.domain}/admin/games/{gameId}/levels/preview/{levelNumber}`)};
}
