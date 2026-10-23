import {parse, type DefaultTreeAdapterMap} from 'parse5';
import {AuthoringApiError,sameAuthoringBinding,type AuthoringBinding} from './authoring-api.ts';
import {parseLegacyLevelIndex,sourceFormRanges,type LegacySessionPort,type LegacyPage,type LegacyRecipe} from './legacy-authoring.ts';
import {parseLegacyRoster} from './legacy-statistics.ts';

type Node=DefaultTreeAdapterMap['node'];
const attr=(node:Node,name:string)=>'attrs'in node?node.attrs.find(a=>a.name===name)?.value:undefined;
const tag=(node:Node)=>'tagName'in node?node.tagName:'';
const all=(node:Node):Node[]=>[node,...('childNodes'in node?node.childNodes.flatMap(all):[])];
const text=(node:Node):string=>'value'in node?node.value:'childNodes'in node?node.childNodes.map(text).join(''):'';
const suffix=(node:Node,value:string)=>(attr(node,'id')??'').endsWith(value);
const fail=():never=>{throw new AuthoringApiError('incomplete-read');};
const unsupported=():never=>{throw new AuthoringApiError('unsupported');};
function integer(value:unknown,min=1,max=Number.MAX_SAFE_INTEGER):number {if(typeof value==='string'&&!/^\d+$/.test(value))return fail();const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)return fail();return n;}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
async function observedRevision(value:unknown):Promise<string>{const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return 'legacy-observed:corrections:'+Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');}
function document(page:LegacyPage,binding:AuthoringBinding,path:string):Node {
  if(page.status!==200||page.html.length>2_000_000||new URL(page.url).href!==new URL(path,`https://${binding.domain}`).href)return fail();
  const root=parse(page.html,{sourceCodeLocationInfo:true});if(all(root).some(n=>tag(n)==='input'&&attr(n,'type')==='password'))return fail();return root;
}
function link(node:Node,binding:AuthoringBinding):URL|undefined {const href=attr(node,'href');if(!href||tag(node)!=='a')return;try {const url=new URL(href,`https://${binding.domain}`);if(url.origin!==`https://${binding.domain}`)return;return url;}catch{return;}}
function linkedId(node:Node,binding:AuthoringBinding,path:string,key:string):number|null {
  const ids=all(node).flatMap(n=>{const u=link(n,binding);return u?.pathname===path&&u.searchParams.has(key)?[integer(u.searchParams.get(key))]:[];});
  if(new Set(ids).size>1)return fail();return ids[0]??null;
}
function localTimestamp(value:string):string {const result=value.replaceAll('\u00a0',' ').trim();const match=result.match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{3}))?$/);if(!match)return fail();const day=integer(match[1],1,31),month=integer(match[2],1,12),year=integer(match[3],1,9999);integer(match[4],0,23);integer(match[5],0,59);integer(match[6],0,59);const calendar=new Date(Date.UTC(year,month-1,day));if(calendar.getUTCDate()!==day||calendar.getUTCMonth()!==month-1)return fail();return result;}

