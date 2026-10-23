import {legacyGameSettingNames,validateGameSettingsPatch,checkGameSettingsBefore} from './game-settings.ts';
import {parse,type DefaultTreeAdapterMap} from 'parse5';
import {AuthoringApiError,sameAuthoringBinding,type AuthoringBinding} from './authoring-api.ts';
import type {LegacySessionPort,LegacyPage,LegacyRecipe} from './legacy-authoring.ts';
type Node=DefaultTreeAdapterMap['node'];
const attr=(node:Node,name:string)=>'attrs'in node?node.attrs.find(a=>a.name===name)?.value:undefined;
const tag=(node:Node)=>'tagName'in node?node.tagName:'';
const all=(node:Node):Node[]=>[node,...('childNodes'in node?node.childNodes.flatMap(all):[])];
const text=(node:Node):string=>'value'in node?node.value:'childNodes'in node?node.childNodes.map(text).join(''):'';
const fail=():never=>{throw new AuthoringApiError('incomplete-read');};
export interface LegacyGameForm {description:string;title:string;controls:[string,string][];fieldState:unknown[];settings:Record<string,string|boolean>;editableFields:string[];controlDefinitions:Record<string,{type:string;values:string[];booleanValues?:{true:string;false:string}}> }

/** Full successful-controls codec. Hidden state stays inside the adapter and never enters model DTOs. */
export function parseLegacyGameForm(page:LegacyPage,binding:AuthoringBinding):LegacyGameForm {
  const expected=`https://${binding.domain}/Administration/Games/GameEditor.aspx?gid=${binding.gameId}&action=edit`;
  if(page.status!==200||page.url!==expected||page.html.length>2_000_000)return fail();
  const root=parse(page.html),nodes=all(root),forms=nodes.filter(n=>tag(n)==='form'&&(attr(n,'method')??'get').toLowerCase()==='post'&&(()=>{try{const u=new URL(attr(n,'action')??'',expected);return u.origin===`https://${binding.domain}`&&u.pathname==='/Administration/Games/GameEditor.aspx'&&!u.search&&!u.hash;}catch{return false;}})());
  if(forms.length!==1)return fail();const form=forms[0],formId=attr(form,'id');
  const owner=(node:Node)=>{const explicit=attr(node,'form');if(explicit!==undefined)return !!formId&&explicit===formId;let parent='parentNode'in node?node.parentNode:null;while(parent&&tag(parent)!=='form')parent='parentNode'in parent?parent.parentNode:null;return parent===form;};
  const disabled=(node:Node)=>{if(attr(node,'disabled')!==undefined)return true;let parent='parentNode'in node?node.parentNode:null;while(parent&&parent!==form){if(tag(parent)==='optgroup'&&attr(parent,'disabled')!==undefined)return true;if(tag(parent)==='fieldset'&&attr(parent,'disabled')!==undefined){const legend='childNodes'in parent?parent.childNodes.find(n=>tag(n)==='legend'):undefined;if(!legend||!all(legend).includes(node))return true;}parent='parentNode'in parent?parent.parentNode:null;}return false;};
  const controls:[string,string][]=[];const fieldState:unknown[]=[];let submitters=0;
  const elements=nodes.filter(n=>['input','select','textarea','button'].includes(tag(n))&&attr(n,'name')&&owner(n));
  const values=(node:Node):string[]=>{
    const type=(attr(node,'type')??'text').toLowerCase();
    if(tag(node)==='select'){const options=all(node).filter(n=>tag(n)==='option'),selected=options.filter(n=>attr(n,'selected')!==undefined),chosen=selected.length?(attr(node,'multiple')===undefined?selected.slice(-1):selected):attr(node,'multiple')===undefined?options.filter(n=>!disabled(n)).slice(0,1):[];return chosen.filter(n=>!disabled(n)).map(n=>attr(n,'value')??text(n));}
    return [tag(node)==='textarea'?text(node):attr(node,'value')??(['checkbox','radio'].includes(type)?'on':'')];
  };
  for(const node of elements){
    const name=attr(node,'name')!,type=(attr(node,'type')??(tag(node)==='button'?'submit':'text')).toLowerCase(),off=disabled(node),value=values(node);
    if(type==='password'||type==='file')return fail();
    if(!name.startsWith('__'))fieldState.push({name,type,disabled:off,checked:attr(node,'checked')!==undefined,values:value,...(tag(node)==='select'?{options:all(node).filter(option=>tag(option)==='option').map(option=>({value:attr(option,'value')??text(option),disabled:disabled(option)}))}:{})});
    if(off)continue;
    if(['submit','image','button','reset'].includes(type)){if(name==='btnUpdate'&&type==='image'){submitters++;controls.push(['btnUpdate.x','1'],['btnUpdate.y','1']);}continue;}
    if(['checkbox','radio'].includes(type)&&attr(node,'checked')===undefined)continue;
    for(const item of value)controls.push([name,item]);
  }
  const get=(name:string)=>controls.filter(row=>row[0]===name).map(row=>row[1]);
  if(submitters!==1||get('gid').length!==1||get('gid')[0]!==String(binding.gameId)||get('action').length!==1||get('action')[0]!=='update'||get('Descr').length!==1||get('GameTitle').length!==1)return fail();
  // Ambiguous duplicate names for the patched fields cannot be fixed by silently choosing one.
  if(elements.filter(n=>attr(n,'name')==='Descr').length!==1||elements.filter(n=>attr(n,'name')==='GameTitle').length!==1)return fail();
  const settings:Record<string,string|boolean>={},editableFields:string[]=[],controlDefinitions:LegacyGameForm['controlDefinitions']={};
  for(const [key,name]of Object.entries(legacyGameSettingNames)){
    const group=elements.filter(n=>attr(n,'name')===name);if(!group.length||group.some(n=>disabled(n)||attr(n,'readonly')!==undefined||(attr(n,'type')??'').toLowerCase()==='hidden'))continue;
    const type=(attr(group[0],'type')??(tag(group[0])==='select'?'select':'text')).toLowerCase();
    if(group.length>1&&type!=='radio'||group.some(n=>(attr(n,'type')??'text').toLowerCase()!==type)&&type==='radio')continue;
    const available=type==='radio'?group.map(n=>attr(n,'value')??'on'):tag(group[0])==='select'?all(group[0]).filter(n=>tag(n)==='option'&&!disabled(n)).map(n=>attr(n,'value')??text(n)):[];
    if(type==='checkbox'){
      if(!['show_finish_place','hide_game_descr','hide_players_list','hide_game_from_calendar','hide_levels_names','is_available_after_finished'].includes(key)||group.length!==1)continue;settings[key]=attr(group[0],'checked')!==undefined;
      controlDefinitions[key]={type,values:[attr(group[0],'value')??'on']};
    }else if(key==='is_moderated'){
      if(type!=='radio'||!available.includes('true')||!available.includes('false')||get(name).length!==1)continue;
      settings[key]=get(name)[0]==='true';controlDefinitions[key]={type,values:available,booleanValues:{true:'true',false:'false'}};
    }else{if(get(name).length!==1)continue;settings[key]=get(name)[0];controlDefinitions[key]={type,values:available};}
    editableFields.push(key);
  }
  return {description:get('Descr')[0],title:get('GameTitle')[0],controls,fieldState,settings,editableFields,controlDefinitions};
}
async function version(binding:AuthoringBinding,form:LegacyGameForm):Promise<string>{const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({binding,fieldState:form.fieldState,controlDefinitions:form.controlDefinitions})));return 'legacy-observed:game:'+Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');}
const preservation=(binding:AuthoringBinding,form:LegacyGameForm)=>version(binding,{...form,fieldState:form.fieldState.filter(row=>(row as {name:string}).name!=='Descr')});
function dto(binding:AuthoringBinding,form:LegacyGameForm,revision:string,preservationVersion:string){return {game_id:binding.gameId,game:{id:binding.gameId,...form.settings},editable_fields:form.editableFields,setting_options:form.controlDefinitions,version:revision,presentation:{description:{state:'known',value:form.description,source:'legacy-Descr'},important:{state:'unknown',write_available:false,reason:'native-wire-mapping-not-verified'},poster:{state:'unknown',write_available:false,reason:'native-assignment-and-display-not-verified'}},legacy_evidence:{complete:false,known_fields:Object.keys(form.settings).map(key=>'game.'+key),full_form_retained_in_adapter:true,revision:'observed',preservation_version:preservationVersion,conditional_write:false}};}

