import {AuthoringApiError,sameAuthoringBinding,type AuthoringBinding} from './authoring-api.ts';
import {legacyDocument,legacyNodes,type LegacyPage,type LegacyRecipe,type LegacySessionPort} from './legacy-authoring.ts';
import type {DefaultTreeAdapterMap} from 'parse5';
type Node=DefaultTreeAdapterMap['node'];
const attr=(node:Node,name:string)=>'attrs' in node?node.attrs.find(row=>row.name===name)?.value:undefined;
const tag=(node:Node)=>'tagName' in node?node.tagName:'';

/** Observed file references, not a claim that the uploader lists every file. */
export function parseLegacyFileReferences(page:LegacyPage,binding:AuthoringBinding) {
  const path=`/Administration/Games/FileUploader.aspx?gid=${binding.gameId}`;
  const root=legacyDocument(page,binding,path),bases=[...new Set(page.html.match(new RegExp(`https://d[1-9]\\d*\\.endata\\.cx/data/games/${binding.gameId}(?=[/"'<>\\s?#]|$)`,'g'))??[])];
  const references:{url:string;sourceHref:string;filename:string;bytes:null;sha256:null}[]=[],seen=new Set<string>();
  for(const node of legacyNodes(root).filter(node=>tag(node)==='a')) {
    const href=attr(node,'href');if(!href)continue;
    let url:URL;try{url=new URL(href,page.url);}catch{continue;}
    const base=bases.find(base=>url.href.startsWith(base+'/'));if(!base||url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash)continue;
    let filename:string;try{filename=decodeURIComponent(url.pathname.slice(new URL(base).pathname.length+1));}catch{continue;}
    if(!filename||filename.length>255||/[\\/\u0000-\u001f]/.test(filename)||['.','..'].includes(filename)||seen.has(url.href))continue;
    seen.add(url.href);references.push({url:url.href,sourceHref:href,filename,bytes:null,sha256:null});
  }
  return {game_id:binding.gameId,binding:{engine:binding.engine,domain:binding.domain,gameId:binding.gameId},source:path,storageBases:bases,files:references,coverage:{complete:false,kind:'observed-uploader-links',resourceBytesRead:false},upload:{available:false,reason:'multipart-dispatch-and-readback-not-verified'},posterAssignment:{state:'unknown',available:false},limitations:['No file link does not prove an empty storage.','Uploader HTML/hidden controls are not exported.','Observed URLs are references; their resource bytes, content type and integrity have not been read.']};
}

/** Keep exact scenario block slices separate from normalized display text. */
export function parseLegacyScenarioExport(page:LegacyPage,binding:AuthoringBinding) {
  const path=`/GameScenario.aspx?gid=${binding.gameId}`,root=legacyDocument(page,binding,path);
  const blocks=legacyNodes(root).filter(node=>(attr(node,'class')??'').split(/\s+/).includes('scenarioBlock')).map(node=>{
    const location='sourceCodeLocation' in node?node.sourceCodeLocation:undefined;
    if(!location||!Number.isSafeInteger(location.startOffset)||!Number.isSafeInteger(location.endOffset))throw new AuthoringApiError('incomplete-read');
    return {html:page.html.slice(location.startOffset,location.endOffset),sourceStart:location.startOffset,sourceEnd:location.endOffset};
  });
  return {game_id:binding.gameId,source:path,blocks,coverage:{complete:false,kind:'readable-scenario-overview',editorSnapshot:false},limitations:['A scenario overview can omit IDs, recipients, hidden settings and inaccessible content.','Zero extracted blocks does not establish an empty game.','No server write, migration or full backup is performed.']};
}

