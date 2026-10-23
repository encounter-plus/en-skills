import {parse} from 'parse5';
import {authoringBinding,AuthoringApiError} from './authoring-api.ts';
import {resolveEngineProfile} from './engine-profile.ts';
import {legacyNodes,type LegacyPage,type LegacyRecipe,type LegacySessionPort} from './legacy-authoring.ts';
import {validateLegacyRecipe} from './legacy-recipe-guard.ts';

export interface LegacyCookie {name:string;value:string;domain:string;path:string;secure:boolean;httpOnly:boolean;expires:number}
export interface LegacyCookieJar {schemaVersion:1;kind:'encounter-legacy-cookie-jar';domain:string;cookies:LegacyCookie[];importId?:string;userAgent?:string}
/** Imports only cookies scoped to the explicitly selected Encounter tenant. */
export function parseLegacyCookieJar(input:unknown,domain:string):LegacyCookieJar {
  if(resolveEngineProfile(domain).engine!=='legacy'||!input||typeof input!=='object')throw new Error('Expected an authorized legacy browser session');
  const value=input as {domain?:unknown;cookies?:unknown;importId?:unknown;userAgent?:unknown};
  if(value.userAgent!==undefined&&(typeof value.userAgent!=='string'||!value.userAgent.trim()||value.userAgent.length>2048||/[^\x20-\x7e]/.test(value.userAgent)))throw new Error('Invalid browser user agent');
  if(value.domain!==undefined&&value.domain!==domain||!Array.isArray(value.cookies)||value.cookies.length>200)throw new Error('Invalid legacy cookie session');
  const cookies:LegacyCookie[]=[];
  for(const item of value.cookies) {
    if(!item||typeof item!=='object')throw new Error('Invalid legacy cookie session');
    const row=item as Record<string,unknown>,cookieDomain=String(row.domain??'').toLowerCase();
    if(![domain,'.'+domain,'.en.cx'].includes(cookieDomain))continue;
    if(typeof row.name!=='string'||!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(row.name)||typeof row.value!=='string'||/[;\r\n\u0000]/.test(row.value)||row.value.length>16000||typeof row.path!=='string'||!row.path.startsWith('/')||/[\r\n\u0000]/.test(row.path)||typeof row.secure!=='boolean'||typeof row.httpOnly!=='boolean'||typeof row.expires!=='number'||!Number.isFinite(row.expires)||row.expires< -1)throw new Error('Invalid legacy cookie session');
    cookies.push({name:row.name,value:row.value,domain:cookieDomain,path:row.path,secure:row.secure,httpOnly:row.httpOnly,expires:row.expires});
  }
  if(!cookies.length)throw new Error('No cookies for the selected legacy tenant');
  if(value.importId!==undefined&&(typeof value.importId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(value.importId)))throw new Error('Invalid session import identity');
  return {schemaVersion:1,kind:'encounter-legacy-cookie-jar',domain,cookies,...(value.importId?{importId:value.importId as string}:{}),...(value.userAgent?{userAgent:value.userAgent as string}:{})};
}
export const legacyCredentialKey=(profileName:string)=>'legacy-cookie-v1:'+profileName;
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
const queues=new Map<string,{tail:Promise<unknown>;lastRequest:number}>();
/** Only a dispatched mutation's transport/body loss may preserve a session for read-only reconciliation. */
class UncertainLegacyMutation extends Error {
  constructor(){super('Legacy dispatch outcome unknown; do not retry');this.name='UncertainLegacyMutation';}
}

