import {legacyRecipientFields} from './legacy-recipients.ts';
import {AuthoringApiError,type AuthoringApiPort,type AuthoringCapability} from './authoring-api.ts';

type Row=Record<string,unknown>;
export interface LegacyAnswerOperationArgs extends Row {action:'create'|'update'|'delete';levelId:number;answerId?:number;sectorId?:number;answerText?:string;forMemberId?:number}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const rows=(value:Row,key='answers')=>value[key] as Row[];
export function requireLegacyCapability(api:AuthoringApiPort,capability:AuthoringCapability){if(api.metadata.binding.engine!=='legacy'||!api.metadata.capabilities[capability]?.available)throw new AuthoringApiError('unsupported');}
export const legacyAnswerOperation={
 async read(api:AuthoringApiPort,args:LegacyAnswerOperationArgs,signal?:AbortSignal):Promise<Row>{
  requireLegacyCapability(api,args.action==='create'?'answer-create':args.action==='delete'?'answer-delete':'answer-update');
  const response=await api.request(`/admin/games/${api.metadata.binding.gameId}/levels/${args.levelId}/answers`,{signal,headers:args.action==='create'?{'X-Authoring-Answer-Create':'1'}:{'X-Authoring-Preserve-Answer':String(args.answerId),...(args.action==='delete'?{'X-Authoring-Delete-Answer':'1','X-Authoring-Answer-Sector':String(args.sectorId)}:{})}});
  if(!response.ok)throw new Error('Exact answer inventory unavailable');const body=await response.json();
  if(body.game_id!==api.metadata.binding.gameId||body.level_id!==args.levelId||typeof body.version!=='string'||typeof body.preservation_version!=='string'||!Array.isArray(body.answers)||!Array.isArray(body.sectors))throw new Error('Incomplete answer inventory');return body;
 },
 checkBefore(before:Row,args:LegacyAnswerOperationArgs){
  if(args.action==='create'){if(!Array.isArray(before.sectors)||!rows(before,'sectors').some(row=>row.sector_id===args.sectorId)||typeof before.creation_preservation_version!=='string')throw new Error('Sector outside selected level');return;}
  if(rows(before).filter(row=>row.answer_id===args.answerId&&(args.action!=='delete'||row.sector_id===args.sectorId)).length!==1)throw new Error('Answer outside selected level');
 },
 request(api:AuthoringApiPort,args:LegacyAnswerOperationArgs,before:Row){
  requireLegacyCapability(api,args.action==='create'?'answer-create':args.action==='delete'?'answer-delete':'answer-update');
  this.checkBefore(before,args);
  return api.request(`/admin/games/${api.metadata.binding.gameId}/levels/${args.levelId}/answers${args.action==='create'?'':'/'+args.answerId}`,{method:args.action==='create'?'POST':args.action==='delete'?'DELETE':'PUT',headers:{'Content-Type':'application/json','If-Match':String(before.version)},...(args.action==='delete'?{}:{body:JSON.stringify({answer_text:args.answerText,...(args.forMemberId===undefined?{}:{for_member_id:args.forMemberId}),...(args.action==='create'?{sector_id:args.sectorId}:{})})})});
 },
 verify(before:Row,after:Row,args:LegacyAnswerOperationArgs){
  if(after.game_id!==before.game_id||after.level_id!==before.level_id||args.action!=='create'&&after.preservation_version!==before.preservation_version||!equal(before.sectors,after.sectors)||!Array.isArray(after.answers))return false;
  if(args.action==='create'){const oldIds=new Set(rows(before).map(row=>row.answer_id)),created=rows(after).filter(row=>!oldIds.has(row.answer_id));return after.creation_preservation_version===before.creation_preservation_version&&Array.isArray(before.answer_form_proofs)&&Array.isArray(after.answer_form_proofs)&&rows(before,'answer_form_proofs').every(proof=>rows(after,'answer_form_proofs').some(row=>equal(row,proof)))&&created.length===1&&created[0].answer_text===args.answerText&&created[0].sector_id===args.sectorId&&created[0].for_member_id===(args.forMemberId??0)&&equal(rows(after).filter(row=>oldIds.has(row.answer_id)),rows(before));}
  const expected=args.action==='delete'?rows(before).filter(row=>row.answer_id!==args.answerId):rows(before).map(row=>{if(row.answer_id!==args.answerId)return row;const {for_member_id,for_user_id,for_team_id,recipient,...rest}=row;return args.forMemberId===undefined?{...row,answer_text:args.answerText??row.answer_text}:{...rest,answer_text:args.answerText??row.answer_text,...legacyRecipientFields(args.forMemberId,(recipient as {options:{member_id:number;label:string}[]}).options,(recipient as {kind:'user'|'team'|'unknown'}).kind)};});const ordered=(value:Row[])=>value.map(row=>Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))));return equal(ordered(expected),ordered(after.answers as Row[]));
 },
};