export interface LegacyMonitoringFilter {tab:0|1;level?:number;teamId?:number;userId?:number;search?:string;typeAnswers?:0|1|2;unique?:boolean}
export function legacyMonitoringPath(gameId:number,filter:LegacyMonitoringFilter,page:number):string {
  const q=new URLSearchParams({gid:String(integer(gameId)),item:String(integer(filter.tab,0,1)),page:String(integer(page,1,1000))});
  if(filter.level!==undefined)q.set('levels',String(integer(filter.level,1)));
  if(filter.teamId!==undefined)q.set('teamname',String(integer(filter.teamId)));
  if(filter.userId!==undefined)q.set('userlogin',String(integer(filter.userId)));
  if(filter.search!==undefined){if(typeof filter.search!=='string'||filter.search.length>1000)return fail();q.set('tbSearchString',filter.search);}
  if(filter.typeAnswers!==undefined)q.set('typeanswers',String(integer(filter.typeAnswers,0,2)));
  if(filter.unique)q.set('uniquecb','1');
  return '/ALoader/GameLoader.aspx?'+q;
}
export interface LegacyAnswerEvent {
  server_action_id:null;tab:0|1;level_num:number;team_id:number|null;user_id:number|null;bonus_id:number|null;
  event_kind:'answer'|'timeout';is_correct:boolean;answer_text:string;answer_date_time:string;timezone:null;
  progress:{total:number;closed:number;remaining:number}|null;
}
export function parseLegacyMonitoring(page:LegacyPage,binding:AuthoringBinding,path:string,filter:LegacyMonitoringFilter,pageNumber:number) {
  const root=document(page,binding,path),nodes=all(root),events:LegacyAnswerEvent[]=[];
  const markers=nodes.filter(n=>tag(n)==='span'&&suffix(n,'lblCorrectValue'));
  const rows=new Set<Node>();
  for(const marker of markers){
    let row:Node|null=marker;while(row&&tag(row)!=='tr')row='parentNode'in row?row.parentNode:null;if(!row||rows.has(row))return fail();rows.add(row);
    const cells=('childNodes'in row?row.childNodes:[]).filter(n=>tag(n)==='td');if(cells.length!==6)return fail();
    const bonus=filter.tab===1,correctIndex=bonus?3:2;
    if(!all(cells[correctIndex]).includes(marker))return fail();
    const value=text(marker).trim().toLowerCase();if(!['в','н'].includes(value))return fail();
    const answer=text(cells[bonus?4:3]),date=localTimestamp(text(cells[bonus?5:4]));
    const participant=cells[bonus?2:1],team=linkedId(participant,binding,'/Teams/TeamDetails.aspx','tid'),user=linkedId(participant,binding,'/UserDetails.aspx','uid');
    if(team===null&&user===null)return fail();
    let bonusId:number|null=null,progress:LegacyAnswerEvent['progress']=null;
    if(bonus){const ids=all(cells[1]).flatMap(n=>{const call=attr(n,'onclick')?.match(/^\s*monitoring\.ShowBonus\(\s*(\d+)\s*\)\s*;?\s*(?:return false;?)?\s*$/);return call?[integer(call[1])]:[];});if(ids.length!==1)return fail();bonusId=ids[0];}
    else {const match=text(cells[5]).trim().match(/^\(?\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*\)?$/);if(!match)return fail();progress={total:integer(match[1],0),closed:integer(match[2],0),remaining:integer(match[3],0)};if(progress.closed+progress.remaining!==progress.total)return fail();}
    events.push({server_action_id:null,tab:filter.tab,level_num:integer(text(cells[0]).trim()),team_id:team,user_id:user,bonus_id:bonusId,event_kind:answer.trim()==='Пройден по таймауту'?'timeout':'answer',is_correct:value==='в',answer_text:answer,answer_date_time:date,timezone:null,progress});
  }
  // A login/error/unknown fragment cannot masquerade as an empty ledger.
  if(!markers.length&&!nodes.some(n=>tag(n)==='form'&&(attr(n,'name')==='MonitoringForm'||attr(n,'id')==='MonitoringForm')))return fail();
  const pages=new Set<number>([pageNumber]);
  for(const node of nodes){const url=link(node,binding);if(url?.pathname!=='/Administration/Games/ActionMonitor.aspx'||!url.searchParams.has('page'))continue;if(url.searchParams.get('gid')!==String(binding.gameId)||url.searchParams.get('tab')!==String(filter.tab))return fail();pages.add(integer(url.searchParams.get('page'),1,1000));}
  return {events,page:pageNumber,total_pages:Math.max(...pages),filter:{...filter},identity_quality:'no-server-action-id' as const,timezone:null};
}

