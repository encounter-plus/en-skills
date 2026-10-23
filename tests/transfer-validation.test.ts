import test from 'node:test';import assert from 'node:assert/strict';
import {validateTransferOp,validateSettings,validateLevelStep} from '../src/transfer-api.ts';
const op={entity:'task',op:'create',tmp_id:'t1',fields:{task_text:'Hello'}} as const;
test('reject unknown fields, destructive ops, wrong scalar types and temporary foreign refs',()=>{
 assert.deepEqual(validateTransferOp(op),[]);
 for(const value of [{...op,fields:{latitude:1}},{...op,fields:{task_text:7}},{...op,op:'delete'},{entity:'answer',op:'create',fields:{sector_id:'t1'}},{...op,id:9},{...op,fields:{for_member_id:0}}]) assert.ok(validateTransferOp(value).length);
 assert.ok(validateSettings({section:'duration',duration_hours:1}).length===0);
 assert.ok(validateSettings({section:'duration',start_date_time:'x'}).length>0);
});
test('level step rejects fields from another entity',()=>{assert.deepEqual(validateLevelStep({kind:'meta',fields:{comment:'note'}}),[]);assert.ok(validateLevelStep({kind:'meta',fields:{task_text:'x'}}).length);});
