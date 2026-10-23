import test from 'node:test';
import assert from 'node:assert/strict';
import {EncounterOperations} from '../src/operations-core.ts';
import {authoringBinding,authoringMetadata} from '../../src/authoring-api.ts';
import type {ApiLike,ApiRequestOptions} from '../src/types.ts';

test('legacy task and hint edits read only the target, retain revision fences and verify readback',async()=>{
 const metadata=authoringMetadata(authoringBinding('tech.en.cx',42,'targeted-text'),['task-update','hint-update']);
 const calls:{method:string;path:string}[]=[];
 let task={task_id:31,task_text:'Before',for_member_id:77,replace_nl_to_br:false};
 let hint={help_id:51,help_text:'Hint',timeout:300,is_penalty:false,for_user_id:0,for_team_id:0,_authoring_revision:'hint-revision'};
 const api:ApiLike={authoringMetadata:async()=>metadata,async request<T>(method:string,path:string,options:ApiRequestOptions={}){
  calls.push({method,path});
  if(path.includes('live-statistics'))return {is_live:false,current_players:[],passed_players:[]} as T;
  if(path==='/admin/games/42/levels')return {levels:[{level_id:9,level_number:2}]} as T;
  if(path==='/admin/games/42/levels/9/tasks/31'){
   if(method==='PUT'){assert.equal(options.headers?.['X-Authoring-Expected-Revision'],'task-revision');task={...task,...options.body as object};return {} as T;}
   return {level:{level_id:9,level_number:2},version:'task-revision',tasks:[structuredClone(task)]} as T;
  }
  if(path==='/admin/games/42/levels/9/helps/51'){
   if(method==='PUT'){assert.equal(options.headers?.['X-Authoring-Expected-Revision'],'hint-revision');hint={...hint,...options.body as object};return {} as T;}
   return structuredClone(hint) as T;
  }
  throw new Error('Unrelated collection read: '+path);
 }};
 const operations=new EncounterOperations(api,{name:'fixture',domain:'tech.en.cx',apiBaseUrl:'https://tech.en.cx',webBaseUrl:'https://tech.en.cx'},{writesEnabled:()=>true,saveSnapshot:async()=>''});
 await operations.updateTask({gameId:42,levelId:9,taskId:31,taskText:'After',confirmed:true});
 await operations.updateHint({gameId:42,levelId:9,helpId:51,timeout:600,confirmed:true});
 assert.equal(task.task_text,'After');assert.equal(task.for_member_id,77);
 assert.equal(hint.timeout,600);assert.equal(hint.help_text,'Hint');
 for(const suffix of ['/tasks/31','/helps/51'])assert.equal(calls.filter(c=>c.path.endsWith(suffix)&&c.method==='GET').length,2);
 assert.equal(calls.filter(c=>c.method==='PUT').length,2);
});

test('targeted hint read rejects a different entity before mutation',async()=>{
 let writes=0;
 const metadata=authoringMetadata(authoringBinding('tech.en.cx',42,'wrong-hint'),['hint-update']);
 const api:ApiLike={authoringMetadata:async()=>metadata,async request<T>(method:string){if(method==='PUT')writes++;return {help_id:999,help_text:'Other'} as T;}};
 const operations=new EncounterOperations(api,{name:'fixture',domain:'tech.en.cx',apiBaseUrl:'https://tech.en.cx',webBaseUrl:'https://tech.en.cx'},{writesEnabled:()=>true,saveSnapshot:async()=>''});
 await assert.rejects(operations.updateHint({gameId:42,levelId:9,helpId:51,helpText:'After',confirmed:true}),/identity mismatch/);
 assert.equal(writes,0);
});
