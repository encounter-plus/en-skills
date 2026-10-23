import test from 'node:test';
import assert from 'node:assert/strict';
import {importPlanSchema,createLevelFromPlan,verifyImportPlan,planReference,reconcileImportPlan,inspectImportLevel} from '../src/import-plan.ts';
import {syntheticPlan as p,syntheticHost,memoryStore} from './import-plan-fixture.ts';
test('two named levels, first dialogue only and organizer styles are verified against full plan',async()=>{
 const f=syntheticHost(),s=memoryStore();assert.equal((await createLevelFromPlan(p,'brief',f.host,s,true)).status,'partial');
 assert.equal((await createLevelFromPlan(p,'dialog',f.host,s,true)).status,'complete');
 const n=f.calls.length;await createLevelFromPlan(p,'dialog',f.host,s,true);assert.equal(f.calls.length,n);
 assert.deepEqual(f.levels.map(l=>l.level_name),['Брифинг','Нейродиалог 1']);assert.ok(!JSON.stringify(f.levels).includes('Луна'));assert.equal(f.messages.length,1);
 f.levels[0]!.level_name='';f.levels[1]!.tasks[0]!.task_text=p.sources[0]!.text;f.messages.length=0;
 const report=await verifyImportPlan(p,f.host,(await s.load())!);assert.equal(report.status,'partial');assert.deepEqual(report.issues.map(i=>i.reason),['level-name-mismatch','task-content-or-recipient-mismatch','organizer-text-or-all-levels-mismatch']);
});
test('source classification rejects author instruction as task and missing references',()=>{
 const bad=structuredClone(p);bad.levels[1]!.task={text:p.sources[0]!.text,sourceKeys:['r0'],replaceNlToBr:false};assert.equal(importPlanSchema.safeParse(bad).success,false);
 bad.levels[1]!.task.sourceKeys=['missing'];assert.equal(importPlanSchema.safeParse(bad).success,false);
});
test('unknown creation or task write never retries; known created ID survives',async()=>{
 for(const fail of ['create','tasks']){const f=syntheticHost(),s=memoryStore();f.setFail(fail);const first=await createLevelFromPlan(p,'brief',f.host,s,true);assert.equal(first.status,'partial');const n=f.calls.length;f.setFail('');await createLevelFromPlan(p,'brief',f.host,s,true);assert.equal(f.calls.length,n);assert.equal(f.levels.length,1);if(fail==='tasks')assert.equal(first.levels.brief,100);}
});
test('unresolved requirements, wrong scope, order and confirmation stop creation',async()=>{
 const f=syntheticHost(),s=memoryStore();await assert.rejects(createLevelFromPlan({...p,unresolved:['Upload CSS unsupported']},'brief',f.host,s,true));
 await assert.rejects(createLevelFromPlan({...p,domain:'other.invalid'},'brief',f.host,s,true));await assert.rejects(createLevelFromPlan(p,'brief',f.host,s,false));
 assert.equal((await createLevelFromPlan(p,'dialog',f.host,s,true)).status,'partial');assert.equal(f.calls.length,0);
});
test('changed plans and post-write drift cannot claim complete',async()=>{
 const f=syntheticHost(),s=memoryStore();await createLevelFromPlan(p,'brief',f.host,s,true);
 await assert.rejects(createLevelFromPlan({...p,request:'different'},'brief',f.host,s,true));
 assert.notEqual(planReference({...p,request:'different'}),planReference(p));
});

test('a changed principal cannot resume or verify a stored plan',async()=>{
 const f=syntheticHost(),s=memoryStore();await createLevelFromPlan(p,'brief',f.host,s,true);const n=f.calls.length;
 f.host.identity=async()=> 'another-session';await assert.rejects(createLevelFromPlan(p,'dialog',f.host,s,true),/different host/);
 await assert.rejects(verifyImportPlan(p,f.host,(await s.load())!),/different host/);assert.equal(f.calls.length,n);
});
test('invalid settings are rejected before an executor can create a blank level',()=>{
 const bad=structuredClone(p);bad.levels[0]!.settings=[{resource:'completion',fields:{all_sectors:false}}];assert.equal(importPlanSchema.safeParse(bad).success,false);
});

