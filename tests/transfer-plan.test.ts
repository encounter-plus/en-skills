import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTransfer, verifyTransfer, sourceKey, validateTransferPlan } from '../src/transfer-plan.ts';
const sheet={table:{source:{kind:'file' as const,filename:'a.csv',startRow:1 as const,startColumn:1 as const},rows:[['Hello','001','Сектор']]},proposal:{entries:[{id:'a',entity:'task' as const,group:'first',field:'text',cells:['A1'],value:'Hello',note:''}],issues:[]}};
const prepared={...sheet,draft:sheet.proposal};
const snapshot={version:'v1',levelId:9,levelNumber:2,playersStarted:false,data:{game_id:42,level:{level_id:9,level_number:2,comment:'old'},tasks:[],answers:[],helps:[],penalty_helps:[],bonuses:[],sectors:[]}};
test('prepared source becomes an exact create plan with provenance and no guessed HTML conversion',()=>{
  const plan=compileTransfer({scope:{domain:'demo.en.cx',gameId:42},sheet:prepared,snapshot,bindings:[{entryId:'a',field:'task_text',target:'new',value:'Hello'}]});
  assert.equal(plan.sourceKey,sourceKey(prepared));
  assert.equal(plan.steps[0].kind,'batch');
  if(plan.steps[0].kind!=='batch')throw new Error('Expected batch');
  assert.deepEqual(plan.steps[0].ops[0].fields,{task_text:'Hello'});
  assert.deepEqual(plan.items[0].cells,['A1']);
  assert.equal(verifyTransfer(plan,{...snapshot,data:{...snapshot.data,tasks:[{task_id:88,task_text:'Hello',for_user_id:0,for_team_id:0}]}},[{index:0,id:88,status:'ok'}]),true);
  assert.equal(verifyTransfer(plan,snapshot,[]),false);
});
test('compiler blocks unprepared, unmapped, duplicate-field and unknown live imports',()=>{
  const input={scope:{domain:'demo.en.cx',gameId:42},sheet:prepared,snapshot,bindings:[{entryId:'a',field:'task_text',target:'new',value:'Hello'}]};
  assert.throws(()=>compileTransfer({...input,sheet}));
  assert.throws(()=>compileTransfer({...input,bindings:[]}));
  assert.throws(()=>compileTransfer({...input,snapshot:{...snapshot,playersStarted:null}}));
  assert.throws(()=>compileTransfer({...input,bindings:[{...input.bindings[0],field:'replace_nl_to_br'}]}));
});

test('create receipt cannot claim an unchanged existing object and source edits invalidate identity',()=>{
  const prior={...snapshot,data:{...snapshot.data,tasks:[{task_id:88,task_text:'Hello',for_user_id:0,for_team_id:0}]}};
  const plan=compileTransfer({scope:{domain:'demo.en.cx',gameId:42},sheet:prepared,snapshot:prior,bindings:[{entryId:'a',field:'task_text',target:'new',value:'Hello'}]});
  assert.equal(verifyTransfer(plan,prior,[{index:0,id:88,status:'ok'}]),false);
  assert.notEqual(sourceKey(prepared),sourceKey({...prepared,table:{...prepared.table,rows:[['changed']]}}));
});
test('level fields from different semantic groups merge into one preserved PUT section',()=>{
  const entries=[{id:'a',entity:'level' as const,group:'A',field:'hours',cells:['A1'],value:'2',note:''},{id:'b',entity:'level' as const,group:'B',field:'minutes',cells:['B1'],value:'3',note:''}];
  const source={...prepared,proposal:{entries,issues:[]},draft:{entries,issues:[]}};
  const plan=compileTransfer({scope:{domain:'demo.en.cx',gameId:42},sheet:source,snapshot:{...snapshot,data:{...snapshot.data,duration_sec:65}},bindings:[{entryId:'a',field:'settings.duration_hours',target:'new',value:'2'},{entryId:'b',field:'settings.duration_minutes',target:'new',value:'3'}]});
  assert.deepEqual(plan.steps,[{kind:'settings',fields:{section:'duration',duration_hours:2,duration_minutes:3,duration_seconds:5}}]);
});

