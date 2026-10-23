import test from 'node:test';import assert from 'node:assert/strict';
import {verifyAdminBatch} from '../src/en-skills-batch.ts';
test('batch read-back requires exact fields, unique new IDs, preserved recipients and same level',()=>{
 const before={game_id:42,level:{level_id:9},tasks:[{task_id:1,task_text:'before',for_team_id:7,for_user_id:0}],answers:[],sectors:[{sector_id:5}]};
 const after={...before,tasks:[{task_id:1,task_text:'after',for_team_id:7,for_user_id:0}],answers:[{answer_id:6,answer_text:'001',for_team_id:0,for_user_id:0}],sectors:[]};
 const ops=[{entity:'task',op:'update',id:1,fields:{task_text:'after'}},{entity:'answer',op:'create',fields:{answer_text:'001'}},{entity:'sector',op:'delete',id:5}];
 assert.equal(verifyAdminBatch(before,after,ops),true);assert.equal(verifyAdminBatch(before,before,ops),false);
 assert.equal(verifyAdminBatch(before,{...after,tasks:[{...after.tasks[0],for_team_id:8}]},ops),false);
 assert.equal(verifyAdminBatch(before,{...after,answers:[...after.answers,{...after.answers[0],answer_id:7}]},ops),false);
 assert.equal(verifyAdminBatch(before,{...after,level:{level_id:10}},ops),false);
});
