import {collection,idField,projected} from './transfer-plan.ts';
import type {TransferEntity} from './transfer-api.ts';

/** Read-only evidence check; successful HTTP operation statuses alone are insufficient. */
export function verifyAdminBatch(before:Record<string,unknown>,after:Record<string,unknown>,ops:any[],results:Record<string,unknown>[]=[]):boolean {
 if(after.game_id!==before.game_id||(after.level as any)?.level_id!==(before.level as any)?.level_id)return false;
 const used=new Set<string>();
 return ops.every((op,index)=>{
  const entity=op.entity as TransferEntity,key=idField[entity],name=collection[entity];
  const original=before[name],current=after[name];if(!Array.isArray(original)||!Array.isArray(current))return false;
  const old=original.find(row=>row[key]===op.id);
  if(op.op==='delete')return !!old&&!current.some(row=>row[key]===op.id);
  const matches=(candidate:Record<string,unknown>)=>{
    const row=projected(candidate,entity);
    if(!Object.entries(op.fields??{}).every(([field,value])=>JSON.stringify(row[field])===JSON.stringify(value)))return false;
    if(['task','answer','help','penalty_help','bonus'].includes(entity)&&op.fields?.for_member_id===undefined) {
      const expected=old?projected(old,entity).__recipient:'all';if(typeof expected!=='string'||row.__recipient!==expected)return false;
    }
    return true;
  };
  const resultId=results.find(row=>row.index===index&&row.status==='ok')?.id;
  const candidates=current.filter(row=>Number.isSafeInteger(row[key])&&Number(row[key])>0&&(op.op==='update'?row[key]===op.id:!original.some(old=>old[key]===row[key])&&(!resultId||row[key]===resultId))&&matches(row));
  if(op.op==='update'&&!old||candidates.length!==1)return false;
  const identity=entity+':'+candidates[0][key];if(used.has(identity))return false;used.add(identity);return true;
 });
}