test('compiler preserves individual updates and compiles hints, sectors and penalty bonuses with exact literals',()=>{
  const entries=[
    {id:'a',entity:'task' as const,group:'task',field:'task_text',cells:['A1'],value:'Changed',note:''},
    {id:'h',entity:'hint' as const,group:'hint',field:'help_text',cells:['A1'],value:'Hint',note:''},
    {id:'p',entity:'penalty_hint' as const,group:'penalty',field:'help_text',cells:['A1'],value:'Penalty',note:''},
    {id:'s',entity:'sector' as const,group:'sector',field:'sector_name',cells:['A1'],value:'Sector',note:''},
    {id:'bn',entity:'penalty_bonus' as const,group:'bonus',field:'bonus_name',cells:['A1'],value:'Bonus',note:''},
    {id:'ba',entity:'penalty_bonus' as const,group:'bonus',field:'answers',cells:['B1'],value:'["001","002"]',note:''},
  ];
  const source={...prepared,proposal:{entries,issues:[]},draft:{entries,issues:[]}};
  const before={...snapshot,data:{...snapshot.data,tasks:[{task_id:8,task_text:'Old',for_user_id:0,for_team_id:4}]}};
  const plan=compileTransfer({scope:{domain:'demo.en.cx',gameId:42},sheet:source,snapshot:before,bindings:entries.map(entry=>({entryId:entry.id,field:entry.field,value:entry.value,target:entry.id==='a'?'8':'new'}))});
  assert.equal(plan.items[0].before.__recipient,'team:4');assert.equal('for_member_id' in plan.items[0].fields,false);
  assert.equal(plan.items.find(item=>item.entity==='penalty_help')!.fields.is_penalty,true);
  const bonus=plan.items.find(item=>item.entity==='bonus')!;
  assert.deepEqual(bonus.fields.answers,['001','002']);assert.equal(bonus.fields.negative,true);assert.deepEqual(bonus.fields.level_ids,[9]);
});

test('unverifiable autopass fields and destructive blank values block before any write',()=>{
  const entry={id:'a',entity:'level' as const,group:'timing',field:'autopass.timeout_seconds',cells:['A1'],value:'30',note:''};
  const source={...prepared,proposal:{entries:[entry],issues:[]},draft:{entries:[entry],issues:[]}};
  assert.throws(()=>compileTransfer({scope:{domain:'demo.en.cx',gameId:42},sheet:source,snapshot:{...snapshot,data:{...snapshot.data,timeout_sec:60}},bindings:[{entryId:'a',field:entry.field,value:'30',target:'new'}]}),/Cannot preserve/);
  assert.throws(()=>compileTransfer({scope:{domain:'demo.en.cx',gameId:42},sheet:prepared,snapshot,bindings:[{entryId:'a',field:'task_text',value:'',target:'new'}]}),/Empty/);
});

 test('persisted transfer binding cannot point at another engine or game',()=>{
  const plan=compileTransfer({scope:{domain:'demo.en.cx',gameId:42},sheet:prepared,snapshot,bindings:[{entryId:'a',field:'task_text',target:'new',value:'Hello'}]});
  const binding={registryVersion:1 as const,engine:'modern' as const,domain:'demo.en.cx',gameId:42,sessionEpoch:'opaque'};
  assert.doesNotThrow(()=>validateTransferPlan({...plan,authoringBinding:binding}));
  assert.throws(()=>validateTransferPlan({...plan,authoringBinding:{...binding,gameId:7}}));
  assert.throws(()=>validateTransferPlan({...plan,authoringBinding:{...binding,engine:'legacy'}}));
 });