export async function readLegacyMessageInventory(api:AuthoringApiPort,levelId:number,signal?:AbortSignal):Promise<Row>{
 requireLegacyCapability(api,'message-update');const response=await api.request(`/admin/games/${api.metadata.binding.gameId}/levels/${levelId}/messages`,{signal});if(!response.ok)throw new Error('Message inventory unavailable');const body=await response.json();if(body.game_id!==api.metadata.binding.gameId||body.level_id!==levelId||typeof body.version!=='string'||!Array.isArray(body.messages))throw new Error('Incomplete message inventory');return body;
}
export function legacyMessageCreateRequest(before:Row,input:{messageText:string;levelId:number;allLevels?:boolean;levelIds?:number[];replaceNlToBr?:boolean}){
 const targets=input.allLevels?input.levelIds:[input.levelId];if(!targets?.length||targets.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(targets).size!==targets.length||!targets.includes(input.levelId)||input.levelIds!==undefined&&!input.allLevels)throw new AuthoringApiError('unsupported');
 return legacyMessageOperationRequest(before,{action:'create',fields:{message_text:input.messageText,all_levels:input.allLevels??false,level_ids:targets,replace_nl_to_br:input.replaceNlToBr??false}});
}
export function legacyMessageOperationRequest(before:Row,args:{action:unknown;messageId?:unknown;fields?:unknown}):RequestInit{
 return {method:args.action==='create'?'POST':args.action==='update'?'PUT':'DELETE',headers:{'If-Match':String(before.version),'Content-Type':'application/json'},...(args.action==='delete'?{}:{body:JSON.stringify(args.fields)})};
}
export function verifyLegacyMessageCreate(before:Row,after:Row,input:{messageText:string;levelId:number;allLevels?:boolean;levelIds?:number[];replaceNlToBr?:boolean}){
 if(after.game_id!==before.game_id||after.level_id!==before.level_id||!Array.isArray(after.messages))return false;
 const previous=rows(before,'messages'),oldIds=new Set(previous.map(row=>row.message_id)),created=rows(after,'messages').filter(row=>!oldIds.has(row.message_id));
 const targets=input.allLevels?input.levelIds:[input.levelId];
 return !!targets?.length&&created.length===1&&created[0].message_text===input.messageText.replace(/\r\n|\r/g,'\n')&&created[0].all_levels===(input.allLevels??false)&&created[0].replace_nl_to_br===(input.replaceNlToBr??false)&&Array.isArray(created[0].level_ids)&&equal([...created[0].level_ids as number[]].sort((a,b)=>a-b),[...targets].sort((a,b)=>a-b))&&equal(rows(after,'messages').filter(row=>oldIds.has(row.message_id)),previous);
}

export {validateLegacyAnswerMoveArgs,readLegacyAnswerMoveState,checkLegacyAnswerMoveBefore,prepareLegacyAnswerMove,executeLegacyAnswerMove,verifyLegacyAnswerMove} from './legacy-answer-move.ts';
export type {LegacyAnswerMoveArgs,LegacyAnswerMoveState,LegacyAnswerMovePlan,LegacyAnswerMoveJournal,LegacyAnswerMoveJournalStore} from './legacy-answer-move.ts';