export interface LegacyCorrection {
  correct_id:number;game_id:number;team_id:number|null;user_id:number|null;level_num:number|null;level_id?:number|null;
  correct_date_time:string;timezone:null;correction_value:number|null;value_text:string;comment:string;correct_text:string;
  can_edit:true|null;origin:'unknown';
}
export function legacyDurationSeconds(value:string):number|null {
  const raw=value.replaceAll('\u00a0',' ').trim().replace(/^(?:бонус|штраф)\s+/i,'');
  if(!raw.includes(':')) {
    const parts=[...raw.matchAll(/(\d+)\s+(день|дня|дней|час|часа|часов|минута|минуты|минут|секунда|секунды|секунд)(?=\s|$)/gi)];
    if(!parts.length||raw.replace(/(\d+)\s+(день|дня|дней|час|часа|часов|минута|минуты|минут|секунда|секунды|секунд)(?=\s|$)/gi,'').trim())return null;
    let total=0;const units=new Set<string>();for(const part of parts){const unit=part[2].toLowerCase(),kind=unit.startsWith('д')?'day':unit.startsWith('час')?'hour':unit.startsWith('мин')?'minute':'second';if(units.has(kind))return fail();units.add(kind);total+=integer(part[1],0,kind==='day'?30:kind==='hour'?23:59)*(kind==='day'?86400:kind==='hour'?3600:kind==='minute'?60:1);}return total;
  }
  const match=raw.match(/^(?:(\d+)\s*(?:дней|дня|день|дн\.?|д\.?)\s*)?(\d{1,2}):(\d{2}):(\d{2})$/i);if(!match)return null;
  const day=integer(match[1]??0,0,30),hour=integer(match[2],0,23),minute=integer(match[3],0,59),second=integer(match[4],0,59);return day*86400+hour*3600+minute*60+second;
}
export function parseLegacyCorrections(page:LegacyPage,binding:AuthoringBinding,path:string) {
  const root=document(page,binding,path),nodes=all(root),items:LegacyCorrection[]=[];
  const rows=nodes.filter(n=>tag(n)==='tr'&&(attr(n,'class')??'').split(/\s+/).includes('toWinnerItem')&&/^PlayersRepeater_ctl\d+_trItem$/.test(attr(n,'id')??''));
  for(const row of rows){
    const cells=('childNodes'in row?row.childNodes:[]).filter(n=>tag(n)==='td');if(cells.length!==6)return fail();
    const duration=all(cells[4]).flatMap(n=>{const url=link(n,binding);return url?.pathname==='/GameBonusPenaltyTime.aspx'&&url.searchParams.has('correct')&&url.searchParams.get('gid')===String(binding.gameId)&&!url.searchParams.has('action')?[{node:n,url}]:[];});
    if(duration.length!==1)return fail();const {node,url}=duration[0],bonus=suffix(node,'lnkBonus'),penalty=suffix(node,'lnkPenalty');if(bonus===penalty)return fail();
    const id=integer(url.searchParams.get('correct')),valueText=text(node),seconds=legacyDurationSeconds(valueText);
    const team=linkedId(cells[1],binding,'/Teams/TeamDetails.aspx','tid'),user=linkedId(cells[1],binding,'/UserDetails.aspx','uid');if(team===null&&user===null)return fail();
    const ordinal=text(cells[2]).trim();
    const edit=nodes.some(n=>{const u=link(n,binding);return u?.pathname==='/GameBonusPenaltyTime.aspx'&&u.searchParams.get('gid')===String(binding.gameId)&&u.searchParams.get('correct')===String(id)&&u.searchParams.get('action')==='edit';});
    items.push({correct_id:id,game_id:binding.gameId,team_id:team,user_id:user,level_num:ordinal?integer(ordinal):null,correct_date_time:localTimestamp(text(cells[0])),timezone:null,correction_value:seconds===null?null:bonus?seconds:-seconds,value_text:valueText,comment:text(cells[5]),correct_text:text(cells[3]),can_edit:edit?true:null,origin:'unknown'});
  }
  if(new Set(items.map(row=>row.correct_id)).size!==items.length)return fail();
  if(!rows.length&&!['ddlPlayers','ddlLevels','ddlCorrectionTypes'].every(id=>nodes.some(n=>tag(n)==='select'&&attr(n,'id')===id)))return fail();
  if(nodes.some(n=>{const url=link(n,binding);return url?.pathname==='/GameBonusPenaltyTime.aspx'&&url.searchParams.has('page');}))return fail();
  return {game_id:binding.gameId,items,legacy_evidence:{complete:true,atomic:false,timezone:null,origin:'unknown',game_player_ids:'unavailable',team_recipient_ids:[...new Set(items.flatMap(row=>row.team_id===null?[]:[row.team_id]))],recipient_write_policy:'requires-existing-team-id-evidence or independently verified accepted roster; empty ledger options alone are insufficient',recalculation:'requires-complete-recalculation-context'}};
}

