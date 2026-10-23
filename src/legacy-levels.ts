import {AuthoringApiError, sameAuthoringBinding, type AuthoringBinding} from './authoring-api.ts';
import {legacyDocument, legacyNodes, sourceFormRanges, parseLegacyLevelIndex, type LegacyPage, type LegacyRecipe, type LegacySessionPort} from './legacy-authoring.ts';
import type {DefaultTreeAdapterMap} from 'parse5';

type Node=DefaultTreeAdapterMap['node'];
const attr=(node:Node,name:string)=>'attrs'in node?node.attrs.find(a=>a.name===name)?.value:undefined;
const tag=(node:Node)=>'tagName'in node?node.tagName:'';
const fail=():never=>{throw new AuthoringApiError('incomplete-read');};
type State={not_dismissed_level_ids:number[];dismissed_level_ids:number[]};
/** Form token ownership also covers the manager's malformed table/form nesting. */
function managerState(page:LegacyPage,binding:AuthoringBinding,levels:Level[]):State|undefined {
  const all=legacyNodes(legacyDocument(page,binding,`/Administration/Games/LevelManager.aspx?gid=${binding.gameId}`));
  const ranges=sourceFormRanges(page.html),forms=all.filter(node=>tag(node)==='form');
  const names=['LevelsDismissForm','LevelsRestoreForm'];
  if(!forms.some(node=>names.includes(attr(node,'name')??attr(node,'id')??'')))return undefined;
  const groups=names.map((name,index)=>{
    const matches=forms.filter(node=>attr(node,'name')===name||attr(node,'id')===name);if(matches.length===0)return [];if(matches.length!==1)return fail();const form=matches[0];
    const location='sourceCodeLocation'in form?form.sourceCodeLocation:undefined;const start=location&&'startTag'in location?(location.startTag as {endOffset:number}|undefined)?.endOffset:undefined;
    const range=ranges.find(row=>row.start===start);if(!range||(attr(form,'method')??'get').toLowerCase()!=='get')return fail();
    const action=new URL(attr(form,'action')||'LevelManager.aspx',`https://${binding.domain}/Administration/Games/`);if(action.href!==`https://${binding.domain}/Administration/Games/LevelManager.aspx`)return fail();
    const inside=(node:Node)=>{const offset='sourceCodeLocation'in node?node.sourceCodeLocation?.startOffset:undefined;return offset!==undefined&&offset>=range.start&&offset<range.end;};
    const controls=all.filter(node=>['input','select','textarea','button'].includes(tag(node))&&inside(node));
    const select=index===0?'ddlNotDismissedLevels':'ddlDismissedLevels',submit=index===0?'btnDismissLevels':'btnRestoreLevels';
    if(controls.some(node=>attr(node,'form')!==undefined||attr(node,'disabled')!==undefined||!['gid','levels',select,submit].includes(attr(node,'name')??'')))return fail();
    for(const [key,value]of [['gid',String(binding.gameId)],['levels',index===0?'dismiss':'restore']]){const rows=controls.filter(node=>attr(node,'name')===key);if(rows.length!==1||tag(rows[0])!=='input'||attr(rows[0],'type')!=='hidden'||attr(rows[0],'value')!==value)return fail();}
    const selects=controls.filter(node=>attr(node,'name')===select),buttons=controls.filter(node=>attr(node,'name')===submit);
    if(selects.length!==1||tag(selects[0])!=='select'||buttons.length!==1||tag(buttons[0])!=='input'||attr(buttons[0],'type')!=='image')return fail();
    const ids=legacyNodes(selects[0]).filter(node=>tag(node)==='option').map(node=>{const value=attr(node,'value');if(!value||!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value))||attr(node,'disabled')!==undefined)return fail();return Number(value);});
    if(new Set(ids).size!==ids.length)return fail();return ids.sort((a,b)=>a-b);
  });
  const ids=[...groups[0],...groups[1]];if(new Set(ids).size!==ids.length||JSON.stringify([...ids].sort((a,b)=>a-b))!==JSON.stringify(levels.map(row=>row.level_id).sort((a,b)=>a-b)))return fail();
  return {not_dismissed_level_ids:groups[0],dismissed_level_ids:groups[1]};
}
function confirmation(page:LegacyPage,binding:AuthoringBinding,path:string,action:'dismiss'|'restore',id:number):string {
  const root=legacyDocument(page,binding,path),field=action==='dismiss'?'ddlnotdismissedlevels':'ddldismissedlevels';
  const links=legacyNodes(root).filter(node=>tag(node)==='a').flatMap(node=>{
    const href=attr(node,'href');if(!href)return [];let url:URL;try{url=new URL(href,`https://${binding.domain}/Administration/Games/`);}catch{return [];}
    if(url.pathname!=='/Administration/Games/LevelManager.aspx'||!url.searchParams.has('confirm'))return [];
    const keys=[...url.searchParams.keys()];if(url.origin!==`https://${binding.domain}`||url.hash||keys.length!==4||new Set(keys).size!==4||keys.some(key=>!['gid','levels','confirm',field].includes(key))||url.searchParams.get('gid')!==String(binding.gameId)||url.searchParams.get('levels')!==action||url.searchParams.get('confirm')!=='1'||url.searchParams.get(field)!==String(id))return fail();
    return [url.pathname+url.search];
  });if(links.length!==1)return fail();return links[0];
}
type Level={level_id:number;level_number:number;level_name:string};
async function version(binding:AuthoringBinding,levels:Level[],state?:State) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({profile:'legacy-level-index-v1',binding,levels,state})));
  return 'legacy-observed:level-index-v1:'+Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