test('lost task response is reconciled without replay and complete import resumes',async()=>{
 const f=syntheticHost(),s=memoryStore();f.failAfter('tasks');await createLevelFromPlan(p,'brief',f.host,s,true);
 assert.equal(f.levels[0]!.tasks.length,1);const n=f.calls.length;await createLevelFromPlan(p,'brief',f.host,s,true);assert.equal(f.calls.length,n);
 await reconcileImportPlan(p,f.host,s);await createLevelFromPlan(p,'brief',f.host,s,true);assert.equal(f.calls.length,n);
 assert.equal((await createLevelFromPlan(p,'dialog',f.host,s,true)).status,'complete');
});
test('read failure before dispatch is retryable without poisoning the journal',async()=>{
 const f=syntheticHost(),s=memoryStore(),read=f.host.read;let once=true;f.host.read=async(...args)=>{if(args[2]==='tasks'&&once){once=false;throw Error('read unavailable');}return read(...args);};
 await createLevelFromPlan(p,'brief',f.host,s,true);assert.ok(!Object.values((await s.load())!.steps).some(v=>v.status==='unknown'));
 await createLevelFromPlan(p,'brief',f.host,s,true);assert.equal(f.levels[0]!.tasks.length,1);
});
test('existing ID preserves unrelated tasks; rejects stale snapshots; replaces explicit task only',async()=>{
 const f=syntheticHost(),s=memoryStore();await f.host.create(42);f.levels[0]!.tasks.push({task_id:7,task_text:'old',replace_nl_to_br:false,for_member_id:0},{task_id:8,task_text:'keep',replace_nl_to_br:false,for_member_id:0});
 const snapshot=await inspectImportLevel(f.host,42,100),plan=structuredClone(p);plan.levels[0]!.targetLevelId=100;plan.levels[0]!.expectedResources=snapshot.expectedResources;plan.levels[0]!.task.targetTaskId=7;
 f.levels[0]!.level_name='external edit';assert.equal((await createLevelFromPlan(plan,'brief',f.host,s,true)).error?.code,'content-conflict');assert.equal(f.levels[0]!.tasks[0]!.task_text,'old');
 f.levels[0]!.level_name='';await createLevelFromPlan(plan,'brief',f.host,s,true);assert.equal(f.levels.length,1);assert.equal(f.levels[0]!.tasks[1]!.task_text,'keep');assert.equal(f.levels[0]!.tasks[0]!.task_text,p.levels[0]!.task.text);
});
test('asset loss reconciles; sectors exact answers, bonuses, hints and multiple tasks verify',async()=>{
 const f=syntheticHost(),s=memoryStore(),plan=structuredClone(p);plan.assets=[{key:'css',filename:'dialog.css',mime:'text/css',encoding:'utf8',content:'.neuro{color:blue}',sourceKeys:['r0']}];plan.organizer!.text='<link rel="stylesheet" href="{{asset:css}}">';
 const l=plan.levels[0]!;l.additionalTasks=[{text:'extra',sourceKeys:['r1'],replaceNlToBr:false,forMemberId:0}];l.sectors=[{key:'s',name:'Старт',answers:['001','Конь6']}];l.bonuses=[{key:'b',name:'Бонус',text:'Текст',help:'Помощь',answers:['БОНУС'],rewardSeconds:60,isNegative:false}];l.hints=[{key:'h',text:'Посмотри вверх',timeout:30,isPenalty:false}];
 f.failAfter('asset');await createLevelFromPlan(plan,'brief',f.host,s,true);assert.equal(f.levels.length,0);await reconcileImportPlan(plan,f.host,s);await createLevelFromPlan(plan,'brief',f.host,s,true);assert.equal((await createLevelFromPlan(plan,'dialog',f.host,s,true)).status,'complete');assert.equal(f.calls.filter(c=>c==='asset').length,1);assert.deepEqual(f.levels[0]!.answers.map(a=>a.answer_text),['001','Конь6']);
 f.levels[0]!.helps[0]!.timeout=99;assert.equal((await verifyImportPlan(plan,f.host,(await s.load())!)).status,'partial');
});
test('lost anonymous creation is not silently attributed to another author level',async()=>{
 const f=syntheticHost(),s=memoryStore();f.setFail('create');await createLevelFromPlan(p,'brief',f.host,s,true);f.setFail('');const result=await reconcileImportPlan(p,f.host,s);assert.equal(result.resolutions[0]!.status,'unknown');assert.match(result.resolutions[0]!.reason!,/attribution/);await createLevelFromPlan(p,'brief',f.host,s,true);assert.equal(f.levels.length,1);
});

test('author-confirmed unique empty created ID can recover an anonymous create',async()=>{const f=syntheticHost(),s=memoryStore();f.setFail('create');await createLevelFromPlan(p,'brief',f.host,s,true);f.setFail('');const r=await reconcileImportPlan(p,f.host,s,{levelKey:'brief',levelId:100,authorConfirmation:'Synthetic author verified ID 100'});assert.equal(r.resolutions[0]!.status,'applied');await createLevelFromPlan(p,'brief',f.host,s,true);assert.equal(f.levels.length,1);assert.equal(f.levels[0]!.level_name,'Брифинг');});
test('scoped message stays on its planned level',async()=>{const f=syntheticHost(),s=memoryStore(),plan=structuredClone(p);plan.levels[0]!.messages=[{key:'notice',text:'Only briefing'}];await createLevelFromPlan(plan,'brief',f.host,s,true);assert.equal((await createLevelFromPlan(plan,'dialog',f.host,s,true)).status,'complete');assert.deepEqual(f.messages.find(m=>m.message_text==='Only briefing')!.level_ids,[100]);});

test('host pre-dispatch rejection remains retryable, unlike an unknown transport outcome',async()=>{const f=syntheticHost(),s=memoryStore(),write=f.host.write;let once=true;f.host.write=async(...args)=>{if(once){once=false;throw Object.assign(Error('host unavailable before dispatch'),{dispatchState:'not-dispatched'});}return write(...args);};await createLevelFromPlan(p,'brief',f.host,s,true);assert.equal((await s.load())!.steps['brief:meta']!.status,'rejected');await createLevelFromPlan(p,'brief',f.host,s,true);assert.equal(f.levels[0]!.level_name,'Брифинг');});

test('answers beyond native ten-slot creation recover individually without duplicates',async()=>{const f=syntheticHost(),s=memoryStore(),plan=structuredClone(p);plan.levels[0]!.sectors=[{key:'codes',name:'Codes',answers:Array.from({length:12},(_,i)=>'00'+i)}];f.failAfter('answer');await createLevelFromPlan(plan,'brief',f.host,s,true);assert.equal(f.levels[0]!.answers.length,11);await reconcileImportPlan(plan,f.host,s);await createLevelFromPlan(plan,'brief',f.host,s,true);assert.equal(f.levels[0]!.answers.length,12);assert.equal((await createLevelFromPlan(plan,'dialog',f.host,s,true)).status,'complete');});
