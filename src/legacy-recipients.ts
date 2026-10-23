import {AuthoringApiError} from './authoring-api.ts';
import {parse,type DefaultTreeAdapterMap} from 'parse5';
import type {AuthoringBinding} from './authoring-api.ts';
import type {LegacyPage} from './legacy-authoring.ts';
export interface LegacyRecipientOption {member_id:number;label:string}
export type LegacyRecipientKind='user'|'team'|'unknown';
const fail=():never=>{throw new AuthoringApiError('incomplete-read');};
export function legacyMemberId(value:unknown):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new AuthoringApiError('unsupported');return value;}
/** IDs are native membership selectors. Their magnitude never establishes user/team identity. */
export function parseLegacyRecipientOptions(select:DefaultTreeAdapterMap['node']):LegacyRecipientOption[]{
 const attr=(node:DefaultTreeAdapterMap['node'],name:string)=>'attrs'in node?node.attrs.find(a=>a.name===name)?.value:undefined;
 const text=(node:DefaultTreeAdapterMap['node']):string=>'value'in node?node.value:'childNodes'in node?node.childNodes.map(text).join(''):'';
 const nodes=(node:DefaultTreeAdapterMap['node']):DefaultTreeAdapterMap['node'][]=>[node,...('childNodes'in node?node.childNodes.flatMap(nodes):[])];
 if(!('tagName'in select)||select.tagName!=='select'||attr(select,'multiple')!==undefined||attr(select,'disabled')!==undefined)return fail();
 const options=nodes(select).filter(node=>'tagName'in node&&node.tagName==='option').filter(node=>{let current:DefaultTreeAdapterMap['node']|null=node;while(current&&current!==select){if(attr(current,'disabled')!==undefined)return false;current='parentNode'in current?current.parentNode:null;}return true;}).map(node=>{const raw=attr(node,'value')??text(node);if(!/^(?:0|[1-9]\d*)$/.test(raw)||!Number.isSafeInteger(Number(raw)))return fail();return {member_id:Number(raw),label:text(node)};});
 if(!options.length||new Set(options.map(row=>row.member_id)).size!==options.length)return fail();return options;
}
export function legacyRecipientFields(memberId:number,options:LegacyRecipientOption[],kind:LegacyRecipientKind='unknown'):{for_member_id:number;for_user_id?:number;for_team_id?:number;recipient:{kind:LegacyRecipientKind;member_id:number;options:LegacyRecipientOption[]}}{
 if(!options.some(option=>option.member_id===memberId))return fail();
 return {for_member_id:memberId,...(memberId===0?{for_user_id:0,for_team_id:0}:kind==='user'?{for_user_id:memberId}:kind==='team'?{for_team_id:memberId}:{}),recipient:{kind,member_id:memberId,options}};
}
export function resolveLegacyRecipient(fields:Record<string,unknown>,options:LegacyRecipientOption[],fallback:number,kind:LegacyRecipientKind='unknown'):number {
 const supplied=['for_member_id','for_user_id','for_team_id'].filter(key=>fields[key]!==undefined);
 let result:number|undefined;
 for(const key of supplied){const value=legacyMemberId(fields[key]);if(value!==0&&(key==='for_user_id'&&kind!=='user'||key==='for_team_id'&&kind!=='team'))throw new AuthoringApiError('unsupported');if(result!==undefined&&result!==value)throw new AuthoringApiError('unsupported');result=value;}
 const member=result??fallback;if(!options.some(row=>row.member_id===member))throw new AuthoringApiError('unsupported');return member;
}

/** A scoped first-party game detail row is identity evidence; unknown markup stays opaque. */
export function legacyRecipientKind(page:LegacyPage,binding:AuthoringBinding):LegacyRecipientKind {
 const expected=new URL('/GameDetails.aspx?gid='+binding.gameId,'https://'+binding.domain);
 if(page.status!==200||page.html.length>2000000||page.url!==expected.href)return 'unknown';
 const nodes=(node:DefaultTreeAdapterMap['node']):DefaultTreeAdapterMap['node'][]=>[node,...('childNodes'in node?node.childNodes.flatMap(nodes):[])];
 const text=(node:DefaultTreeAdapterMap['node']):string=>'value'in node?node.value:'childNodes'in node?node.childNodes.map(text).join(''):'';
 const rows=nodes(parse(page.html)).filter(node=>'tagName'in node&&node.tagName==='tr').map(row=>'childNodes'in row?row.childNodes.filter(node=>'tagName'in node&&['td','th'].includes(node.tagName)).map(node=>text(node).replace(/\s+/g,' ').trim()):[]).filter(cells=>cells[0]==='\u0418\u0433\u0440\u0430\u0435\u043c:');
 return rows.length===1&&rows[0].length===2&&rows[0][1]==='\u0412 \u043e\u0434\u0438\u043d\u043e\u0447\u043a\u0443'?'user':'unknown';
}
