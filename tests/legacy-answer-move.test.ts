import test from 'node:test';import assert from 'node:assert/strict';
import {authoringBinding,authoringMetadata,type AuthoringApiPort} from '../src/authoring-api.ts';
import {readLegacyAnswerMoveState,prepareLegacyAnswerMove,executeLegacyAnswerMove,verifyLegacyAnswerMove,validateLegacyAnswerMoveArgs,type LegacyAnswerMoveJournal,type LegacyAnswerMoveJournalStore} from '../src/legacy-answer-move.ts';
const args={levelId:9,answerId:31,sourceSectorId:71,destinationSectorId:72};
type Mode='success'|'delete-rejected'|'delete-unknown'|'create-rejected'|'create-unknown';
function fixture(mode:Mode='success'){
 const binding=authoringBinding('tech.en.cx',42,'move'),options=[{member_id:0,label:'All'},{member_id:77,label:'Native member'}];
 const source={answer_id:31,sector_id:71,answer_text:' 001 + & <br> ',for_member_id:77,recipient:{kind:'unknown',member_id:77,options}},answers=[structuredClone(source),{...structuredClone(source),answer_id:32,sector_id:72}];
 const writes:string[]=[],saved:LegacyAnswerMoveJournal[]=[];let journal:LegacyAnswerMoveJournal|undefined;
 const inventory=()=>({game_id:42,level_id:9,version:JSON.stringify(answers),preservation_version:'delete-siblings',creation_preservation_version:'creation-proof',recipient_options:options,answer_form_proofs:[...new Set(answers.map(row=>row.sector_id))].map(sector_id=>({sector_id,preservation_version:'form-'+sector_id})),answers:structuredClone(answers),sectors:[{sector_id:71,sector_name:'Source'},{sector_id:72,sector_name:'Destination'}]});
 const api:AuthoringApiPort={metadata:authoringMetadata(binding,['answer-create','answer-delete']),invalidate(){},async request(path,init={}){
  const method=init.method??'GET';if(method==='GET')return Response.json(inventory());
  assert.equal(new Headers(init.headers).get('If-Match'),inventory().version);
  if(method==='DELETE'){assert.equal(journal?.delete.status,'dispatching');writes.push('delete');if(mode==='delete-rejected')return new Response(null,{status:422});if(mode==='delete-unknown')throw new Error('Delete outcome unknown');answers.splice(answers.findIndex(row=>row.answer_id===31),1);}
  else{assert.equal(journal?.delete.status,'verified');assert.equal(journal?.create.status,'dispatching');writes.push('create');const body=JSON.parse(String(init.body));assert.deepEqual(body,{answer_text:source.answer_text,for_member_id:77,sector_id:72});if(mode==='create-rejected')return new Response(null,{status:422});answers.push({...structuredClone(source),answer_id:99,sector_id:72});if(mode==='create-unknown')throw new Error('Create response unknown');}
  return Response.json(inventory());
 }};
 const store:LegacyAnswerMoveJournalStore={exclusive:async work=>work(),load:async()=>structuredClone(journal),save:async value=>{journal=structuredClone(value);saved.push(structuredClone(value));}};
 return {api,answers,writes,saved,store,journal:()=>journal,setJournal:(value:LegacyAnswerMoveJournal)=>{journal=structuredClone(value);}};
}
async function prepared(f:ReturnType<typeof fixture>){return prepareLegacyAnswerMove(await readLegacyAnswerMoveState(f.api,args));}
test('compound move deletes then adds exact literal code/native recipient with a new ID, preserving an existing identical destination alias',async()=>{
 const f=fixture(),plan=await prepared(f),journal=await executeLegacyAnswerMove(f.api,plan,f.store);assert.equal(journal.status,'complete');assert.deepEqual(f.writes,['delete','create']);assert.equal(journal.create.newAnswerId,99);assert.equal(journal.sourceState,'absent');assert.deepEqual(f.answers.map(row=>row.answer_id),[32,99]);assert.equal(verifyLegacyAnswerMove(plan.before,await readLegacyAnswerMoveState(f.api,args),journal),true);
 const intents=f.saved.filter(row=>row.delete.status==='dispatching'||row.create.status==='dispatching');assert.equal(intents[0].delete.status,'dispatching');assert.equal(intents.at(-1)?.create.status,'dispatching');assert.equal(journal.source.answer_text,' 001 + & <br> ');
 await executeLegacyAnswerMove(f.api,plan,f.store);assert.deepEqual(f.writes,['delete','create']);
});
test('known delete rejection never creates and preserves source; deletion uncertainty is not retried',async()=>{
 for(const mode of ['delete-rejected','delete-unknown']as const){const f=fixture(mode),plan=await prepared(f),journal=await executeLegacyAnswerMove(f.api,plan,f.store);assert.equal(journal.status,mode==='delete-rejected'?'rejected':'unknown');assert.equal(journal.sourceState,'present');assert.deepEqual(f.writes,['delete']);await executeLegacyAnswerMove(f.api,plan,f.store);assert.deepEqual(f.writes,['delete']);}
});
test('deleted source and failed creation return durable partial recovery facts; uncertain create cannot repeat',async()=>{
 for(const mode of ['create-rejected','create-unknown']as const){const f=fixture(mode),plan=await prepared(f),journal=await executeLegacyAnswerMove(f.api,plan,f.store);assert.equal(journal.status,mode==='create-rejected'?'partial':'unknown');assert.equal(journal.delete.status,'verified');assert.equal(journal.sourceState,'absent');assert.equal(journal.source.for_member_id,77);assert.ok(journal.afterDelete);assert.deepEqual(f.writes,['delete','create']);await executeLegacyAnswerMove(f.api,plan,f.store);assert.deepEqual(f.writes,['delete','create']);}
});
test('same-sector, wrong-sector and unavailable destination recipients fail before destructive work',async()=>{
 const f=fixture();assert.throws(()=>validateLegacyAnswerMoveArgs({...args,destinationSectorId:71}),{code:'invalid-scope'});await assert.rejects(prepareLegacyAnswerMove(await readLegacyAnswerMoveState(f.api,{...args,sourceSectorId:72,destinationSectorId:71})),/outside/);f.answers[0].for_member_id=999;await assert.rejects(prepared(f),{code:'invalid-scope'});assert.deepEqual(f.writes,[]);
});
test('fresh state conflict and interrupted persisted intent never dispatch',async()=>{
 const f=fixture(),plan=await prepared(f);f.answers[0].answer_text='another author';assert.equal((await executeLegacyAnswerMove(f.api,plan,f.store)).status,'conflict');assert.deepEqual(f.writes,[]);
 const g=fixture(),other=await prepared(g);g.setJournal({schemaVersion:1,planHash:other.planHash,binding:other.before.binding,args,source:other.source,status:'deleting',sourceState:'unknown',delete:{status:'dispatching'},create:{status:'not-dispatched'}});assert.equal((await executeLegacyAnswerMove(g.api,other,g.store)).status,'unknown');assert.deepEqual(g.writes,[]);
});
test('read-only reconciliation refuses changed creation or sibling form preservation proofs',async()=>{
 const f=fixture(),plan=await prepared(f),journal=await executeLegacyAnswerMove(f.api,plan,f.store),after=await readLegacyAnswerMoveState(f.api,args);assert.equal(verifyLegacyAnswerMove(plan.before,after,journal),true);
 for(const key of ['creation_preservation_version','answer_form_proofs']){const changed=structuredClone(after);changed.creationInventory[key]=key==='answer_form_proofs'?[{sector_id:72,preservation_version:'foreign hidden control'}]:'changed';assert.equal(verifyLegacyAnswerMove(plan.before,changed,journal),false);}
 const changed=structuredClone(journal);changed.afterDelete!.sourceInventory.preservation_version='changed';assert.equal(verifyLegacyAnswerMove(plan.before,after,changed),false);
});
