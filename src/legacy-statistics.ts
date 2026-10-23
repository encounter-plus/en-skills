import {parse,type DefaultTreeAdapterMap} from 'parse5';
import {AuthoringApiError,sameAuthoringBinding,type AuthoringBinding} from './authoring-api.ts';
import type {LegacyPage,LegacySessionPort,LegacyRecipe} from './legacy-authoring.ts';
import {parseLegacyCorrectionForm} from './legacy-observations.ts';

const fail=():never=>{throw new AuthoringApiError('incomplete-read');};
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:fail();
const int=(v:unknown,min=0):number=>Number.isSafeInteger(v)&&Number(v)>=min?Number(v):fail();
const bool=(v:unknown):boolean=>typeof v==='boolean'?v:fail();
const label=(v:unknown):string=>typeof v==='string'&&v.length<=1000?v:fail();
/** Preserve the native clock until an independently established offset is supplied. */
export interface LegacyClock {value:number;timestamp:number}
function clock(v:unknown):LegacyClock|null {if(v===null)return null;const row=object(v);if(typeof row.Value!=='number'||!Number.isFinite(row.Value)||row.Value<0)return fail();return {value:row.Value,timestamp:int(row.Timestamp)};}
export interface LegacyStatistic {levelId:number;levelNumber:number;teamId:number|null;userId:number|null;teamName:string;userName:string;spentSeconds:number;passType:0|1|2;actionTime:LegacyClock|null;publishedCorrectionSeconds:number|null}
export interface LegacyStatisticsProjection {
  gameId:number;mode:'team'|'user';finished:boolean;levels:{levelId:number;levelNumber:number;dismissed:boolean}[];
  rows:LegacyStatistic[];coverage:{complete:boolean;reason:string};
  /** JSON StatItems corrections are NOT a source of final totals/manual awards. */
  finalTotalsAvailable:false;startTime:LegacyClock|null;
}
/** Source: encx statistics.go/types.go. An allowlist deliberately discards User profile, email and credentials. */
export function parseLegacyStatistics(value:unknown,gameId:number):LegacyStatisticsProjection {
  const body=object(value),game=object(body.Game);if(int(game.GameID,1)!==gameId)return fail();
  const kind=int(game.GameTypeID);if(kind!==1&&kind!==0&&kind!==2)return fail();
  const mode=kind===1?'team':'user',finished=bool(game.Finished);
  if(!Array.isArray(body.Levels)||!Array.isArray(body.StatItems))return fail();
  const levels=body.Levels.map(raw=>{const row=object(raw);return {levelId:int(row.LevelId,1),levelNumber:int(row.LevelNumber,1),dismissed:bool(row.Dismissed)};});
  if(new Set(levels.map(row=>row.levelId)).size!==levels.length||new Set(levels.map(row=>row.levelNumber)).size!==levels.length)return fail();
  const rows:LegacyStatistic[]=[];
  for(const group of body.StatItems){if(!Array.isArray(group))return fail();for(const raw of group){
    const row=object(raw),levelId=int(row.LevelId),levelNumber=int(row.LevelNum);
    // Aggregate groups (zero level) are retained by the server, but are not level completion evidence.
    if(levelId===0||levelNumber===0)continue;
    if(!levels.some(level=>level.levelId===levelId&&level.levelNumber===levelNumber))return fail();
    const teamId=int(row.TeamId),userId=int(row.UserId),passType=int(row.PassType);if(passType>2||(mode==='team'?teamId:userId)===0)return fail();
    const correction=row.Corrections===null?null:object(row.Corrections).TotalSeconds;
    if(correction!==null&&!Number.isSafeInteger(correction))return fail();
    rows.push({levelId,levelNumber,teamId:teamId||null,userId:userId||null,teamName:label(row.TeamName),userName:label(row.UserName),spentSeconds:int(row.SpentSeconds),passType:passType as 0|1|2,actionTime:clock(row.ActionTime),publishedCorrectionSeconds:correction as number|null});
  }}
  if(rows.length>200000||new Set(rows.map(row=>`${row.levelId}:${mode==='team'?row.teamId:row.userId}`)).size!==rows.length)return fail();
  // PagerVisible does not provide a count or next route. Never pretend this response covers omitted pages.
  const paged=bool(body.PagerVisible);
  return {gameId,mode,finished,levels,rows,startTime:clock(game.StartDateTime),coverage:{complete:!paged,reason:paged?'native-pager-visible; full coverage unproven':'full JSON response, no native pager'},finalTotalsAvailable:false};
}