/** Stable-ID level operations, with observed inventory preflight and no GET retries. */
export class LegacyLevels {
  readonly #session:LegacySessionPort;readonly #binding:AuthoringBinding;
  constructor(session:LegacySessionPort){this.#session=session;this.#binding=Object.freeze({...session.binding});}
  async #dispatch(recipe:LegacyRecipe,signal?:AbortSignal){
    if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('session-changed');
    signal?.throwIfAborted();const page=await this.#session.dispatch(Object.freeze(recipe),signal);
    if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('session-changed');return page;
  }
  async read(signal?:AbortSignal){
    const binding=this.#binding,path=`/Administration/Games/LevelManager.aspx?gid=${binding.gameId}`;
    const page=await this.#dispatch({kind:'level-index',effect:'read',method:'GET',path},signal),levels=parseLegacyLevelIndex(page,binding),state=managerState(page,binding,levels);
    return {game_id:binding.gameId,levels,level_state_complete:!!state,...state,version:await version(binding,levels,state)};
  }
  async request(path:string,init:RequestInit={}):Promise<Response|undefined>{
    const root=`/admin/games/${this.#binding.gameId}/levels`,method=(init.method??'GET').toUpperCase();
    if(path===root&&method==='GET')return Response.json(await this.read(init.signal??undefined));
    const remove=path.match(new RegExp(`^${root}/([1-9]\\d*)$`)),move=path.match(new RegExp(`^${root}/([1-9]\\d*)/position$`)),state=path.match(new RegExp(`^${root}/([1-9]\\d*)/(dismiss|restore)$`));
    const names=path===root+'/names'&&method==='PUT';
    const copy=path===root+'/copy'&&method==='POST';
    if(!(path===root&&method==='POST')&&!copy&&!names&&!(remove&&method==='DELETE')&&!(move&&method==='PUT')&&!(state&&method==='POST'))return undefined;
    const expected=new Headers(init.headers).get('X-Authoring-Expected-Revision');
    const before=await this.read(init.signal??undefined);if(!expected||expected!==before.version)return new Response(null,{status:409});
    let body:any={};try{if(init.body!==undefined&&init.body!==null)body=JSON.parse(String(init.body));}catch{throw new AuthoringApiError('unsupported');}
    if(!body||typeof body!=='object'||Array.isArray(body))throw new AuthoringApiError('unsupported');
    if(state){
      if(Object.keys(body).length)throw new AuthoringApiError('unsupported');
      const id=Number(state[1]),action=state[2]as 'dismiss'|'restore',from=action==='dismiss'?'not_dismissed_level_ids':'dismissed_level_ids',to=action==='dismiss'?'dismissed_level_ids':'not_dismissed_level_ids';
      if(!before.level_state_complete||!before[from]?.includes(id))throw new AuthoringApiError('invalid-scope');
      const select=action==='dismiss'?'ddlNotDismissedLevels':'ddlDismissedLevels',submit=action==='dismiss'?'btnDismissLevels':'btnRestoreLevels';
      const initial=`/Administration/Games/LevelManager.aspx?gid=${this.#binding.gameId}&levels=${action}&${select}=${id}&${submit}.x=1&${submit}.y=1`;
      const confirm=confirmation(await this.#dispatch({kind:'level-state-confirm-read',effect:'read',method:'GET',path:initial},init.signal??undefined),this.#binding,initial,action,id);
      const fresh=await this.read(init.signal??undefined);if(fresh.version!==before.version)return new Response(null,{status:409});
      try{await this.#dispatch({kind:action==='dismiss'?'level-dismiss':'level-restore',effect:'mutation',method:'GET',path:confirm},init.signal??undefined);}catch{/* Reconcile independently; never retry confirmation. */}
      try{const after=await this.read(init.signal??undefined);if(!after.level_state_complete||JSON.stringify(before.levels)!==JSON.stringify(after.levels)||JSON.stringify(before[from]!.filter(value=>value!==id))!==JSON.stringify(after[from])||JSON.stringify([...before[to]!,id].sort((a,b)=>a-b))!==JSON.stringify(after[to]))throw new Error();return Response.json({...after,warnings:['legacy-no-server-cas']});}catch{throw new AuthoringApiError('unknown-after-dispatch');}
    }
    let recipe:LegacyRecipe;let projected:Level[]|undefined;
    const base=`/Administration/Games/LevelManager.aspx?gid=${this.#binding.gameId}`;
    if(names){
      if(Object.keys(body).length!==1||!Array.isArray(body.names)||!body.names.length||body.names.length>200||body.names.some((row:any)=>!row||typeof row!=='object'||Object.keys(row).sort().join(',')!=='level_id,level_name'||!Number.isSafeInteger(row.level_id)||!before.levels.some(level=>level.level_id===row.level_id)||typeof row.level_name!=='string'||!row.level_name.trim()||row.level_name.length>1000)||new Set(body.names.map((row:any)=>row.level_id)).size!==body.names.length)throw new AuthoringApiError('unsupported');
      projected=before.levels.map(level=>({...level,level_name:body.names.find((row:any)=>row.level_id===level.level_id)?.level_name??level.level_name}));
      const fields=new URLSearchParams(projected.map(level=>['txtLevelName_'+level.level_id,level.level_name]));
      recipe={kind:'level-names-update',effect:'mutation',method:'POST',path:base+'&level_names=update',body:fields.toString()};
    }else if(copy){
      if(Object.keys(body).some(key=>!['from_level_id','count'].includes(key))||!Number.isSafeInteger(body.count)||body.count<1||body.count>20||!Number.isSafeInteger(body.from_level_id)||!before.levels.some(level=>level.level_id===body.from_level_id))throw new AuthoringApiError('unsupported');
      recipe={kind:'level-copy',effect:'mutation',method:'GET',path:base+`&levels=copy&ddlCopyCount=${body.count}&ddlCopyFrom=${body.from_level_id}&btnCopyLevel.x=1&btnCopyLevel.y=1`};
    }else if(path===root){
      if(Object.keys(body).some(key=>key!=='count')||!Number.isSafeInteger(body.count)||body.count<1||body.count>20)throw new AuthoringApiError('unsupported');
      recipe={kind:'level-create',effect:'mutation',method:'GET',path:base+`&levels=create&ddlCreateLevelsNum=${body.count}&btnCreateLevels.x=1&btnCreateLevels.y=1`};
    }else {
      const id=Number((remove??move)![1]),matches=before.levels.filter(level=>level.level_id===id);if(matches.length!==1)throw new AuthoringApiError('incomplete-read');
      if(remove){
        if(Object.keys(body).length)throw new AuthoringApiError('unsupported');
        recipe={kind:'level-delete',effect:'mutation',method:'GET',path:base+`&levels=delete&ddlDeleteLevels=${matches[0].level_number}&btnDeleteLevels.x=1&btnDeleteLevels.y=1`};
        projected=before.levels.filter(level=>level.level_id!==id);
      }else{
        const after=body.after_level_id;if(Object.keys(body).some(key=>key!=='after_level_id')||!Number.isSafeInteger(after)||after<1||after===id||!before.levels.some(level=>level.level_id===after))throw new AuthoringApiError('unsupported');
        projected=before.levels.filter(level=>level.level_id!==id);projected.splice(projected.findIndex(level=>level.level_id===after)+1,0,matches[0]);
        recipe={kind:'level-move',effect:'mutation',method:'GET',path:base+`&levels=put&ddlPutLevel=${id}&ddlPutLevelAfter=${after}&btnPutLevel.x=1&btnPutLevel.y=1`};
      }
      projected=projected.map((level,index)=>({...level,level_number:index+1}));
    }
    // Read the full index again just before a destructive ordinal GET.
    const fresh=await this.read(init.signal??undefined);if(fresh.version!==before.version)return new Response(null,{status:409});
    try{await this.#dispatch(recipe,init.signal??undefined);}catch{/* Only an independent read can establish the outcome. */}
    try{
      const after=await this.read(init.signal??undefined);
      if(projected){if(JSON.stringify(after.levels)!==JSON.stringify(projected))throw new Error();}
      else{
        const oldIds=new Set(before.levels.map(level=>level.level_id)),added=after.levels.filter(level=>!oldIds.has(level.level_id));
        if(added.length!==body.count||after.levels.length!==before.levels.length+body.count||JSON.stringify(after.levels.slice(0,before.levels.length))!==JSON.stringify(before.levels))throw new Error();
        return Response.json({...after,created:added,verification:{inventory:true,content:copy?'native-copy-not-independently-verified':'not-applicable'},warnings:['legacy-no-server-cas',...(copy?['native-copy-content-requires-review']:[])]});
      }
      return Response.json({...after,warnings:['legacy-no-server-cas']});
    }catch{throw new AuthoringApiError('unknown-after-dispatch');}
  }
}
