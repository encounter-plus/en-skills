import {validateSheetImport} from './sheet-import.ts';
import type {SheetImport,SheetEntity} from './sheet-import.ts';
import {TRANSFER_FIELDS,LEVEL_FIELDS,validateTransferOp,validateLevelStep} from './transfer-api.ts';
import type {TransferOp,TransferSnapshot} from './transfer-api.ts';
export type ChangeStatus = 'pending'|'rejected'|'applying'|'applied'|'conflict'|'partial'|'unknown'|'blocked';
import {authoringBinding,sameAuthoringBinding} from './authoring-api.ts';
import type {AuthoringBinding} from './authoring-api.ts';

export type LevelKind='meta'|'settings'|'autopass';
export type TransferStep={kind:'batch';ops:TransferOp[]}|{kind:LevelKind;fields:Record<string,unknown>};
export interface TransferItem {entity:TransferOp['entity']|LevelKind;group:string;id?:number;fields:Record<string,unknown>;before:Record<string,unknown>;existingIds:number[];cells:string[]}
export interface TransferPlan {authoringBinding?:Readonly<AuthoringBinding>;id:string;scope:{domain:string;gameId:number};levelId:number;levelNumber:number;baseVersion:string;sourceKey:string;createdAt:number;status:ChangeStatus;items:TransferItem[];steps:TransferStep[];completed:number;results:{index:number;id?:number;status:string}[]}
export interface TransferBinding {entryId:string;field:string;target:string;value:string}
export const entityMap:Record<SheetEntity,TransferOp['entity']| 'level'>={level:'level',task:'task',answer:'answer',hint:'help',penalty_hint:'penalty_help',bonus:'bonus',penalty_bonus:'bonus',sector:'sector'};
export const collection:Record<TransferOp['entity'],string>={task:'tasks',answer:'answers',help:'helps',penalty_help:'penalty_helps',bonus:'bonuses',sector:'sectors'};
export const idField:Record<TransferOp['entity'],string>={task:'task_id',answer:'answer_id',help:'help_id',penalty_help:'help_id',bonus:'bonus_id',sector:'sector_id'};
const sections:Record<string,string>={answer_type_id:'answers_settings',buttons_answers_direction_id:'answers_settings',answer_result_display_type_id:'answers_settings',answer_penalty_type_id:'answers_settings',answer_score_penalty:'answers_settings',answer_time_penalty_hours:'answers_settings',answer_time_penalty_minutes:'answers_settings',answer_time_penalty_seconds:'answers_settings',start_date_time:'start',duration_hours:'duration',duration_minutes:'duration',duration_seconds:'duration',attempts_number:'blocking',attempts_period_hours:'blocking',attempts_period_minutes:'blocking',attempts_period_seconds:'blocking',block_type_id:'blocking',required_answers_num:'pass_rule',required_sectors_count:'sectors',required_points:'pass_rule',passing_condition_id:'pass_rule',pass_limit:'pass_rule',complete_type_id:'pass_rule'};
function assert(ok:unknown,message:string):asserts ok {if(!ok)throw new Error(message);}
const positive=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0;
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function sourceKey(sheet:SheetImport):string {const checked=validateSheetImport(sheet);return JSON.stringify({table:checked.table,draft:checked.draft});}
export function rows(snapshot:TransferSnapshot,entity:TransferOp['entity']):Record<string,unknown>[] {
  const value=snapshot.data[collection[entity]];
  assert(Array.isArray(value),'Incomplete entity collection');
  assert(value.every(row=>row&&typeof row==='object'&&positive(row[idField[entity]])),'Invalid entity IDs');
  return value;
}
export function levelFields(snapshot:TransferSnapshot,kind:LevelKind):Record<string,unknown> {
  const d=snapshot.data,level=d.level as Record<string,unknown>;
  if(kind==='meta')return {comment:level.comment,level_name:level.level_name,answer_type_id:d.answer_type_id};
  const output:Record<string,unknown>={...d};
  const split=(prefix:string,raw:unknown)=>{if(typeof raw==='number'&&Number.isSafeInteger(raw)&&raw>=0){output[`${prefix}_hours`]=Math.floor(raw/3600);output[`${prefix}_minutes`]=Math.floor(raw/60)%60;output[`${prefix}_seconds`]=raw%60;}};
  split('duration',d.duration_sec);split('attempts_period',d.attempts_period_sec);split('answer_time_penalty',d.answer_time_penalty_sec);split('timeout',d.timeout_sec);
  // Flags of autopass penalties cannot be reconstructed reliably from a zero award.
  output.points_award=d.timeout_points_award;
  return output;
}
export function projected(row:Record<string,unknown>,entity:TransferItem['entity']):Record<string,unknown> {
  const result={...row};
  if(entity==='task'||entity==='answer'||entity==='help'||entity==='penalty_help'||entity==='bonus') {
    const user=entity==='bonus'?row.user_id:row.for_user_id,team=entity==='bonus'?row.team_id:row.for_team_id;
    result.for_member_id=positive(user)&&!positive(team)?user:positive(team)&&!positive(user)?team:user===0&&team===0?0:undefined;
    result.__recipient=positive(user)?`user:${user}`:positive(team)?`team:${team}`:user===0&&team===0?'all':undefined;
  }
  return result;
}
function parseValue(raw:string,type:string):unknown {
  assert(raw.trim()!=='','Empty values require editing the source mapping; no implicit deletion');
  if(type==='string')return raw;
  if(type==='integer'||type==='number'){assert(/^-?\d+$/.test(raw.trim()),'Use an explicit integer in the field units');const n=Number(raw);assert(Number.isSafeInteger(n),'Invalid integer');return n;}
  if(type==='boolean'){assert(raw==='true'||raw==='false','Use true or false');return raw==='true';}
  let value:unknown;try{value=JSON.parse(raw);}catch{throw new Error('Use an explicit JSON array, preserving code strings');}
  assert(Array.isArray(value),'Use an explicit JSON array');return value;
}
export function compileTransfer(input:{scope:{domain:string;gameId:number};sheet:SheetImport;snapshot:TransferSnapshot;bindings:TransferBinding[]}):TransferPlan {
  const sheet=validateSheetImport(input.sheet),snap=input.snapshot;
  assert(sheet.draft,'Prepare and review the source draft first');
  assert(sheet.draft.issues.length===0,'Resolve draft issues before transfer');
  assert(snap.playersStarted===false,'Transfer requires a level with no started players');
  assert(snap.data.game_id===input.scope.gameId,'Game changed');
  assert(input.bindings.length===sheet.draft.entries.length,'Every source field must be mapped');
  const grouped=new Map<string,TransferItem>();
  const seen=new Set<string>();
  for(const entry of sheet.draft.entries) {
    assert(!entry.note.trim(),'Resolve field notes before transfer');
    const binding=input.bindings.find(row=>row.entryId===entry.id);assert(binding&&!seen.has(binding.entryId),'Missing or duplicate source binding');seen.add(binding.entryId);
    let entity:TransferItem['entity'];let field=binding.field;let section='';
    if(entry.entity==='level') {const parts=field.split('.');entity=parts[0] as LevelKind;field=parts[1];assert(['meta','settings','autopass'].includes(entity),'Choose a supported level field');if(entity==='settings'){section=sections[field];assert(section,'This setting has no confirmed round-trip mapping');}}
    else entity=entityMap[entry.entity] as TransferOp['entity'];
    const metadata=entity in collection?TRANSFER_FIELDS[entity as TransferOp['entity']]:LEVEL_FIELDS[entity as LevelKind];
    assert(Object.hasOwn(metadata,field),'Choose an explicit supported field');
    const key=entry.entity==='level'?`level:${entity}:${section}`:`${entry.entity}:${entry.group}:${entity}:${section}`;
    let item=grouped.get(key);
    const target=binding.target==='new'?undefined:Number(binding.target);
    if(!item){
      let before:Record<string,unknown>={},existingIds:number[]=[];
      if(entity in collection){const list=rows(snap,entity as TransferOp['entity']);existingIds=list.map(row=>Number(row[idField[entity as TransferOp['entity']]]));
        if(target!==undefined){assert(positive(target),'Choose a target');const row=list.find(row=>row[idField[entity as TransferOp['entity']]]===target);assert(row,'Target does not belong to level');before=projected(row,entity);}
      }else before=levelFields(snap,entity as LevelKind);
      item={entity,group:entry.group,...(target===undefined?{}:{id:target}),fields:section?{section}:{},before,existingIds,cells:[]};grouped.set(key,item);
    }
    assert(item.id===target,'Fields of one entity must have the same target');
    assert(!Object.hasOwn(item.fields,field),'Duplicate field: split different entities into separate groups');
    item.fields[field]=parseValue(binding.value,metadata[field]);item.cells.push(...entry.cells);
  }
  const items=[...grouped.values()];
  for(const item of items){
    if(item.entity==='bonus') item.fields.negative=[...grouped.entries()].find(([,value])=>value===item)![0].startsWith('penalty_bonus:');
    if(item.entity==='help'||item.entity==='penalty_help')item.fields.is_penalty=item.entity==='penalty_help';
    if(item.fields.for_member_id===0){assert(item.id===undefined||item.before.__recipient==='all','Cannot reset an individual recipient by omitting for_member_id');delete item.fields.for_member_id;}
    if(item.entity in collection){
      if(item.entity==='bonus'){
        assert(item.fields.all_levels!==true&&item.before.all_levels!==true,'A level transfer cannot edit a bonus shared by all levels');
        for(const ids of [item.fields.level_ids,item.before.level_ids])if(ids!==undefined)assert(Array.isArray(ids)&&ids.every(id=>id===snap.levelId),'Bonus is shared with another level');
        if(item.id===undefined){item.fields.all_levels=false;item.fields.level_ids=[snap.levelId];assert(Array.isArray(item.fields.answers)&&item.fields.answers.length>0,'Provide an explicit JSON array of bonus codes');}
      }
      if(item.id===undefined){const required={task:'task_text',answer:'answer_text',sector:'sector_name',help:'help_text',penalty_help:'help_text',bonus:'bonus_name'}[item.entity as TransferOp['entity']];assert(required in item.fields,`Missing ${required}`);}
      else {const same=items.filter(other=>other.entity===item.entity&&other.id===item.id);assert(same.length===1,'One update per target');if('__recipient' in item.before)assert(item.before.__recipient!==undefined,'Recipient is unknown');}
      for(const foreign of ['task_id','sector_id'])if(item.fields[foreign]!==undefined){const entity=foreign==='task_id'?'task':'sector';assert(rows(snap,entity).some(row=>row[foreign]===item.fields[foreign]),'Select an existing linked task/sector; temporary references are not documented');}
    }else {
      // PUT sections must retain observed sibling values, not implicitly reset them.
      const metadata=LEVEL_FIELDS[item.entity as LevelKind];
      for(const field of Object.keys(metadata))if(field!=='section'&&(item.entity!=='settings'||sections[field]===item.fields.section)){
        assert(item.before[field]!==undefined,`Cannot preserve unversioned section field ${field}`);
        if(!Object.hasOwn(item.fields,field))item.fields[field]=item.before[field];
      }
    }
    for(const field of Object.keys(item.fields))if(field!=='section'&&(item.id!==undefined||!(item.entity in collection)))assert(item.before[field]!==undefined,`Cannot verify existing field ${field}`);
    item.cells=[...new Set(item.cells)];
    const before:Record<string,unknown>={};for(const field of Object.keys(item.fields))if(item.before[field]!==undefined)before[field]=item.before[field];
    if(item.before.__recipient!==undefined)before.__recipient=item.before.__recipient;
    item.before=before;
  }
  const ops=items.filter(item=>item.entity in collection).map((item,index)=>({entity:item.entity as TransferOp['entity'],op:item.id?'update' as const:'create' as const,...(item.id?{id:item.id}:{tmp_id:`sheet_${index}`}),fields:item.fields}));
  for(const op of ops)assert(validateTransferOp(op).length===0,validateTransferOp(op).join('; '));
  const steps:TransferStep[]=ops.length?[{kind:'batch',ops}]:[];
  for(const item of items.filter(item=>!(item.entity in collection))){const step={kind:item.entity as LevelKind,fields:item.fields};assert(validateLevelStep(step).length===0,validateLevelStep(step).join('; '));steps.push(step);}
  const plan:TransferPlan={id:crypto.randomUUID(),scope:{...input.scope},levelId:snap.levelId,levelNumber:snap.levelNumber,baseVersion:snap.version,sourceKey:sourceKey(sheet),createdAt:Date.now(),status:'pending',items,steps,completed:0,results:[]};
  validateTransferPlan(plan);return plan;
}
export function validateTransferPlan(plan:TransferPlan):void {
  assert(plan&&typeof plan==='object'&&/^[\w-]+$/.test(plan.id),'Invalid transfer');
  assert(plan.scope&&/^[a-z0-9.-]+$/.test(plan.scope.domain)&&positive(plan.scope.gameId)&&positive(plan.levelId)&&positive(plan.levelNumber),'Invalid scope');
  if(plan.authoringBinding!==undefined)assert(sameAuthoringBinding(plan.authoringBinding,authoringBinding(plan.scope.domain,plan.scope.gameId,plan.authoringBinding.sessionEpoch)),'Invalid authoring binding');
  assert(typeof plan.sourceKey==='string'&&plan.sourceKey.length<=120000&&typeof plan.baseVersion==='string'&&plan.baseVersion.length>0,'Invalid source/version');
  assert(Array.isArray(plan.steps)&&plan.steps.length>0&&plan.steps.length<=101&&Array.isArray(plan.items)&&plan.items.length<=100,'Invalid steps');
  assert(['pending','applying','applied','rejected','blocked','conflict','partial','unknown'].includes(plan.status),'Invalid status');
  assert(Number.isSafeInteger(plan.completed)&&plan.completed>=0&&plan.completed<=plan.steps.length&&Array.isArray(plan.results),'Invalid progress');
  assert(Number.isSafeInteger(plan.createdAt)&&plan.createdAt>=0,'Invalid time');
  for(const item of plan.items){
    assert(item&&typeof item==='object'&&(Object.hasOwn(collection,item.entity)||['meta','settings','autopass'].includes(item.entity)),'Invalid item');
    assert(typeof item.group==='string'&&item.group.length<=80&&item.fields&&typeof item.fields==='object'&&item.before&&typeof item.before==='object','Invalid fields');
    assert(item.id===undefined||positive(item.id),'Invalid target');
    assert(Array.isArray(item.existingIds)&&item.existingIds.every(positive)&&new Set(item.existingIds).size===item.existingIds.length,'Invalid baseline IDs');
    assert(Array.isArray(item.cells)&&item.cells.length>0&&item.cells.every(cell=>typeof cell==='string'&&/^[A-Z]{1,3}[1-9]\d*$/.test(cell)),'Invalid provenance');
  }
  const ops=plan.items.filter(item=>Object.hasOwn(collection,item.entity)).map((item,index)=>({entity:item.entity,op:item.id?'update':'create',...(item.id?{id:item.id}:{tmp_id:`sheet_${index}`}),fields:item.fields}));
  const expected:unknown[]=ops.length?[{kind:'batch',ops}]:[];
  for(const item of plan.items.filter(item=>!Object.hasOwn(collection,item.entity)))expected.push({kind:item.entity,fields:item.fields});
  assert(equal(plan.steps,expected),'Cards and executable operations differ');
  assert(plan.results.length<=ops.length&&new Set(plan.results.map(result=>result.index)).size===plan.results.length,'Invalid receipts');
  for(const result of plan.results)assert(Number.isInteger(result.index)&&result.index>=0&&result.index<ops.length&&['ok','error'].includes(result.status)&&(result.id===undefined||positive(result.id)),'Invalid receipt');
  for(const step of plan.steps)if(step.kind==='batch'){assert(Array.isArray(step.ops)&&step.ops.length<=200,'Invalid batch');for(const op of step.ops)assert(validateTransferOp(op).length===0,'Invalid operation');}else assert(validateLevelStep(step).length===0,'Invalid level step');
  assert(JSON.stringify(plan).length<=300000,'Transfer is too large');
}
export function conflictsWithTransfer(plan:TransferPlan,others:TransferPlan[]):boolean {
  return others.some(other=>other.id!==plan.id&&equal(other.scope,plan.scope)&&other.levelId===plan.levelId&&(['applying','partial','unknown'].includes(other.status)||(other.sourceKey===plan.sourceKey&&['pending','applied'].includes(other.status))));
}
function actual(item:TransferItem,snapshot:TransferSnapshot,results:TransferPlan['results'],index:number):Record<string,unknown>|null {
  if(!(item.entity in collection))return levelFields(snapshot,item.entity as LevelKind);
  const entity=item.entity as TransferOp['entity'],list=rows(snapshot,entity);
  const id=item.id??results.find(row=>row.index===index&&row.status==='ok')?.id;
  if(id){if(item.id===undefined&&item.existingIds.includes(id))return null;const row=list.find(row=>row[idField[entity]]===id);return row?projected(row,entity):null;}
  const matches=list.filter(row=>!item.existingIds.includes(Number(row[idField[entity]]))).map(row=>projected(row,entity)).filter(row=>matchesFields(item,row));
  return matches.length===1?matches[0]:null;
}
function matchesFields(item:TransferItem,row:Record<string,unknown>):boolean {
  if(item.id===undefined&&item.entity in collection&&'__recipient' in row&&item.fields.for_member_id===undefined&&row.__recipient!=='all')return false;
  if(item.id!==undefined&&item.before.__recipient!==undefined&&item.fields.for_member_id===undefined&&item.before.__recipient!==row.__recipient)return false;
  return Object.entries(item.fields).every(([key,value])=>key==='section'||equal(row[key],value));
}
export function verifyTransfer(plan:TransferPlan,snapshot:TransferSnapshot,results=plan.results):boolean {
  if(snapshot.levelId!==plan.levelId||snapshot.data.game_id!==plan.scope.gameId)return false;
  let index=0;const used=new Set<string>();return plan.items.every(item=>{const current=actual(item,snapshot,results,item.entity in collection?index++:-1);if(!current||!matchesFields(item,current))return false;if(item.entity in collection){const key=`${item.entity}:${current[idField[item.entity as TransferOp['entity']]]}`;if(used.has(key))return false;used.add(key);}return true;});
}
export function verifyStep(plan:TransferPlan,stepIndex:number,snapshot:TransferSnapshot,results:TransferPlan['results']):boolean {
  const step=plan.steps[stepIndex];const items=step.kind==='batch'?plan.items.filter(item=>item.entity in collection):plan.items.filter(item=>item.entity===step.kind&&equal(item.fields,step.fields));
  const used=new Set<string>();return items.every((item,index)=>{const current=actual(item,snapshot,results,index);if(!current||!matchesFields(item,current))return false;if(item.entity in collection){const key=`${item.entity}:${current[idField[item.entity as TransferOp['entity']]]}`;if(used.has(key))return false;used.add(key);}return true;});
}
export function unchangedPending(plan:TransferPlan,snapshot:TransferSnapshot,fromStep:number):boolean {
  if(snapshot.playersStarted!==false||snapshot.levelId!==plan.levelId||snapshot.data.game_id!==plan.scope.gameId)return false;
  const pending=plan.steps.slice(fromStep);
  return plan.items.filter(item=>pending.some(step=>step.kind==='batch'?item.entity in collection:step.kind===item.entity&&equal(step.fields,item.fields))).every(item=>{
    if(item.id===undefined&&item.entity in collection)return equal(rows(snapshot,item.entity as TransferOp['entity']).map(row=>row[idField[item.entity as TransferOp['entity']]]),item.existingIds);
    const row=actual(item,snapshot,[],0);return row!==null&&Object.entries(item.before).every(([key,value])=>equal(row[key],value));
  });
}