type Node=DefaultTreeAdapterMap['node'];
const attr=(node:Node,name:string)=>'attrs'in node?node.attrs.find(a=>a.name===name)?.value:undefined;
const nodes=(node:Node):Node[]=>[node,...('childNodes'in node?node.childNodes.flatMap(nodes):[])];
const text=(node:Node):string=>'value'in node?node.value:'childNodes'in node?node.childNodes.map(text).join(''):'';
const visibleText=(node:Node):string=>'tagName'in node&&['script','style'].includes(node.tagName)?'':'value'in node?node.value:'childNodes'in node?node.childNodes.map(visibleText).join(''):'';
export function legacyLocalTime(value:string,offsetMinutes:number):number {
  if(!Number.isSafeInteger(offsetMinutes)||Math.abs(offsetMinutes)>14*60)return fail();
  const match=value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{3}))?$/);if(!match)return fail();
  const [,day,month,year,hour,minute,second,millisecond]=match;
  const local=Date.UTC(Number(year),Number(month)-1,Number(day),Number(hour),Number(minute),Number(second),Number(millisecond??0));
  const check=new Date(local);if(check.getUTCFullYear()!==Number(year)||check.getUTCMonth()!==Number(month)-1||check.getUTCDate()!==Number(day)||Number(hour)>23||Number(minute)>59||Number(second)>59)return fail();
  return local-offsetMinutes*60000;
}
export function parseLegacyTimezone(page:LegacyPage,binding:AuthoringBinding,start:LegacyClock|null):number {
  if(page.status!==200||page.url!==`https://${binding.domain}/GameDetails.aspx?gid=${binding.gameId}`||!start)return fail();
  const all=nodes(parse(page.html)),titles=all.filter(node=>'tagName'in node&&node.tagName==='span'&&(attr(node,'class')??'').split(/\s+/).includes('title')&&visibleText(node).trim()==='Начало игры:');
  if(titles.length!==1)return fail();let cell:Node|null=titles[0];while(cell&&(!('tagName'in cell)||cell.tagName!=='td'))cell='parentNode'in cell?cell.parentNode:null;if(!cell)return fail();
  const whites=nodes(cell).filter(node=>'tagName'in node&&node.tagName==='span'&&(attr(node,'class')??'').split(/\s+/).includes('white'));if(whites.length!==1)return fail();
  const match=visibleText(whites[0]).replaceAll('\u00a0',' ').trim().match(/^(\d{2}\.\d{2}\.\d{4}\s+\d{1,2}:\d{2}:\d{2})\s*\(UTC\s*([+-]\d{1,2})(?::(\d{2}))?\)$/);if(!match)return fail();
  const offset=Number(match[2])*60+(Number(match[2])<0?-1:1)*Number(match[3]??0);
  if(legacyLocalTime(match[1],offset)!==start.timestamp*1000)return fail();return offset;
}
export interface LegacyRosterRow {key:string;id:number;gamePlayerId:number;label:string;eligible:true;enteredAt:null}
/** Accepted roster. The disqualify link is inspected for identity only; never dispatched. */
export function parseLegacyRoster(page:LegacyPage,binding:AuthoringBinding,mode:'team'|'user',pageNumber=1) {
  const expected=new URL(`/GamePlayers.aspx?gid=${binding.gameId}&status=1${pageNumber===1?'':'&page='+pageNumber}`,`https://${binding.domain}`);
  if(page.status!==200||page.url!==expected.href||page.html.length>2000000)return fail();
  const all=nodes(parse(page.html)),tables=all.filter(node=>'tagName'in node&&node.tagName==='table'&&(attr(node,'class')??'').split(/\s+/).includes('players'));
  if(tables.length!==1||all.some(node=>'tagName'in node&&node.tagName==='input'&&attr(node,'type')==='password'))return fail();
  const rows:LegacyRosterRow[]=[];
  for(const row of nodes(tables[0]).filter(node=>'tagName'in node&&node.tagName==='tr'&&attr(node,'id')==='trPlayer')){
    const children=nodes(row),players=children.filter(node=>attr(node,'id')==='lnkPlayer'),actions=children.filter(node=>attr(node,'id')==='lnkAction1');if(players.length!==1||actions.length!==1)return fail();
    let player:URL,action:URL;try{player=new URL(attr(players[0],'href')!,expected);action=new URL(attr(actions[0],'href')!,expected);}catch{return fail();}
    const field=mode==='team'?'tid':'uid',playerPath=mode==='team'?'/Teams/TeamDetails.aspx':'/UserDetails.aspx';
    if(player.origin!==expected.origin||player.pathname!==playerPath||action.origin!==expected.origin||action.pathname!=='/GamePlayers.aspx'||action.searchParams.get('gid')!==String(binding.gameId)||action.searchParams.get('status')!=='1'||action.searchParams.get('action')!=='disqualify')return fail();
    const number=(value:string|null)=>value&&/^[1-9]\d*$/.test(value)?int(Number(value),1):fail();
    const id=number(player.searchParams.get(field)),gamePlayerId=number(action.searchParams.get('player'));
    rows.push({key:`${mode}:${id}`,id,gamePlayerId,label:text(players[0]),eligible:true,enteredAt:null});
  }
  if(new Set(rows.map(row=>row.id)).size!==rows.length||new Set(rows.map(row=>row.gamePlayerId)).size!==rows.length)return fail();
  let totalPages=pageNumber;
  for(const node of all){const href=attr(node,'href');if(!href)continue;let url:URL;try{url=new URL(href,expected);}catch{return fail();}if(url.origin!==expected.origin||url.pathname!=='/GamePlayers.aspx'||url.searchParams.has('action')||!url.searchParams.has('page'))continue;
    if(url.searchParams.get('gid')!==String(binding.gameId)||url.searchParams.get('status')!=='1')return fail();const value=url.searchParams.get('page');if(!value||!/^\d+$/.test(value))return fail();totalPages=Math.max(totalPages,int(Number(value),1));
  }
  if(totalPages>1000)return fail();
  return {rows,page:pageNumber,totalPages,scope:'accepted' as const,entryTimesKnown:false as const};
}
export interface LegacyGameStat {
  gameId:number;cells:{key:string;levelNumber:number;spentSeconds:number;correctionSeconds:number;timeout:boolean;displayedAt:string}[];
  totals:{key:string;kind:'raw'|'corr';seconds:number;completedLevels:number}[];
  coverage:{complete:true;atomic:false};
}
/** cp81428 raw HTML observed 2026-10-19. Cells/totals sort independently: join only native IDs. */
export function parseLegacyGameStat(page:LegacyPage,binding:AuthoringBinding):LegacyGameStat {
  if(page.status!==200||page.url!==`https://${binding.domain}/GameStat.aspx?gid=${binding.gameId}`||page.html.length>2000000)return fail();
  const all=nodes(parse(page.html)),byId=(id:string)=>all.filter(node=>attr(node,'id')===id);
  const game=byId('ltrGameID'),tables=byId('GameStatObject2_DataTable');
  if(game.length!==1||text(game[0]).trim()!==String(binding.gameId)||tables.length!==1)return fail();
  if(all.some(node=>'tagName'in node&&node.tagName==='input'&&attr(node,'type')==='password'))return fail();
  const table=nodes(tables[0]),signed=(value:string|undefined)=>{if(value===undefined||!/^[-]?\d+$/.test(value)||!Number.isSafeInteger(Number(value)))return fail();return Number(value);};
  const cells:LegacyGameStat['cells']=[],totals:LegacyGameStat['totals']=[];
  for(const node of table){if(!('tagName'in node)||node.tagName!=='td')continue;
    const level=attr(node,'data-lvl'),kind=attr(node,'data-total');if(level===undefined&&kind===undefined)continue;
    const id=int(signed(attr(node,'data-team')),1),key=`team:${id}`,seconds=int(signed(attr(node,'data-v')));
    const links=nodes(node).filter(child=>'tagName'in child&&child.tagName==='a'&&attr(child,'href')).map(child=>{try{return new URL(attr(child,'href')!,`https://${binding.domain}`);}catch{return fail();}}).filter(url=>url.pathname==='/Teams/TeamDetails.aspx');
    if(!links.length||links.some(url=>url.origin!==`https://${binding.domain}`||url.searchParams.get('tid')!==String(id)))return fail();
    if(kind!==undefined){if(kind!=='raw'&&kind!=='corr'||level!==undefined)return fail();
      const wrappers=nodes(node).filter(child=>(attr(child,'class')??'').split(/\s+/).includes('n'));
      if(wrappers.length!==1)return fail();const match=text(wrappers[0]).trim().match(/^(\d+)/);if(!match)return fail();
      totals.push({key,kind,seconds,completedLevels:int(Number(match[1]))});
    }else{
      const timeout=nodes(node).some(child=>(attr(child,'class')??'').split(/\s+/).includes('timeout'));
      const data=nodes(node).filter(child=>(attr(child,'class')??'').split(/\s+/).includes('dataCell'));if(data.length!==1)return fail();
      // Keep local text as evidence. Do not assume its timezone or turn adjusted finish into raw duration.
      const clocks=text(data[0]).match(/\d{2}\.\d{2}\.\d{4}\s+\d{1,2}:\d{2}:\d{2}(?:\.\d{3})?/g);if(clocks?.length!==1)return fail();
      cells.push({key,levelNumber:int(signed(level),1),spentSeconds:seconds,correctionSeconds:signed(attr(node,'data-c')),timeout,displayedAt:clocks[0]});
    }
  }
  if(!totals.length||new Set(cells.map(row=>`${row.key}:${row.levelNumber}`)).size!==cells.length||new Set(totals.map(row=>`${row.key}:${row.kind}`)).size!==totals.length)return fail();
  const keys=new Set(totals.map(row=>row.key));
  if([...keys].some(key=>!totals.some(row=>row.key===key&&row.kind==='raw')||!totals.some(row=>row.key===key&&row.kind==='corr'))||cells.some(row=>!keys.has(row.key)))return fail();
  if(all.some(node=>{const href=attr(node,'href');if(!href)return false;try{const u=new URL(href,`https://${binding.domain}`);return u.pathname==='/GameStat.aspx'&&u.searchParams.has('page');}catch{return true;}}))return fail();
  return {gameId:binding.gameId,cells,totals,coverage:{complete:true,atomic:false}};
}
/** Native correction options prove allowed recipient IDs, but never invent game_player_id. */
export function parseLegacyCorrectionRecipients(page:LegacyPage,binding:AuthoringBinding,mode:'team'|'user') {
  const expected=`https://${binding.domain}/GameBonusPenaltyTime.aspx?gid=${binding.gameId}&action=add`;
  if(page.status!==200||page.url!==expected||page.html.length>2000000)return fail();
  const all=nodes(parse(page.html));if(all.some(node=>'tagName'in node&&node.tagName==='input'&&attr(node,'type')==='password'))return fail();
  const selects=all.filter(node=>'tagName'in node&&node.tagName==='select'&&attr(node,'name')==='ddlEditCorrectionPlayers');
  if(selects.length!==1||attr(selects[0],'disabled')!==undefined)return fail();
  const recipients=nodes(selects[0]).filter(node=>'tagName'in node&&node.tagName==='option'&&attr(node,'disabled')===undefined).map(node=>{
    const raw=attr(node,'value');if(!raw||!/^\d+$/.test(raw))return fail();const id=int(Number(raw),1);
    return {key:`${mode}:${id}`,id,label:text(node),nativeRecipientId:id,gamePlayerId:null};
  });
  if(!recipients.length||new Set(recipients.map(row=>row.id)).size!==recipients.length)return fail();
  return {recipients,identity:'native-correction-option' as const,rosterComplete:false as const,eligibilityKnown:false as const};
}

