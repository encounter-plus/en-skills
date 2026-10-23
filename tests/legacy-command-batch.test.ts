import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {authoringBinding,authoringMetadata,type AuthoringApiPort} from '../src/authoring-api.ts';
import {prepareLegacyCommandBatch,executeLegacyCommandBatch,type LegacyBatchJournal,type LegacyBatchJournalStore} from '../src/legacy-command-batch.ts';
import {createFileLegacyBatchJournal} from '../src/node-batch-journal.ts';
function fixture(unknown=false){
 const binding=authoringBinding('fixture.en.cx',42,'batch-session'),levels:any[]=[],tasks:any[]=[],sectors:any[]=[],writes:string[]=[];
 const api:AuthoringApiPort={metadata:authoringMetadata(binding,['level-create','task-create','sector-create','sector-update','sector-delete']),invalidate(){},async request(path,init={}){const collection=path.endsWith('/tasks')?'tasks':path.includes('/sectors')?'sectors':'levels',rows=collection==='tasks'?tasks:collection==='sectors'?sectors:levels;
  if((init.method??'GET')!=='GET'){writes.push(path);if(unknown)throw new Error('network uncertainty');const body=init.body?JSON.parse(String(init.body)):{};if(collection==='levels'){const created=Array.from({length:body.count},(_,i)=>({level_id:9+levels.length+i,level_number:1+levels.length+i,level_name:'New'}));levels.push(...created);return Response.json({created});}if(collection==='tasks'){tasks.push({task_id:31,task_text:body.task_text});return Response.json({created_task_id:31});}sectors.push({sector_id:71,sector_name:body.sector_name});return Response.json({created_sector_id:71});}
  return Response.json({game_id:42,...(collection==='levels'?{}:{level_id:9}),[collection]:rows,version:JSON.stringify(rows)});
 }};return {api,writes,levels,tasks,sectors};
}
const commands=[{id:'level',kind:'level.create'},{id:'task',kind:'task.create',levelId:{createdBy:'level'},taskText:'001 literal'},{id:'sector',kind:'sector.create',levelId:{createdBy:'level'},sectorName:'New sector'}];
function memory(){let value:LegacyBatchJournal|undefined,locked=false;const store:LegacyBatchJournalStore={async exclusive(work){assert.equal(locked,false);locked=true;try{return await work();}finally{locked=false;}},async load(){return value&&structuredClone(value);},async save(next){value=structuredClone(next);}};return {store,get:()=>value};}
test('sequential import maps verified stable IDs and resumes completed journal without dispatch',async()=>{
 const f=fixture(),plan=await prepareLegacyCommandBatch(f.api,commands),journal=memory(),result=await executeLegacyCommandBatch(f.api,plan,journal.store);assert.equal(result.status,'complete');assert.deepEqual(result.idMapping,{level:9,task:31,sector:71});assert.equal(f.writes.length,3);assert.match(f.writes[1],/levels\/9\/tasks$/);await executeLegacyCommandBatch(f.api,plan,journal.store);assert.equal(f.writes.length,3);
});
test('unsupported commands/capabilities fail before any write and source conflicts block execution',async()=>{
 const f=fixture();await assert.rejects(prepareLegacyCommandBatch(f.api,[...commands,{id:'files',kind:'file.upload'}]));assert.equal(f.writes.length,0);const blocked={...f.api,metadata:authoringMetadata(f.api.metadata.binding,['level-create'])};await assert.rejects(prepareLegacyCommandBatch(blocked,commands),{code:'unsupported'});await assert.rejects(prepareLegacyCommandBatch(f.api,[{id:'missing',kind:'sector.rename',levelId:9,sectorId:999,sectorName:'x'}]),{code:'invalid-scope'});await assert.rejects(prepareLegacyCommandBatch(f.api,[commands[0],{id:'guessed',kind:'sector.delete',levelId:{createdBy:'level'},sectorId:999}]),{code:'unsupported'});const plan=await prepareLegacyCommandBatch(f.api,commands);f.levels.push({level_id:7,level_number:1,level_name:'Other'});await assert.rejects(executeLegacyCommandBatch(f.api,plan,memory().store),{code:'conflict'});assert.equal(f.writes.length,0);
});
test('unknown dispatch and durable dispatch-intent after crash never replay',async()=>{
 const f=fixture(true),plan=await prepareLegacyCommandBatch(f.api,commands),journal=memory(),result=await executeLegacyCommandBatch(f.api,plan,journal.store);assert.equal(result.status,'unknown');assert.equal(f.writes.length,1);await executeLegacyCommandBatch(f.api,plan,journal.store);assert.equal(f.writes.length,1);
 const g=fixture(),next=await prepareLegacyCommandBatch(g.api,commands),crashed=memory();await crashed.store.save({schemaVersion:1,planHash:next.planHash,binding:next.binding,status:'running',steps:next.commands.map((row,i)=>({id:row.id,status:i?'pending':'dispatching'})),expected:next.snapshots,idMapping:{}});assert.equal((await executeLegacyCommandBatch(g.api,next,crashed.store)).status,'unknown');assert.equal(g.writes.length,0);
});
test('filesystem journal persists ID mapping across store instances and excludes concurrent executors',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'legacy-batch-'));try{const f=fixture(),plan=await prepareLegacyCommandBatch(f.api,commands),path=join(directory,'journal.json');await executeLegacyCommandBatch(f.api,plan,createFileLegacyBatchJournal(path));await executeLegacyCommandBatch(f.api,plan,createFileLegacyBatchJournal(path));assert.equal(f.writes.length,3);const first=createFileLegacyBatchJournal(path),second=createFileLegacyBatchJournal(path);await first.exclusive(async()=>{await assert.rejects(second.exclusive(async()=>{}));});}finally{await rm(directory,{recursive:true,force:true});}
});

