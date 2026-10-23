import test from 'node:test';import assert from 'node:assert/strict';
import {legacyAnswerOperationSpec as spec} from '../src/legacy-answer-operation-specs.ts';
const row={answer_id:31,answer_text:'001',sector_id:71,for_member_id:0,for_user_id:0,for_team_id:0};
const before={game_id:42,level_id:9,version:'observed',preservation_version:'siblings',creation_preservation_version:'creation',inventory_preservation_version:'inventory',answer_form_proofs:[{sector_id:71,preservation_version:'form'}],answers:[row],sectors:[{sector_id:71}]};
test('reviewed answer operations validate exact IDs and preserved sibling proofs',()=>{
 const update=spec.validate({action:'update',levelId:9,answerId:31,answerText:' 002 + & '}),after={...before,answers:[{...row,answer_text:' 002 + & '}]};
 spec.checkBefore!(before,update);assert.equal(spec.verify(before,after,update),true);assert.equal(spec.verify(before,{...after,preservation_version:'changed'},update),false);
 for(const invalid of [{action:'update',levelId:9,answerId:31,answerText:''},{action:'delete',levelId:9,answerId:31,answerText:'x'},{action:'create',levelId:9,sectorId:0,answerText:'x'}])assert.throws(()=>spec.validate(invalid));
 const create=spec.validate({action:'create',levelId:9,sectorId:71,answerText:'003'}),created={...before,answers:[row,{...row,answer_id:32,answer_text:'003'}]};spec.checkBefore!(before,create);assert.equal(spec.verify(before,created,create),true);assert.equal(spec.verify(before,{...created,answer_form_proofs:[{sector_id:71,preservation_version:'changed hidden'}]},create),false);
 const deletion=spec.validate({action:'delete',levelId:9,answerId:31,sectorId:71});assert.equal(spec.verify(before,{...before,answers:[]},deletion),true);
});
