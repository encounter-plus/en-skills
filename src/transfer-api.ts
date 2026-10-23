export type TransferEntity='task'|'help'|'penalty_help'|'bonus'|'sector'|'answer';
export interface TransferOp { entity:TransferEntity;op:'create'|'update';id?:number;tmp_id?:string;fields:Record<string,unknown> }
export interface TransferSnapshot { version:string;levelId:number;levelNumber:number;playersStarted:boolean|null;data:Record<string,unknown> }
export interface TransferResult { index:number;status:'ok'|'error';id?:number;tmp_id?:string;code?:string }
export interface TransferOutcome { status:'accepted'|'conflict'|'partial'|'unknown'|'rejected';version?:string;results?:TransferResult[] }
export type TransferFieldType='string'|'integer'|'number'|'boolean'|'string[]'|'integer[]';
type Fields=Record<string,TransferFieldType>;
const help:Fields={for_member_id:'integer',help_text:'string',is_penalty:'boolean',penalty_comment:'string',penalty_score:'integer',penalty_time:'integer',request_penalty_confirm:'boolean',timeout:'integer'};
export const TRANSFER_FIELDS:Record<TransferEntity,Fields>={
 task:{for_member_id:'integer',task_text:'string'},help:{...help},penalty_help:{...help},
 bonus:{all_levels:'boolean',answers:'string[]',bonus_help:'string',bonus_name:'string',bonus_time:'integer',delay_sec:'integer',for_member_id:'integer',has_absolute_limit:'boolean',has_delay:'boolean',has_relative_limit:'boolean',level_ids:'integer[]',life_time_sec:'integer',negative:'boolean',task:'string',valid_from:'string',valid_to:'string'},
 sector:{sector_name:'string',task_id:'integer',valid_answer_score_award:'integer',wrong_answer_score_penalty:'integer'},
 answer:{answer_text:'string',for_member_id:'integer',score_award:'integer',sector_id:'integer',time_award:'integer'},
};
export const SETTINGS_FIELDS:Fields={section:'string',start_date_time:'string',duration_hours:'integer',duration_minutes:'integer',duration_seconds:'integer',attempts_number:'integer',attempts_period_hours:'integer',attempts_period_minutes:'integer',attempts_period_seconds:'integer',block_type_id:'integer',required_sectors_count:'integer',restriction_enabled:'boolean',attempts_count:'integer',unrestricted:'boolean',answer_type_id:'integer',buttons_answers_direction_id:'integer',answer_result_display_type_id:'integer',answer_penalty_type_id:'integer',answer_score_penalty:'integer',answer_time_penalty_hours:'integer',answer_time_penalty_minutes:'integer',answer_time_penalty_seconds:'integer',complete_type_id:'integer',pass_limit:'integer',passing_condition_id:'integer',required_answers_num:'integer',required_points:'integer'};
const SECTIONS:Record<string,string[]>={start:['start_date_time'],duration:['duration_hours','duration_minutes','duration_seconds'],blocking:['attempts_number','attempts_period_hours','attempts_period_minutes','attempts_period_seconds','block_type_id'],sectors:['required_sectors_count'],restriction:['restriction_enabled','attempts_count','unrestricted'],answers_settings:['answer_type_id','buttons_answers_direction_id','answer_result_display_type_id','answer_penalty_type_id','answer_score_penalty','answer_time_penalty_hours','answer_time_penalty_minutes','answer_time_penalty_seconds'],pass_rule:['complete_type_id','pass_limit','passing_condition_id','required_answers_num','required_points']};
export const META_FIELDS:Fields={answer_type_id:'integer',comment:'string',level_name:'string'};
export const AUTOPASS_FIELDS:Fields={award_is_penalty:'boolean',penalty_enabled:'boolean',penalty_hours:'integer',penalty_minutes:'integer',penalty_seconds:'integer',points_award:'integer',timeout_hours:'integer',timeout_minutes:'integer',timeout_seconds:'integer'};
export const LEVEL_FIELDS={meta:META_FIELDS,settings:SETTINGS_FIELDS,autopass:AUTOPASS_FIELDS};
export interface TransferLevelStep { kind:keyof typeof LEVEL_FIELDS;fields:Record<string,unknown> }
export function validateLevelStep(value:unknown):string[] {
 if(!record(value)||typeof value.kind!=='string'||!Object.hasOwn(LEVEL_FIELDS,value.kind))return ['unsupported level step'];
 if(Object.keys(value).some(key=>key!=='kind'&&key!=='fields'))return ['unsupported level step property'];
 return value.kind==='settings'?validateSettings(value.fields):validateTransferFields(value.fields,LEVEL_FIELDS[value.kind as keyof typeof LEVEL_FIELDS]);
}
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function validateTransferFields(value:unknown,schema:Fields):string[] {
 if(!record(value)||!Object.keys(value).length)return ['fields must be a nonempty object'];
 return Object.entries(value).flatMap(([key,v])=>{
  if(!Object.hasOwn(schema,key))return [`unsupported field: ${key}`]; const type=schema[key];
  const valid=type==='integer'?typeof v==='number'&&Number.isSafeInteger(v):type==='number'?typeof v==='number'&&Number.isFinite(v):type==='string[]'?Array.isArray(v)&&v.every(x=>typeof x==='string'):type==='integer[]'?Array.isArray(v)&&v.every(x=>typeof x==='number'&&Number.isSafeInteger(x)):typeof v===type;
  return valid?[]:[`invalid type: ${key}`];
 });
}
export function validateTransferOp(value:unknown):string[] {
 if(!record(value)||typeof value.entity!=='string'||!Object.hasOwn(TRANSFER_FIELDS,value.entity))return ['unsupported entity'];
 const errors=validateTransferFields(value.fields,TRANSFER_FIELDS[value.entity as TransferEntity]);
 if(Object.keys(value).some(key=>!['entity','op','id','tmp_id','fields'].includes(key)))errors.push('unsupported operation property');
 if(value.op!=='create'&&value.op!=='update')errors.push('unsupported operation');
 if(value.op==='update'&&(!positive(value.id)||value.tmp_id!==undefined))errors.push('update requires persistent id only');
 if(value.op==='create'&&(value.id!==undefined||(value.tmp_id!==undefined&&(typeof value.tmp_id!=='string'||!value.tmp_id.trim()||value.tmp_id.length>128))))errors.push('invalid create identity');
 if(record(value.fields)) {
  if(value.fields.for_member_id!==undefined&&!positive(value.fields.for_member_id))errors.push('recipient must be explicit positive id or omitted');
  for(const key of ['task_id','sector_id'])if(value.fields[key]!==undefined&&!(typeof value.fields[key]==='number'&&Number.isSafeInteger(value.fields[key])&&(value.fields[key] as number)>=0))errors.push(`invalid reference: ${key}`);
  if(value.fields.is_penalty!==undefined&&value.fields.is_penalty!==(value.entity==='penalty_help'))errors.push('penalty flag disagrees with entity');
 }
 return errors;
}
export function validateSettings(fields:unknown):string[] {
 const errors=validateTransferFields(fields,SETTINGS_FIELDS);
 if(!record(fields)||typeof fields.section!=='string'||!Object.hasOwn(SECTIONS,fields.section))return [...errors,'invalid settings section'];
 for(const key of Object.keys(fields))if(key!=='section'&&!SECTIONS[fields.section].includes(key))errors.push(`field outside section: ${key}`);
 if(Object.keys(fields).length<2)errors.push('settings section is empty');return errors;
}