interface CorrectionForm {controls:[string,string][];players:number[];levels:number[];submitter:string;deletePath?:string;current:{teamId:number;levelId:number;seconds:number;isBonus:boolean;comment:string}}
export function parseLegacyCorrectionForm(page:LegacyPage,binding:AuthoringBinding,path:string,update:boolean):CorrectionForm {
  const root=document(page,binding,path),nodes=all(root),wanted=['radioCorrectionType','ddlEditCorrectionPlayers','ddlEditCorrectionLevels','DaysList','HoursList','MinutesList','SecondsList','txtEditCorrectionComment'];
  const expected=new URL(path,`https://${binding.domain}`);expected.searchParams.set('action',update?'update':'save');expected.searchParams.delete('lang');
  const forms=nodes.filter(n=>tag(n)==='form'&&(attr(n,'method')??'get').toLowerCase()==='post'&&(()=>{try{const action=new URL(attr(n,'action')??'',expected);return action.pathname===expected.pathname&&action.searchParams.get('gid')===String(binding.gameId)&&action.searchParams.get('action')===expected.searchParams.get('action')&&action.searchParams.get('correct')===expected.searchParams.get('correct');}catch{return false;}})());
  if(forms.length!==1)return fail();
  const deletes=nodes.flatMap(node=>{const url=link(node,binding);return url?.pathname===expected.pathname&&url.searchParams.get('gid')===String(binding.gameId)&&url.searchParams.get('correct')===expected.searchParams.get('correct')&&url.searchParams.get('action')==='delete'&&[...url.searchParams.keys()].sort().join(',')==='action,correct,gid'?[url.pathname+url.search]:[];});
  if(deletes.length>1)return fail();
  const controls:[string,string][]=[];const values=new Map<string,string>();let submitter='';let players:number[]=[],levels:number[]=[];
  const form=forms[0],formId=attr(form,'id');
  let range:{start:number;end:number}|undefined;
  const area=nodes.find(node=>tag(node)==='textarea'&&attr(node,'name')==='txtEditCorrectionComment');
  if(area){let parent='parentNode'in area?area.parentNode:null;while(parent&&tag(parent)!=='form')parent='parentNode'in parent?parent.parentNode:null;
   if(parent!==form){const location='sourceCodeLocation'in form?form.sourceCodeLocation:undefined;range=sourceFormRanges(page.html).find(row=>location&&'startTag'in location&&row.start===(location.startTag as {endOffset:number}|undefined)?.endOffset);const offset='sourceCodeLocation'in area?area.sourceCodeLocation?.startOffset:undefined;if(!range||offset===undefined||offset<range.start||offset>=range.end)return fail();}
  }
  const belongs=(node:Node)=>{
    const explicit=attr(node,'form');if(explicit!==undefined)return !!formId&&explicit===formId;
    if(range){const offset='sourceCodeLocation'in node?node.sourceCodeLocation?.startOffset:undefined;return offset!==undefined&&offset>=range.start&&offset<range.end;}
    let parent='parentNode'in node?node.parentNode:null;while(parent&&tag(parent)!=='form')parent='parentNode'in parent?parent.parentNode:null;return parent===form;
  };
  const disabled=(node:Node)=>{if(attr(node,'disabled')!==undefined)return true;let parent='parentNode'in node?node.parentNode:null;while(parent&&parent!==form){if(tag(parent)==='optgroup'&&attr(parent,'disabled')!==undefined)return true;if(tag(parent)==='fieldset'&&attr(parent,'disabled')!==undefined)return true;parent='parentNode'in parent?parent.parentNode:null;}return false;};
  const owned=nodes.filter(n=>['input','select','textarea','button'].includes(tag(n))&&attr(n,'name')&&belongs(n)&&!disabled(n));
  for(const name of wanted){
    const matches=owned.filter(n=>attr(n,'name')===name);
    if(name==='radioCorrectionType') {const selected=matches.filter(n=>attr(n,'checked')!==undefined);if(matches.length!==2||selected.length!==1)return fail();values.set(name,attr(selected[0],'value')??'');continue;}
    if(matches.length!==1)return fail();const node=matches[0];
    if(tag(node)==='select') {const options=all(node).filter(n=>tag(n)==='option'),selected=options.filter(n=>attr(n,'selected')!==undefined),chosen=selected.length?selected.slice(-1):options.filter(n=>!disabled(n)).slice(0,1);if(chosen.length!==1||disabled(chosen[0]))return fail();values.set(name,attr(chosen[0],'value')??text(chosen[0]));if(name==='ddlEditCorrectionPlayers')players=options.filter(n=>!disabled(n)).map(n=>integer(attr(n,'value')));if(name==='ddlEditCorrectionLevels')levels=options.filter(n=>!disabled(n)).map(n=>integer(attr(n,'value'),0));}
    else values.set(name,tag(node)==='textarea'?text(node):attr(node,'value')??'');
  }
  for(const node of owned){
    const name=attr(node,'name')!,type=(attr(node,'type')??(tag(node)==='button'?'submit':'text')).toLowerCase();
    if(type==='image'&&name.endsWith(update?'btnEditCorrectionUpdate':'btnEditCorrectionAdd')){if(submitter)return fail();submitter=name;continue;}
    if(['submit','image','button','reset'].includes(type))continue;if(['password','file'].includes(type))return unsupported();
    if(['checkbox','radio'].includes(type)&&attr(node,'checked')===undefined)continue;
    if(tag(node)==='select'){
      const options=all(node).filter(n=>tag(n)==='option'),chosen=options.filter(n=>attr(n,'selected')!==undefined),selected=chosen.length?(attr(node,'multiple')===undefined?chosen.slice(-1):chosen):attr(node,'multiple')===undefined?options.filter(n=>!disabled(n)).slice(0,1):[];
      for(const option of selected){if(attr(option,'disabled')!==undefined)continue;const parent='parentNode'in option?option.parentNode:null;if(parent&&tag(parent)==='optgroup'&&attr(parent,'disabled')!==undefined)continue;controls.push([name,attr(option,'value')??text(option)]);}
    }else controls.push([name,tag(node)==='textarea'?text(node):attr(node,'value')??(['checkbox','radio'].includes(type)?'on':'')]);
  }
  if(!submitter)return fail();
  const type=integer(values.get('radioCorrectionType'),1,2),day=integer(values.get('DaysList'),0,30),hour=integer(values.get('HoursList'),0,23),minute=integer(values.get('MinutesList'),0,59),second=integer(values.get('SecondsList'),0,59);
  return {controls,players,levels,submitter,...(deletes.length?{deletePath:deletes[0]}:{}),current:{teamId:integer(values.get('ddlEditCorrectionPlayers')),levelId:integer(values.get('ddlEditCorrectionLevels'),0),seconds:day*86400+hour*3600+minute*60+second,isBonus:type===1,comment:values.get('txtEditCorrectionComment')!}};
}
export function legacyCorrectionBody(form:CorrectionForm,value:{playerId:number;levelId:number;seconds:number;isBonus:boolean;comment:string}):string {
  const {playerId,levelId,seconds,isBonus,comment}=value;
  integer(playerId);integer(levelId,0);integer(seconds,1,30*86400+86399);
  if(!form.players.includes(playerId)||!form.levels.includes(levelId)||typeof isBonus!=='boolean'||typeof comment!=='string'||!comment.trim()||comment.length>1000)return fail();
  const body=new URLSearchParams(form.controls);
  for(const [name,field]of Object.entries({radioCorrectionType:isBonus?1:2,ddlEditCorrectionPlayers:playerId,ddlEditCorrectionLevels:levelId,DaysList:Math.floor(seconds/86400),HoursList:Math.floor(seconds/3600)%24,MinutesList:Math.floor(seconds/60)%60,SecondsList:seconds%60,txtEditCorrectionComment:comment.replace(/\r?\n/g,'\r\n')}))body.set(name,String(field));
  body.set(form.submitter+'.x','1');body.set(form.submitter+'.y','1');return body.toString();
}

