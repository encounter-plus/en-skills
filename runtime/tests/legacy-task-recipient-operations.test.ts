import test from 'node:test';import assert from 'node:assert/strict';
import {authoringBinding,authoringMetadata} from '../../src/authoring-api.ts';
import {EncounterOperations} from '../src/operations-core.ts';
import {executeRuntimeOperation} from '../src/operation-inputs.ts';
import type {ApiLike,ApiRequestOptions} from '../src/types.ts';
test('runtime recipient-only task changes omit stale typed aliases and preserve literal text/newline flag',async()=>{
 for(const member of [0,77]){
  let task:Record<string,unknown>={task_id:31,task_text:'Literal\n001',replace_nl_to_br:true,for_member_id:member,...(member?{for_user_id:member}:{for_user_id:0,for_team_id:0}),_authoring_revision:'observed-task',_authoring_task_update:{available:false,reason:'text conversion guard'}};
  const metadata=authoringMetadata(authoringBinding('tech.en.cx',42,'task-native'),['task-update']),writes:ApiRequestOptions[]=[];
  const api:ApiLike={authoringMetadata:async()=>metadata,async request<T>(method:string,path:string,options:ApiRequestOptions={}){if(path.includes('live-statistics'))throw new Error('Native statistics unavailable');if(method==='PUT'){writes.push(options);const body=options.body as Record<string,unknown>;task={...task,...body};delete task.for_user_id;delete task.for_team_id;return {}as T;}return {level:{level_id:9,level_number:1},tasks:[structuredClone(task)]}as T;}};
  const operations=new EncounterOperations(api,{name:'fixture',apiBaseUrl:'https://tech.en.cx',webBaseUrl:'https://tech.en.cx',domain:'tech.en.cx'},{writesEnabled:()=>true,saveSnapshot:async()=>''});
  await executeRuntimeOperation(operations,'update-task',{gameId:42,levelId:9,taskId:31,forMemberId:88,confirmed:true});assert.deepEqual(writes[0].body,{for_member_id:88});assert.equal(writes[0].headers?.['X-Authoring-Expected-Revision'],'observed-task');assert.equal(task.task_text,'Literal\n001');assert.equal(task.replace_nl_to_br,true);assert.equal(task.for_member_id,88);
 }
});
test('runtime legacy task text verifies native LF normalization and explicit newline checkbox values',async()=>{
 for(const replaceNlToBr of [false,true]){
  let task={task_id:31,task_text:'Before',for_member_id:0,replace_nl_to_br:!replaceNlToBr,_authoring_revision:'observed-task'};
  const metadata=authoringMetadata(authoringBinding('tech.en.cx',42,'task-newlines'),['task-update']),writes:ApiRequestOptions[]=[];
  const api:ApiLike={authoringMetadata:async()=>metadata,async request<T>(method:string,path:string,options:ApiRequestOptions={}){if(path.includes('live-statistics'))throw new Error('Unsupported');if(method==='PUT'){writes.push(options);const body=options.body as {task_text:string;replace_nl_to_br:boolean};task={...task,task_text:body.task_text.replace(/\r\n|\r/g,'\n'),replace_nl_to_br:body.replace_nl_to_br};return {}as T;}return {level:{level_id:9,level_number:1},tasks:[structuredClone(task)]}as T;}};
  const operations=new EncounterOperations(api,{name:'fixture',apiBaseUrl:'https://tech.en.cx',webBaseUrl:'https://tech.en.cx',domain:'tech.en.cx'},{writesEnabled:()=>true,saveSnapshot:async()=>''});
  await executeRuntimeOperation(operations,'update-task',{gameId:42,levelId:9,taskId:31,taskText:'A\r\nB\rC',replaceNlToBr,confirmed:true});assert.equal(task.task_text,'A\nB\nC');assert.equal(task.replace_nl_to_br,replaceNlToBr);assert.equal((writes[0].body as Record<string,unknown>).replace_nl_to_br,replaceNlToBr);
 }
});
