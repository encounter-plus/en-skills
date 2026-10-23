import {AuthoringApiError,type AuthoringBinding} from './authoring-api.ts';

type Row=Record<string,unknown>&{level_id:number;level_number:number;level_name:string};
type Index=Record<string,unknown>&{game_id:number;can_manipulate_levels:boolean;levels:Row[];version:string};
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
const canonical=(value:unknown):string=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}':JSON.stringify(value);
/** Structural routes have no documented server CAS. Host must journal before dispatch.
 * One create is one native request; copying uses the native same-game copy operation.
 * A successful receipt verifies inventory changes, not clone content fidelity. */
export class ModernLevels {
 readonly #binding:AuthoringBinding;readonly #send:(path:string,init?:RequestInit)=>Promise<Response>;
 constructor(binding:AuthoringBinding,send:(path:string,init?:RequestInit)=>Promise<Response>){if(binding.engine!=='modern')throw new AuthoringApiError('unsupported');this.#binding=binding;this.#send=send;}
 async read(signal?:AbortSignal):Promise<Index>{
  const response=await this.#send(`/admin/games/${this.#binding.gameId}/levels`,{signal});if(!response.ok)throw new AuthoringApiError('incomplete-read');const data=await response.json();return this.#index(data);
 }
 async #index(data:any):Promise<Index>{
  if(!data||data.game_id!==this.#binding.gameId||typeof data.can_manipulate_levels!=='boolean'||!Array.isArray(data.levels)||data.levels.length>500||data.levels.some((row:Row)=>!row||!positive(row.level_id)||!positive(row.level_number)||typeof row.level_name!=='string')||new Set(data.levels.map((row:Row)=>row.level_id)).size!==data.levels.length||new Set(data.levels.map((row:Row)=>row.level_number)).size!==data.levels.length)throw new AuthoringApiError('incomplete-read');
  const levels=[...data.levels].sort((a:Row,b:Row)=>a.level_number-b.level_number);if(levels.some((row:Row,index:number)=>row.level_number!==index+1))throw new AuthoringApiError('incomplete-read');
  const value={...data,levels};delete value.version;const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical({binding:this.#binding,index:value})));
  return {...value,version:'modern-observed:level-index-v1:'+Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('')} as Index;
 }
 async request(path:string,init:RequestInit={}):Promise<Response|undefined>{
  const root=`/admin/games/${this.#binding.gameId}/levels`,method=(init.method??'GET').toUpperCase(),remove=path.match(new RegExp(`^${root}/([1-9]\\d*)$`));
  if(path===root&&method==='GET'){
   // Reading a list is also used by bounded UI projections. A response that
   // cannot prove a complete structural inventory must remain readable, but
   // receives no locally issued revision usable by structural proposals.
   const response=await this.#send(path,init);if(!response.ok)return response;
   try{return Response.json(await this.#index(await response.clone().json()));}catch{return response;}
  }
  if(!(path===root&&method==='POST')&&!(path===root+'/copy'&&method==='POST')&&!(remove&&method==='DELETE'))return undefined;
  let body:Record<string,unknown>={};try{if(init.body!==undefined&&init.body!==null)body=JSON.parse(String(init.body));}catch{throw new AuthoringApiError('unsupported');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new AuthoringApiError('unsupported');
  const copy=path===root+'/copy',count=copy?body.count:1;
  if(remove?Object.keys(body).length:copy?(Object.keys(body).some(key=>!['from_level_id','count'].includes(key))||!positive(body.from_level_id)||!positive(count)||count>20):(Object.keys(body).some(key=>key!=='count')||body.count!==1))throw new AuthoringApiError('unsupported');
  const before=await this.read(init.signal??undefined),expected=new Headers(init.headers).get('X-Authoring-Expected-Revision');if(!expected||expected!==before.version)return new Response(null,{status:409});
  if(!before.can_manipulate_levels)throw new AuthoringApiError('unsupported');const id=remove?Number(remove[1]):copy?body.from_level_id:undefined;
  if(id!==undefined&&!before.levels.some(row=>row.level_id===id))throw new AuthoringApiError('invalid-scope');
  if((await this.read(init.signal??undefined)).version!==before.version)return new Response(null,{status:409});
  // The client revision fences preflight only; never forward it as a server CAS token.
  let acknowledged=false;try{const response=await this.#send(path,{method,signal:init.signal,headers:{'Content-Type':'application/json'},...(remove?{}:{body:JSON.stringify(copy?body:{})})});if(!response.ok)return response;acknowledged=true;}catch{/* A dispatch may have committed; read once, never retry. */}
  try{
   const after=await this.read(init.signal??undefined),old=new Set(before.levels.map(row=>row.level_id)),created=after.levels.filter(row=>!old.has(row.level_id));
   if(remove){const projected=before.levels.filter(row=>row.level_id!==id).map((row,index)=>({...row,level_number:index+1}));if(canonical(after.levels)!==canonical(projected))throw new Error();}
   else if(created.length!==count||after.levels.length!==before.levels.length+Number(count)||canonical(after.levels.slice(0,before.levels.length))!==canonical(before.levels))throw new Error();
   return Response.json({...after,created,verification:{inventory:true,content:copy?'native-copy-not-independently-verified':'not-applicable',acknowledged},warnings:['structural-no-server-cas',...(copy?['native-copy-content-requires-review']:[])]});
  }catch{throw new AuthoringApiError('unknown-after-dispatch');}
 }
}
