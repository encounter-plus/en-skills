import {parse,type DefaultTreeAdapterMap} from 'parse5';
import {AuthoringApiError,type AuthoringBinding} from './authoring-api.ts';
import {sourceFormRanges,type LegacyPage} from './legacy-authoring.ts';
export type ExtraNode=DefaultTreeAdapterMap['node'];
export const extraAttr=(node:ExtraNode,name:string)=>'attrs'in node?node.attrs.find(a=>a.name===name)?.value:undefined;
export const extraTag=(node:ExtraNode)=>'tagName'in node?node.tagName:'';
export const extraNodes=(node:ExtraNode):ExtraNode[]=>[node,...('childNodes'in node?node.childNodes.flatMap(extraNodes):[])];
export const extraText=(node:ExtraNode):string=>'value'in node?node.value:'childNodes'in node?node.childNodes.map(extraText).join(''):'';
export const extraFail=():never=>{throw new AuthoringApiError('incomplete-read');};
export interface ExtraField {name:string;values:string[];type:string;disabled:boolean;checked:boolean;options?:string[];optionLabels?:string[]}
export interface ExtraForm {controls:[string,string][];fields:ExtraField[];submitter:string;action:string}
export function extraTree(page:LegacyPage,binding:AuthoringBinding,path:string):DefaultTreeAdapterMap['document']{if(page.status!==200||new URL(page.url).href!==new URL(path,`https://${binding.domain}`).href||page.html.length>2_000_000)return extraFail();const root=parse(page.html,{sourceCodeLocationInfo:true});if(extraNodes(root).some(n=>extraTag(n)==='input'&&extraAttr(n,'type')==='password'))return extraFail();return root;}
export function extraForm(page:LegacyPage,binding:AuthoringBinding,path:string,required:string[],submitter:(name:string)=>boolean,targetPathname:string,recoveryAllowed:(name:string)=>boolean=()=>false,defaultAction=path):ExtraForm {
 const root=extraTree(page,binding,path),nodes=extraNodes(root),forms=nodes.filter(n=>extraTag(n)==='form'),tag=extraTag,attr=extraAttr;
 const owner=(node:ExtraNode,form:ExtraNode)=>{const explicit=attr(node,'form');if(explicit!==undefined)return !!attr(form,'id')&&explicit===attr(form,'id');let parent='parentNode'in node?node.parentNode:null;while(parent&&tag(parent)!=='form')parent='parentNode'in parent?parent.parentNode:null;return parent===form;};
 const candidates=forms.filter(form=>(attr(form,'method')??'get').toLowerCase()==='post'&&(()=>{try{const u=new URL(attr(form,'action')||defaultAction,`https://${binding.domain}`);return u.origin===`https://${binding.domain}`&&u.pathname===targetPathname&&!u.hash;}catch{return false;}})()&&required.every(name=>nodes.some(node=>attr(node,'name')===name&&owner(node,form))));
 let range:{start:number;end:number}|undefined;
 if(!candidates.length){
  const ranges=sourceFormRanges(page.html),offset=(node:ExtraNode)=>'sourceCodeLocation'in node?node.sourceCodeLocation?.startOffset:undefined;
  for(const candidate of forms){
   const location='sourceCodeLocation'in candidate?candidate.sourceCodeLocation:undefined,source=ranges.find(row=>location&&'startTag'in location&&row.start===(location.startTag as {endOffset:number}|undefined)?.endOffset);
   if(!source||(attr(candidate,'method')??'get').toLowerCase()!=='post')continue;
   const target=new URL(attr(candidate,'action')||defaultAction,`https://${binding.domain}`);
   if(target.origin!==`https://${binding.domain}`||target.pathname!==targetPathname)continue;
   const inside=(node:ExtraNode)=>{const value=offset(node);return value!==undefined&&value>=source.start&&value<source.end;};
   if(required.every(name=>nodes.some(node=>attr(node,'name')===name&&inside(node)))){candidates.push(candidate);range=source;}
  }
 }
 if(candidates.length!==1)return extraFail();const form=candidates[0],action=new URL(attr(form,'action')||defaultAction,`https://${binding.domain}`).pathname+new URL(attr(form,'action')||defaultAction,`https://${binding.domain}`).search;
 const elements=nodes.filter(n=>{if(!['input','select','textarea','button'].includes(tag(n))||!attr(n,'name'))return false;if(attr(n,'form')!==undefined)return owner(n,form);if(!range)return owner(n,form);const offset='sourceCodeLocation'in n?n.sourceCodeLocation?.startOffset:undefined;return offset!==undefined&&offset>=range.start&&offset<range.end;}),fields:ExtraField[]=[],controls:[string,string][]=[];let chosen='';
 const disabled=(node:ExtraNode)=>{if(attr(node,'disabled')!==undefined)return true;let parent='parentNode'in node?node.parentNode:null;while(parent&&parent!==form){if(tag(parent)==='optgroup'&&attr(parent,'disabled')!==undefined)return true;if(tag(parent)==='fieldset'&&attr(parent,'disabled')!==undefined){const legend='childNodes'in parent?parent.childNodes.find(n=>tag(n)==='legend'):undefined;if(!legend||!extraNodes(legend).includes(node))return true;}parent='parentNode'in parent?parent.parentNode:null;}return false;};
 for(const node of elements){
  const name=attr(node,'name')!,type=(attr(node,'type')??(tag(node)==='button'?'submit':'text')).toLowerCase(),off=disabled(node),checked=attr(node,'checked')!==undefined;
  if(['password','file'].includes(type))return extraFail();let values:string[],options:string[]|undefined,optionLabels:string[]|undefined;
  if(tag(node)==='select'){const opts=extraNodes(node).filter(n=>tag(n)==='option'),selected=opts.filter(n=>attr(n,'selected')!==undefined),pick=selected.length?(attr(node,'multiple')===undefined?selected.slice(-1):selected):attr(node,'multiple')===undefined?opts.filter(n=>!disabled(n)).slice(0,1):[];options=opts.filter(n=>!disabled(n)).map(n=>attr(n,'value')??extraText(n));optionLabels=opts.filter(n=>!disabled(n)).map(extraText);values=pick.filter(n=>!disabled(n)).map(n=>attr(n,'value')??extraText(n));}
  else values=[tag(node)==='textarea'?extraText(node):attr(node,'value')??(['checkbox','radio'].includes(type)?'on':'')];
  fields.push({name,values,type,disabled:off,checked,...(options?{options,optionLabels}:{})});if(off)continue;
  if(['submit','image','button','reset'].includes(type)){if(type==='image'&&submitter(name)){if(chosen)return extraFail();chosen=name;controls.push([name+'.x','1'],[name+'.y','1']);}continue;}
  if(['checkbox','radio'].includes(type)&&!checked)continue;for(const value of values)controls.push([name,value]);
 }
 if(!chosen)return extraFail();return {fields,controls,submitter:chosen,action};
}
export function extraValue(form:ExtraForm,name:string):string {const rows=form.fields.filter(row=>row.name===name);if(rows.length!==1||rows[0].values.length!==1)return extraFail();return rows[0].values[0];}
export function extraChecked(form:ExtraForm,name:string):boolean {const rows=form.fields.filter(row=>row.name===name);if(rows.length!==1||rows[0].type!=='checkbox')return extraFail();return rows[0].checked;}
export function extraRadio(form:ExtraForm,name:string):string {const rows=form.fields.filter(row=>row.name===name&&row.checked&&!row.disabled);if(rows.length!==1||rows[0].type!=='radio'||rows[0].values.length!==1)return extraFail();return rows[0].values[0];}
export function extraNumber(form:ExtraForm,name:string,max=Number.MAX_SAFE_INTEGER):number {const raw=extraValue(form,name);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)>max)return extraFail();return Number(raw);}
export async function extraRevision(binding:AuthoringBinding,kind:string,form:ExtraForm){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({binding,kind,fields:form.fields.filter(row=>!row.name.startsWith('__'))})));return 'legacy-observed:'+kind+':'+Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');}
export function extraPreserved(before:ExtraForm,after:ExtraForm,changed:string[]){const normalize=(form:ExtraForm)=>form.controls.filter(([name])=>!name.startsWith('__')&&!changed.includes(name)&&!name.endsWith('.x')&&!name.endsWith('.y'));return JSON.stringify(normalize(before))===JSON.stringify(normalize(after));}
