import test from 'node:test';
import assert from 'node:assert/strict';
import {applyLevelImport,type ImportHost} from '../src/level-import.ts';
const defaults={bonus_text:'',reward_seconds:15,is_negative:false,all_levels:false,level_ids:[7]};
const plan={schemaVersion:1,domain:'fixture.en.cx',gameId:42,levelId:7,confirmed:true,sectors:[{name:'Answer',answers:['001','Word']}],bonusDefaults:defaults,bonuses:[{sourceKey:'row1',fields:{bonus_name:'A1',help_text:'<b>Literal</b>',new_answers:['001']}},{sourceKey:'row2',fields:{bonus_name:'B1',help_text:'<b>Another</b>',new_answers:['конь6']}}]};
function fixture(){
 let sectors:any={version:'s0',sectors:[{sector_id:1,sector_name:'Answer'}],answers:[{sector_id:1,answer_text:'001'},{sector_id:1,answer_text:'Word'}]};
 let bonuses:any[]=[{...defaults,...plan.bonuses[0].fields,bonus_id:10,answers:[{answer_text:'001'}]}];
 const writes:any[]=[],checkpoints:any[]=[],reads:string[]=[];let unknown=false;
 const host:ImportHost={read:async resource=>{reads.push(resource);return structuredClone(resource==='sectors'?sectors:resource==='bonuses'?{bonuses}:{version:'b'+bonuses.length});},resolve:async fields=>fields,checkpoint:async value=>{checkpoints.push(structuredClone(value));},progress(){},addAnswer:async(id,answer)=>{writes.push({answer});sectors.answers.push({sector_id:id,answer_text:answer});},create:async(resource,fields,version)=>{
  writes.push({resource,fields,version});if(unknown)throw new Error('unknown-after-dispatch');
  if(resource==='sectors'){sectors.sectors.push({sector_id:2,sector_name:fields.sector_name});sectors.answers.push(...(fields.new_answers??[]).map((answer_text:string)=>({sector_id:2,answer_text})));return {status:'applied',receipt:{created_sector_id:2}};}
  assert.equal(version,'b'+bonuses.length);const b={...fields,bonus_id:11,answers:fields.new_answers.map((answer_text:string)=>({answer_text}))};bonuses.push(b);return {status:'applied',receipt:b};
 }};
 return {host,writes,checkpoints,reads,bonuses,sectors,set unknown(value:boolean){unknown=value;}};
}
test('whole plan is resolved before writes; exact existing objects are skipped and final collections reread',async()=>{
 const f=fixture();const result=await applyLevelImport(plan,f.host);assert.equal(result.status,'verified');assert.equal(f.writes.length,1);assert.equal(f.writes[0].fields.new_answers[0],'конь6');assert.equal(f.checkpoints.at(-1).status,'verified');assert.deepEqual(f.reads.slice(-2),['bonuses','sectors']);
 await applyLevelImport(plan,f.host,f.checkpoints.at(-1));assert.equal(f.writes.length,1,'restart is idempotent after a complete reread');
});
test('invalid last row and mismatched existing HTML stop before any write',async()=>{
 const f=fixture();await assert.rejects(applyLevelImport({...plan,bonuses:[...plan.bonuses,{sourceKey:'bad',fields:{bonus_name:'C1'}}]},f.host));assert.equal(f.writes.length,0);
 f.bonuses[0].help_text='foreign edit';await assert.rejects(applyLevelImport(plan,f.host),/differs/);assert.equal(f.writes.length,0);
});
test('uncertain dispatch is journaled once, never retried while absent, and reconciles only exact observed content',async()=>{
 const f=fixture();f.unknown=true;await assert.rejects(applyLevelImport(plan,f.host),/unknown/);assert.equal(f.writes.length,1);const journal=f.checkpoints.at(-1);assert.equal(journal.steps.at(-1).status,'unknown');
 await assert.rejects(applyLevelImport(plan,f.host,journal),/no automatic retry/);assert.equal(f.writes.length,1);
 f.bonuses.push({...defaults,...plan.bonuses[1].fields,bonus_id:11,answers:[{answer_text:'конь6'}]});const result=await applyLevelImport(plan,f.host,journal);assert.equal(result.status,'verified');assert.equal(f.writes.length,1);
});
test('sector alternatives are added serially to the same sector without rewriting existing answers',async()=>{
 const f=fixture();f.sectors.answers.pop();await applyLevelImport(plan,f.host);assert.deepEqual(f.writes[0],{answer:'Word'});assert.equal(f.sectors.sectors.length,1);
});
test('duplicate bonus names, changed journal and extra remote objects are rejected',async()=>{
 for(const kind of ['duplicate','journal','extra']){const f=fixture();let input:any=plan,previous;
  if(kind==='duplicate')input={...plan,bonuses:[plan.bonuses[0],{...plan.bonuses[0],sourceKey:'another'}]};
  if(kind==='journal')previous={planIdentity:'foreign'};
  if(kind==='extra')f.bonuses.push({bonus_name:'Foreign'});
  await assert.rejects(applyLevelImport(input,f.host,previous));assert.equal(f.writes.length,0);
 }
});

test('new sector includes answers in its creation with no alias calls',async()=>{const f=fixture();f.sectors.sectors.length=0;f.sectors.answers.length=0;await applyLevelImport(plan,f.host);assert.deepEqual(f.writes[0].fields,{sector_name:'Answer',new_answers:['001','Word']});assert.equal(f.writes.filter(row=>'answer'in row).length,0);});