export class LegacyGame {
  readonly #session:LegacySessionPort;readonly #binding:AuthoringBinding;
  constructor(session:LegacySessionPort){this.#session=session;this.#binding={...session.binding};}
  async #dispatch(recipe:LegacyRecipe,signal?:AbortSignal){if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('session-changed');signal?.throwIfAborted();const response=await this.#session.dispatch(Object.freeze(recipe),signal);if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('session-changed');return response;}
  async #read(signal?:AbortSignal){const path=`/Administration/Games/GameEditor.aspx?gid=${this.#binding.gameId}&action=edit`;return parseLegacyGameForm(await this.#dispatch({kind:'game-editor-read',effect:'read',method:'GET',path},signal),this.#binding);}
  async request(path:string,init:RequestInit={}):Promise<Response|undefined>{
    if(path!==`/admin/games/${this.#binding.gameId}`)return;const method=(init.method??'GET').toUpperCase();if(!['GET','PUT','PATCH'].includes(method))return;
    const before=await this.#read(init.signal??undefined),revision=await version(this.#binding,before);
    if(method==='GET')return Response.json(dto(this.#binding,before,revision,await preservation(this.#binding,before)));
    if(typeof init.body!=='string')throw new AuthoringApiError('unsupported');let patch:Record<string,unknown>;try{patch=JSON.parse(init.body);}catch{throw new AuthoringApiError('unsupported');}
    patch=validateGameSettingsPatch('legacy',patch);checkGameSettingsBefore('legacy',dto(this.#binding,before,revision,await preservation(this.#binding,before)),patch);
    const expected=new Headers(init.headers).get('If-Match');if(!expected)return Response.json({error:'legacy-observed-revision-required'},{status:428});if(expected!==revision)return Response.json({error:'conflict'},{status:409});
    const body=new URLSearchParams(before.controls),changedNames:string[]=[];
    for(const [key,value]of Object.entries(patch)){
      const name=legacyGameSettingNames[key as keyof typeof legacyGameSettingNames],definition=before.controlDefinitions[key];
      if(!definition)throw new AuthoringApiError('unsupported');changedNames.push(name);
      if(definition.type==='checkbox'){body.delete(name);if(value)body.append(name,definition.values[0]);}
      else {const wire=typeof value==='boolean'?definition.booleanValues?.[String(value)as 'true'|'false']:String(value).replace(/\r?\n/g,'\r\n');if(wire===undefined||definition.values.length&&!definition.values.includes(wire))throw new AuthoringApiError('unsupported');body.set(name,wire);}
    }
    // Exactly one dispatch. Form POST acknowledgment may be an opaque redirect.
    try{await this.#dispatch({kind:'game-update',effect:'mutation',method:'POST',path:'/Administration/Games/GameEditor.aspx',body:body.toString()},init.signal??undefined);}catch{/* Independent read-back can establish the result; never resend. */}
    let after:LegacyGameForm;try{after=await this.#read(init.signal??undefined);}catch{throw new AuthoringApiError('unknown-after-dispatch');}
    const preservationVersion=await preservation(this.#binding,after);
    const siblings=(form:LegacyGameForm)=>({state:form.fieldState.filter(row=>!changedNames.includes((row as {name:string}).name)),controls:form.controls.filter(([name])=>!changedNames.includes(name)&&!name.startsWith('__'))});
    if(Object.entries(patch).some(([key,value])=>after.settings[key]!== (typeof value==='string'?value.replace(/\r\n|\r/g,'\n'):value))||JSON.stringify(siblings(before))!==JSON.stringify(siblings(after))||JSON.stringify(before.controlDefinitions)!==JSON.stringify(after.controlDefinitions))throw new AuthoringApiError('unknown-after-dispatch');
    return Response.json(dto(this.#binding,after,await version(this.#binding,after),preservationVersion));
  }
}