export class LegacyStatistics {
  readonly #session:LegacySessionPort;readonly #binding:AuthoringBinding;
  constructor(session:LegacySessionPort){this.#session=session;this.#binding={...session.binding};}
  async #dispatch(kind:LegacyRecipe['kind'],path:string,signal?:AbortSignal){
    if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('session-changed');
    signal?.throwIfAborted();const page=await this.#session.dispatch(Object.freeze({kind,effect:'read',method:'GET',path}),signal);
    if(!sameAuthoringBinding(this.#binding,await this.#session.currentBinding()))throw new AuthoringApiError('session-changed');return page;
  }
  async read(signal?:AbortSignal){
    const binding=this.#binding,jsonPath=`/gamestatistics/full/${binding.gameId}?json=1`;
    const readStats=async()=>{const page=await this.#dispatch('statistics-json',jsonPath,signal);if(page.status!==200||page.url!==`https://${binding.domain}${jsonPath}`||page.html.length>2000000)return fail();let raw:unknown;try{raw=JSON.parse(page.html);}catch{return fail();}return parseLegacyStatistics(raw,binding.gameId);};
    const statistics=await readStats();if(!statistics.coverage.complete)return fail();
    const timezone=await this.#dispatch('game-read',`/GameDetails.aspx?gid=${binding.gameId}`,signal).then(page=>parseLegacyTimezone(page,binding,statistics.startTime));
    const readFinal=async()=>parseLegacyGameStat(await this.#dispatch('statistics-final',`/GameStat.aspx?gid=${binding.gameId}`,signal),binding);
    const final=await readFinal(),roster:LegacyRosterRow[]=[],rosterPages:ReturnType<typeof parseLegacyRoster>[]=[];let total=1;
    for(let page=1;page<=total;page++){const path=`/GamePlayers.aspx?gid=${binding.gameId}&status=1${page===1?'':'&page='+page}`;
      const read=parseLegacyRoster(await this.#dispatch('players-read',path,signal),binding,statistics.mode,page);if(page===1)total=read.totalPages;else if(total!==read.totalPages)return fail();roster.push(...read.rows);rosterPages.push(read);
    }
    if(new Set(roster.map(row=>row.key)).size!==roster.length||new Set(roster.map(row=>row.gamePlayerId)).size!==roster.length)return fail();
    for(const original of rosterPages){const page=original.page,path=`/GamePlayers.aspx?gid=${binding.gameId}&status=1${page===1?'':'&page='+page}`;
      const fresh=parseLegacyRoster(await this.#dispatch('players-read',path,signal),binding,statistics.mode,page);if(JSON.stringify(original)!==JSON.stringify(fresh))return fail();
    }
    if(JSON.stringify(statistics)!==JSON.stringify(await readStats())||JSON.stringify(final)!==JSON.stringify(await readFinal()))return fail();
    // Form visibility and every eligible native recipient are proved separately from statistical coverage.
    const formPath=`/GameBonusPenaltyTime.aspx?gid=${binding.gameId}&action=add`,form=parseLegacyCorrectionForm(await this.#dispatch('correction-form',formPath,signal),binding,formPath,false);
    const canWrite=statistics.mode==='team'&&roster.every(row=>form.players.includes(row.id))&&statistics.levels.every(level=>form.levels.includes(level.levelId));
    return {statistics,final,roster,timezone,canWrite,complete:true as const,atomic:false as const};
  }
  async request(path:string,init:RequestInit={}):Promise<Response|undefined>{if(path!==`/games/${this.#binding.gameId}/recalculation-context`||(init.method??'GET')!=='GET')return;return Response.json(await this.read(init.signal??undefined));}
}