/** Native ledger observations; complete recalculation combines these with LegacyStatistics context. */
export class LegacyObservations {
  readonly #session:LegacySessionPort;readonly #binding:AuthoringBinding;
  constructor(session:LegacySessionPort){this.#session=session;this.#binding={...session.binding};}
  async #dispatch(recipe:LegacyRecipe,signal?:AbortSignal){
    if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('session-changed');signal?.throwIfAborted();
    const page=await this.#session.dispatch(Object.freeze(recipe),signal);
    if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('session-changed');return page;
  }
  async #levels(signal?:AbortSignal){const path=`/Administration/Games/LevelManager.aspx?gid=${this.#binding.gameId}`;return parseLegacyLevelIndex(await this.#dispatch({kind:'level-index',effect:'read',method:'GET',path},signal),this.#binding);}
  async monitoringPage(filter:LegacyMonitoringFilter,page:number,signal?:AbortSignal){const path=legacyMonitoringPath(this.#binding.gameId,filter,page);return parseLegacyMonitoring(await this.#dispatch({kind:'monitoring-read',effect:'read',method:'GET',path},signal),this.#binding,path,filter,page);}
  async monitoringLedger(filter:Omit<LegacyMonitoringFilter,'tab'>={},signal?:AbortSignal){
    if(filter.unique)return unsupported();const events:LegacyAnswerEvent[]=[],coverage:{tab:0|1;pages:number;rows:number}[]=[];let stable=true;
    for(const tab of [0,1]as const){let total=1,first:Awaited<ReturnType<LegacyObservations['monitoringPage']>>|undefined,last:typeof first;let count=0;
      for(let page=1;page<=total;page++){const result=await this.monitoringPage({...filter,tab},page,signal);if(page===1){first=result;total=result.total_pages;}else if(result.total_pages!==total)stable=false;last=result;events.push(...result.events);count+=result.events.length;if(events.length>200000)return fail();}
      if(JSON.stringify((await this.monitoringPage({...filter,tab},1,signal)).events)!==JSON.stringify(first?.events))stable=false;
      if(total>1&&JSON.stringify((await this.monitoringPage({...filter,tab},total,signal)).events)!==JSON.stringify(last?.events))stable=false;
      coverage.push({tab,pages:total,rows:count});
    }
    return {game_id:this.#binding.gameId,events,legacy_evidence:{complete:stable,unstable:!stable,atomic:false,coverage,filter,server_action_id:null,timezone:null,multiplicity:'preserved',recalculation:'requires-complete-recalculation-context'}};
  }
  async corrections(signal?:AbortSignal,filter:{teamId?:number;level?:number;type?:'Unknown'|'Bonus'|'Penalty'}={}){const q=new URLSearchParams({gid:String(this.#binding.gameId),lang:'ru'});if(filter.teamId!==undefined)q.set('tid',String(integer(filter.teamId,0)));if(filter.level!==undefined)q.set('level',String(integer(filter.level,0)));if(filter.type!==undefined){if(!['Unknown','Bonus','Penalty'].includes(filter.type))return fail();q.set('type',filter.type);}const path='/GameBonusPenaltyTime.aspx?'+q;const result=parseLegacyCorrections(await this.#dispatch({kind:'correction-list',effect:'read',method:'GET',path},signal),this.#binding,path);return {...result,version:await observedRevision({binding:this.#binding,filter,items:result.items})};}
  async #form(id:number|undefined,signal?:AbortSignal){const path=`/GameBonusPenaltyTime.aspx?gid=${this.#binding.gameId}&action=${id===undefined?'add':'edit&correct='+integer(id)}`;return parseLegacyCorrectionForm(await this.#dispatch({kind:'correction-form',effect:'read',method:'GET',path},signal),this.#binding,path,id!==undefined);}
  async request(path:string,init:RequestInit={}):Promise<Response|undefined>{
    const url=new URL(path,`https://${this.#binding.domain}`),method=init.method??'GET',base=`/games/${this.#binding.gameId}`;
    if(url.origin!==`https://${this.#binding.domain}`)return unsupported();
    if(url.pathname===base+'/monitoring'&&method==='GET'){
      const q=url.searchParams,allowed=['tab','level','level_id','team_id','user_id','search','type_answers','unique','page','page_size','all_pages'];if([...q.keys()].some(k=>!allowed.includes(k))||[...q.keys()].length!==new Set(q.keys()).size)return fail();
      const filter:LegacyMonitoringFilter={tab:integer(q.get('tab')??0,0,1)as 0|1};
      if(q.has('level'))filter.level=integer(q.get('level'));if(q.has('level_id')){const level=(await this.#levels(init.signal??undefined)).find(row=>row.level_id===integer(q.get('level_id')));if(!level||filter.level&&filter.level!==level.level_number)return fail();filter.level=level.level_number;}
      if(q.has('team_id'))filter.teamId=integer(q.get('team_id'));if(q.has('user_id'))filter.userId=integer(q.get('user_id'));if(q.has('search'))filter.search=q.get('search')!;if(q.has('type_answers'))filter.typeAnswers=integer(q.get('type_answers'),0,2)as 0|1|2;
      if(q.has('unique')){if(!['true','false'].includes(q.get('unique')!))return fail();filter.unique=q.get('unique')==='true';}
      if(q.get('all_pages')==='true'){const {tab:_,...both}=filter;return json(await this.monitoringLedger(both,init.signal??undefined));}
      const result=await this.monitoringPage(filter,integer(q.get('page')??1),init.signal??undefined);
      return json({game_id:this.#binding.gameId,mode:filter.tab?'bonus':'main',can_view:true,page:result.page,total_pages:result.total_pages,[filter.tab?'bonus_actions':'actions']:result.events,legacy_evidence:{complete:false,coverage:'one-page',timezone:null,server_action_id:null,recalculation:'requires-complete-recalculation-context'}});
    }
    const correction=url.pathname.match(new RegExp('^'+base+'/corrections(?:/([1-9]\\d*))?$'));if(!correction)return;
    const id=correction[1]?integer(correction[1]):undefined;
    if(method==='GET'){const q=url.searchParams;if([...q.keys()].some(key=>!['team_id','level','type'].includes(key))||id!==undefined&&url.search)return unsupported();const filter={...(q.has('team_id')?{teamId:integer(q.get('team_id'),0)}:{}),...(q.has('level')?{level:integer(q.get('level'),0)}:{}),...(q.has('type')?{type:q.get('type')as 'Unknown'|'Bonus'|'Penalty'}:{})};const ledger=await this.corrections(init.signal??undefined,filter);if(id===undefined)return json(ledger);const item=ledger.items.find(row=>row.correct_id===id);return item?json(item):json({error:'not-found'},404);}
    if(url.search)return unsupported();
    if(!['POST','PUT','DELETE'].includes(method)||method==='POST'&&id!==undefined||method!=='POST'&&id===undefined)return unsupported();
    const before=await this.corrections(init.signal??undefined),existing=id===undefined?undefined:before.items.find(row=>row.correct_id===id);
    // The host must persist this observed revision with the reviewed immutable proposal.
    // This detects stale plans; it does not claim server-side CAS across the GET/mutation gap.
    const expected=new Headers(init.headers).get('If-Match');if(!expected)return json({error:'legacy-observed-revision-required'},428);if(expected!==before.version)return json({error:'conflict'},409);
    if(id!==undefined&&!existing)return unsupported();
    let fields:{playerId:number;levelId:number;seconds:number;isBonus:boolean;comment:string}|undefined;
    let form:CorrectionForm|undefined;
    if(method==='DELETE'){form=await this.#form(id,init.signal??undefined);if(!form.deletePath)return unsupported();}
    if(method!=='DELETE'){
      if(typeof init.body!=='string')return fail();let body:Record<string,unknown>;try{body=JSON.parse(init.body);}catch{return fail();}
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['player_id','level_id','seconds','is_bonus','comment'].includes(key)))return unsupported();
      fields={playerId:integer(body.player_id),levelId:integer(body.level_id,0),seconds:integer(body.seconds),isBonus:body.is_bonus as boolean,comment:body.comment as string};form=await this.#form(id,init.signal??undefined);
      if(!before.items.some(row=>row.team_id===fields!.playerId)){
        // A fresh accepted roster proves the native team recipient even when the ledger is empty.
        // Inspect action hrefs for game-player identity; never dispatch them.
        let found=false,total=1;try{
        for(let page=1;page<=total;page++){const path=`/GamePlayers.aspx?gid=${this.#binding.gameId}&status=1${page===1?'':'&page='+page}`;
          const roster=parseLegacyRoster(await this.#dispatch({kind:'players-read',effect:'read',method:'GET',path},init.signal??undefined),this.#binding,'team',page);
          if(page===1)total=roster.totalPages;else if(total!==roster.totalPages)return fail();if(roster.rows.some(row=>row.id===fields!.playerId))found=true;
        }}catch(error){if(init.signal?.aborted||error instanceof AuthoringApiError&&error.code==='session-changed')throw error;return json({error:'recipient-team-identity-unverified'},422);}
        if(!found)return json({error:'recipient-team-identity-unverified'},422);
      }
      if(id!==undefined&&(form.current.teamId!==fields.playerId||form.current.levelId!==fields.levelId))return unsupported();
    }
    const target=method==='DELETE'?form!.deletePath!:`/GameBonusPenaltyTime.aspx?gid=${this.#binding.gameId}&action=${method==='POST'?'save':'update&correct='+id}`;
    const recipe:LegacyRecipe={kind:method==='DELETE'?'correction-delete':'correction-write',effect:'mutation',method:method==='DELETE'?'GET':'POST',path:target,...(fields&&form?{body:legacyCorrectionBody(form,fields)}:{})};
    // One dispatch only. A lost response still permits an independent read-back; it never permits a resend.
    try{await this.#dispatch(recipe,init.signal??undefined);}catch{/* reconcile once below */}
    let after:Awaited<ReturnType<LegacyObservations['corrections']>>;try{after=await this.corrections(init.signal??undefined);}catch{throw new AuthoringApiError('unknown-after-dispatch');}
    const removed=new Set(id?[id]:[]),others=(list:LegacyCorrection[])=>list.filter(row=>!removed.has(row.correct_id));
    if(method==='DELETE')return !after.items.some(row=>row.correct_id===id)&&JSON.stringify(others(before.items))===JSON.stringify(after.items)?new Response(null,{status:204}):json({status:'unknown'},502);
    const candidates=id===undefined?after.items.filter(row=>!before.items.some(old=>old.correct_id===row.correct_id)):after.items.filter(row=>row.correct_id===id);
    if(candidates.length!==1||!fields)throw new AuthoringApiError('unknown-after-dispatch');const actual=candidates[0];
    let verified:CorrectionForm;try{verified=await this.#form(actual.correct_id,init.signal??undefined);}catch{throw new AuthoringApiError('unknown-after-dispatch');}
    if(verified.current.teamId!==fields.playerId||verified.current.levelId!==fields.levelId||verified.current.seconds!==fields.seconds||verified.current.isBonus!==fields.isBonus||verified.current.comment!==fields.comment.replace(/\r\n/g,'\n'))throw new AuthoringApiError('unknown-after-dispatch');
    removed.add(actual.correct_id);if(JSON.stringify(others(before.items))!==JSON.stringify(others(after.items)))throw new AuthoringApiError('unknown-after-dispatch');
    return json({...actual,level_id:fields.levelId,correction_value:fields.isBonus?fields.seconds:-fields.seconds},method==='POST'?201:200);
  }
}