/** Explicit cookie injection, fixed recipes and a serial/rate-limited host boundary. */
export async function createNodeLegacySession(options:{domain:string;gameId:number;credential:()=>Promise<LegacyCookieJar>;fetch?:typeof fetch;minRequestIntervalMs?:number;persistentBinding?:boolean}):Promise<LegacySessionPort> {
  const original=parseLegacyCookieJar(await options.credential(),options.domain),fingerprint=await digest(JSON.stringify(original));
  let binding=authoringBinding(options.domain,options.gameId,crypto.randomUUID());const origin='https://'+binding.domain;
  const interval=options.minRequestIntervalMs??1000;
  if(!Number.isFinite(interval)||interval<0)throw new Error('Invalid request interval');
  let active=true,principal:string|undefined;
  const state=queues.get(origin)??{tail:Promise.resolve(),lastRequest:0};queues.set(origin,state);
  const fence=()=>{if(!active)throw new AuthoringApiError('session-changed');};
  const read=async(path:string,recipe?:LegacyRecipe,signal?:AbortSignal):Promise<LegacyPage>=>{
    fence();signal?.throwIfAborted();
    const wait=Math.max(0,state.lastRequest+interval-Date.now());if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
    fence();signal?.throwIfAborted();
    if(await digest(JSON.stringify(parseLegacyCookieJar(await options.credential(),binding.domain)))!==fingerprint){active=false;throw new AuthoringApiError('session-changed');}
    fence();signal?.throwIfAborted();state.lastRequest=Date.now();
    const url=new URL(path,origin);
    const cookies=original.cookies.filter(cookie=>(cookie.expires===-1||cookie.expires*1000>Date.now())&&(url.pathname===cookie.path||url.pathname.startsWith(cookie.path.endsWith('/')?cookie.path:cookie.path+'/'))).sort((a,b)=>b.path.length-a.path.length);
    if(!cookies.length)throw new Error('Legacy browser session expired; import an authorized session again');
    let body:BodyInit|undefined=recipe?.body;
    if(recipe?.upload){const u=recipe.upload,form=new FormData();for(const [key,value]of u.controls)form.append(key,value);form.append(u.field,new Blob([Uint8Array.from(atob(u.base64),c=>c.charCodeAt(0))],{type:u.mime}),u.filename);body=form;}
    let response:Response;
    try {response=await (options.fetch??fetch)(url,{method:recipe?.method??'GET',redirect:'manual',cache:'no-store',headers:{Cookie:cookies.map(cookie=>cookie.name+'='+cookie.value).join('; '),...(original.userAgent?{'User-Agent':original.userAgent}:{}),...(recipe?.body===undefined?{}:{'Content-Type':'application/x-www-form-urlencoded'})},body,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});}catch{if(recipe?.effect==='mutation')throw new UncertainLegacyMutation();throw new Error('Legacy session request failed');}
    if(response.status>=300&&response.status<400) {
      if(recipe?.effect==='mutation')return {status:response.status,url:url.href,html:''};
      const location=new URL(response.headers.get('Location')??'/',origin);
      if(location.origin===origin&&location.pathname==='/NotHumanRequest.aspx')throw new Error('Legacy human-verification checkpoint: wait 30 minutes or use the site login UI; no automatic retry');
      throw new Error('Legacy authorization/redirect checkpoint; no automatic login or retry');
    }
    const contentType=response.headers.get('Content-Type')??'',expectedJson=recipe?.kind==='statistics-json';
    if(!response.ok||!(expectedJson?/^application\/json(?:\s*;|$)/i.test(contentType):/(?:text\/html|application\/xhtml\+xml)/i.test(contentType)))throw new Error('Legacy page/authentication unavailable');
    const reader=response.body?.getReader();if(!reader)throw new Error('Legacy page unavailable');const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2_000_000)throw new Error('Legacy page exceeds host limit');chunks.push(part.value);}}catch(error){if(recipe?.effect==='mutation')throw new UncertainLegacyMutation();throw error;}finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
    const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
    const charset=response.headers.get('Content-Type')?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]??'utf-8';
    return {status:response.status,url:response.url||url.href,html:new TextDecoder(charset,{fatal:true}).decode(bytes)};
  };
  const pageIdentity=async(page:LegacyPage)=>{
    const nodes=legacyNodes(parse(page.html));
    const attr=(node:typeof nodes[number],name:string)=>'attrs' in node?node.attrs.find(row=>row.name===name)?.value:undefined;
    const markers=nodes.filter(node=>'tagName' in node&&node.tagName==='a'&&attr(node,'href')==='/UserDetails.aspx'&&(attr(node,'class')??'').split(/\s+/).includes('white')&&(attr(node,'class')??'').split(/\s+/).includes('bold'));
    if(markers.length!==1||!nodes.some(node=>attr(node,'id')==='lnkUserName'&&attr(node,'href')==='/UserDetails.aspx')||!nodes.some(node=>attr(node,'href')==='/Login.aspx?action=logout')||!nodes.some(node=>'tagName' in node&&node.tagName==='form'&&(attr(node,'id')==='LevelsCreateForm'||attr(node,'name')==='LevelsCreateForm')))throw new Error('Legacy authenticated author/CAPTCHA checkpoint; no retry');
    const login=legacyNodes(markers[0]).filter(node=>'value' in node).map(node=>'value' in node?node.value:'').join('').trim();if(!login||login.length>200)throw new Error('Legacy principal unavailable');return digest(binding.domain+':'+login);
  };
  const identity=async(signal?:AbortSignal)=>pageIdentity(await read('/Administration/Games/LevelManager.aspx?gid='+binding.gameId,undefined,signal));
  if(options.persistentBinding){
    const task=state.tail.then(async()=>{principal=await identity();binding=authoringBinding(options.domain,options.gameId,'legacy-principal:'+await digest(fingerprint+':'+principal));});
    state.tail=task.catch(()=>{});await task;
  }
  return {binding,supportsFileUpload:true,async currentBinding(){fence();return binding;},async dispatch(recipe,signal){
    validateLegacyRecipe(recipe,binding);fence();
    const task=state.tail.then(async()=>{
      fence();const current=parseLegacyCookieJar(await options.credential(),binding.domain);if(await digest(JSON.stringify(current))!==fingerprint){active=false;throw new AuthoringApiError('session-changed');}
      if(recipe.kind==='level-index'){
        const page=await read(recipe.path,recipe,signal),observed=await pageIdentity(page);
        if(principal&&principal!==observed){active=false;throw new AuthoringApiError('session-changed');}principal=observed;
        if(await digest(JSON.stringify(parseLegacyCookieJar(await options.credential(),binding.domain)))!==fingerprint){active=false;throw new AuthoringApiError('session-changed');}
        return page;
      }
      if(recipe.effect==='read'){
        // Check the account before reading; immutable credentials are also checked
        // after the response. Mutations retain independent before/after identity reads.
        const observed=await identity(signal);
        if(principal&&principal!==observed){active=false;throw new AuthoringApiError('session-changed');}principal=observed;
        const page=await read(recipe.path,recipe,signal);
        if(await digest(JSON.stringify(parseLegacyCookieJar(await options.credential(),binding.domain)))!==fingerprint){active=false;throw new AuthoringApiError('session-changed');}
        return page;
      }
      const before=await identity(signal);if(principal&&principal!==before){active=false;throw new AuthoringApiError('session-changed');}principal=before;
      const page=await read(recipe.path,recipe,signal);
      if(await identity(signal)!==principal){active=false;throw new AuthoringApiError(recipe.effect==='mutation'?'unknown-after-dispatch':'session-changed');}
      if(await digest(JSON.stringify(parseLegacyCookieJar(await options.credential(),binding.domain)))!==fingerprint){active=false;throw new AuthoringApiError(recipe.effect==='mutation'?'unknown-after-dispatch':'session-changed');}
      return page;
    }).catch(error=>{
      // No request is retried here. The durable executor journal owns replay prevention.
      // A later GET checks principal before reading and credentials on both sides; writes also recheck principal afterward.
      // Authentication, redirects, malformed principal, cookie rotation and ordinary read failures retire the port.
      if(!(error instanceof UncertainLegacyMutation))active=false;
      throw error;
    });state.tail=task.catch(()=>{});return task;
  }};
}