export class LegacyFiles {
  readonly #session:LegacySessionPort;readonly #binding:AuthoringBinding;
  constructor(session:LegacySessionPort){this.#session=session;this.#binding=Object.freeze({...session.binding});}
  async request(path:string,init:RequestInit={}):Promise<Response|undefined> {
    if(path===`/admin/games/${this.#binding.gameId}/files/upload`&&(init.method??'GET').toUpperCase()==='POST'){
      if(!this.#session.supportsFileUpload)throw new AuthoringApiError('unsupported');
      const input=JSON.parse(String(init.body)) as {filename:string;mime:string;base64:string};
      if(!/^[-\w.]+\.(css|png|jpg|gif)$/.test(input.filename)||!['text/css','image/png','image/jpeg','image/gif'].includes(input.mime)||typeof input.base64!=='string'||input.base64.length>14_000_000)throw new AuthoringApiError('unsupported');
      if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('session-changed');
      const native=`/Administration/Games/FileUploader.aspx?gid=${this.#binding.gameId}`;
      const page=await this.#session.dispatch({kind:'file-inventory-read',effect:'read',method:'GET',path:native},init.signal??undefined);
      const upload=parseLegacyUploadForm(page,this.#binding);
      await this.#session.dispatch({kind:'file-upload',effect:'mutation',method:'POST',path:native,upload:{...upload,...input}},init.signal??undefined);
      if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('unknown-after-dispatch');
      return Response.json({status:'dispatched',verification:'resource-bytes-required'});
    }
    if((init.method??'GET').toUpperCase()!=='GET')return;
    const root=`/admin/games/${this.#binding.gameId}`;
    const inventory=path===root+'/files',scenario=path===root+'/scenario-export';if(!inventory&&!scenario)return;
    if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('session-changed');
    init.signal?.throwIfAborted();
    const recipe:LegacyRecipe={kind:inventory?'file-inventory-read':'scenario-export-read',effect:'read',method:'GET',path:inventory?`/Administration/Games/FileUploader.aspx?gid=${this.#binding.gameId}`:`/GameScenario.aspx?gid=${this.#binding.gameId}`};
    const page=await this.#session.dispatch(Object.freeze(recipe),init.signal??undefined);
    if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('session-changed');
    return Response.json(inventory?parseLegacyFileReferences(page,this.#binding):parseLegacyScenarioExport(page,this.#binding));
  }
}

/** Accept only an unambiguous native multipart form; never guess script uploader endpoints. */
export function parseLegacyUploadForm(page:LegacyPage,binding:AuthoringBinding){
 const path=`/Administration/Games/FileUploader.aspx?gid=${binding.gameId}`,root=legacyDocument(page,binding,path);
 const forms=legacyNodes(root).filter(n=>tag(n)==='form'&&(attr(n,'method')??'').toLowerCase()==='post'&&(attr(n,'enctype')??'').toLowerCase()==='multipart/form-data'&&new URL(attr(n,'action')||path,page.url).href===page.url);
 if(forms.length!==1)throw new Error('Unsupported uploader: expected one observed native multipart form');
 const nodes=legacyNodes(forms[0]),files=nodes.filter(n=>tag(n)==='input'&&attr(n,'type')==='file'&&attr(n,'disabled')===undefined);
 const submits=nodes.filter(n=>['input','button'].includes(tag(n))&&['submit','image'].includes(attr(n,'type')??(tag(n)==='button'?'submit':''))&&attr(n,'disabled')===undefined);
 if(files.length!==1||submits.length!==1||!attr(files[0],'name')||!attr(submits[0],'name'))throw new Error('Unsupported uploader: ambiguous file field or submit action');
 const controls:[string,string][]=[];
 for(const n of nodes){if(!['input','button','select','textarea'].includes(tag(n))||attr(n,'disabled')!==undefined)continue;const name=attr(n,'name'),type=attr(n,'type');if(!name||n===files[0])continue;if(n===submits[0]){if(type==='image')controls.push([name+'.x','1'],[name+'.y','1']);else controls.push([name,attr(n,'value')??'']);continue;}if(type!=='hidden')throw new Error('Unsupported uploader: additional input requires explicit handling');controls.push([name,attr(n,'value')??'']);}
 return {field:attr(files[0],'name')!,controls};
}