test('tampered mapping, state order and expected scope reject before any request',async()=>{
 const f=fixture(),plan=await prepareLegacyCommandBatch(f.api,commands),base:LegacyBatchJournal={schemaVersion:1,planHash:plan.planHash,binding:plan.binding,status:'running',steps:[{id:'level',status:'succeeded',createdId:9,httpStatus:200},{id:'task',status:'pending'},{id:'sector',status:'pending'}],expected:{...plan.snapshots,'/admin/games/42/levels':{game_id:42,levels:[{level_id:9,level_number:1,level_name:'New'}],version:'created'}},idMapping:{level:9}};
 const mutations=[(j:LegacyBatchJournal)=>{j.idMapping.level=999;},(j:LegacyBatchJournal)=>{delete j.idMapping.level;},(j:LegacyBatchJournal)=>{j.idMapping.extra=9;},(j:LegacyBatchJournal)=>{j.steps[0].createdId=999;},(j:LegacyBatchJournal)=>{j.steps[0].status='pending';},(j:LegacyBatchJournal)=>{j.status='complete';},(j:LegacyBatchJournal)=>{delete j.expected['/admin/games/42/levels'];},(j:LegacyBatchJournal)=>{j.expected['/admin/games/99/levels']=j.expected['/admin/games/42/levels'];},(j:LegacyBatchJournal)=>{(j.expected['/admin/games/42/levels'] as any).game_id=99;},(j:LegacyBatchJournal)=>{j.steps[1].status='succeeded';j.steps[1].createdId=31;j.idMapping.task=31;}];
 let calls=0;const guarded={...f.api,async request(){calls++;throw new Error('No request permitted');}};
 for(const mutate of mutations){const journal=memory(),value=structuredClone(base);mutate(value);await journal.store.save(value);await assert.rejects(executeLegacyCommandBatch(guarded,plan,journal.store),{code:'invalid-scope'});}
 assert.equal(calls,0);assert.equal(f.writes.length,0);
});

test('a structurally valid verified prefix resumes only pending steps with its exact mapped level',async()=>{
 const f=fixture(),plan=await prepareLegacyCommandBatch(f.api,commands),journal=memory();f.levels.push({level_id:9,level_number:1,level_name:'New'});
 await journal.store.save({schemaVersion:1,planHash:plan.planHash,binding:plan.binding,status:'running',steps:[{id:'level',status:'succeeded',createdId:9,httpStatus:200},{id:'task',status:'pending'},{id:'sector',status:'pending'}],expected:{'/admin/games/42/levels':{game_id:42,levels:structuredClone(f.levels),version:JSON.stringify(f.levels)}},idMapping:{level:9}});
 const result=await executeLegacyCommandBatch(f.api,plan,journal.store);assert.equal(result.status,'complete');assert.equal(f.writes.length,2);assert.ok(f.writes.every(path=>path.includes('/levels/9/')));
});

test('task collection requires exact stable level identity including nested native DTO alias',async()=>{
 const f=fixture(),command=[{id:'task',kind:'task.create',levelId:9,taskText:'literal'}];
 for(const identity of [{},{level:{level_id:999}},{level_id:9,level:{level_id:999}},{level_id:999,level:{level_id:9}}]){const wrong={...f.api,async request(){return Response.json({game_id:42,tasks:[],version:'observed',...identity});}};await assert.rejects(prepareLegacyCommandBatch(wrong,command),{code:'incomplete-read'});}
 const valid={...f.api,async request(){return Response.json({game_id:42,level:{level_id:9},tasks:[],version:'observed'});}};assert.equal((await prepareLegacyCommandBatch(valid,command)).commands.length,1);assert.equal(f.writes.length,0);
});

test('consecutive level creation uses groups of at most 20 with durable mappings',async()=>{const f=fixture(),commands=Array.from({length:21},(_,i)=>({id:'level'+i,kind:'level.create'}));const plan=await prepareLegacyCommandBatch(f.api,commands),journal=memory();const result=await executeLegacyCommandBatch(f.api,plan,journal.store);assert.equal(result.status,'complete');assert.equal(f.writes.length,2);assert.equal(result.idMapping.level20,29);await executeLegacyCommandBatch(f.api,plan,journal.store);assert.equal(f.writes.length,2);});
