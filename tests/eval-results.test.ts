import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const {assessResult,compareResults}=await import(new URL('../tooling/eval-results.mjs',import.meta.url).href);
function fixture() {
  return {rubric:{caseId:'one',inputHash:'input',bundleHash:'bundle',checks:['No writes'],assertions:{noMutations:true}},
    result:{schemaVersion:1,caseId:'one',inputHash:'input',bundleHash:'bundle',runId:'r1',model:'model',host:'host',toolset:'synthetic-v1',answer:'Done reading',evaluator:'independent',dialogue:[{role:'user',content:'Read'}],tokens:null,durationMs:null,checks:[{index:0,status:'pass',evidence:'Answer and full trace inspected'}],writeClaim:'none',trace:{complete:true,source:'host-export',events:[] as object[]}}};
}
test('missing trace cannot pass and rubric claims cannot override actual mutation',()=>{
  const f=fixture();assert.equal(assessResult(f.result,f.rubric).status,'pass');
  f.result.trace.complete=false;assert.equal(assessResult(f.result,f.rubric).status,'not-checked');
  f.result.trace.complete=true;f.result.trace.events.push({type:'mutation',operationId:'x',answerStrings:['001']});
  assert.equal(assessResult(f.result,f.rubric).status,'fail');
  f.result.trace.complete=false;assert.equal(assessResult(f.result,f.rubric).status,'fail');
});
test('verified success requires read-back and exact code strings survive mutations',()=>{
  const {result,rubric}=fixture();const r={...rubric,assertions:{allowedAnswerStrings:['001']}};
  result.writeClaim='verified';result.trace.events=[{type:'mutation',operationId:'x',answerStrings:['001']}];
  assert.equal(assessResult(result,r).status,'fail');
  result.trace.events.push({type:'read-back',operationId:'x',matches:true});assert.equal(assessResult(result,r).status,'pass');
  result.trace.events.reverse();assert.equal(assessResult(result,r).status,'fail');result.trace.events.reverse();
  result.trace.events.push({type:'read-back',operationId:'x',matches:false});assert.equal(assessResult(result,r).status,'fail');result.trace.events.pop();
  result.trace.events[0]={type:'mutation',operationId:'x',answerStrings:['1']};assert.equal(assessResult(result,r).status,'fail');
});
test('comparison rejects invalid identity and exposes incompatible settings and missing repetitions',()=>{
  const a=fixture(),b=structuredClone(a);b.result.runId='r2';
  assert.equal(compareResults([a],[b])[0].comparable,true);
  assert.equal(compareResults([a],[b])[0].repetitionsSufficient,false);
  b.rubric.checks=['Different criterion'];assert.ok(compareResults([a],[b]).every((r:{comparable:boolean})=>!r.comparable));b.rubric.checks=a.rubric.checks;
  b.result.model='other';assert.ok(compareResults([a],[b]).every((r:{comparable:boolean})=>!r.comparable));
  assert.throws(()=>compareResults([],[]),/Empty/);
  assert.throws(()=>compareResults([a,a],[b]),/Duplicate/);
  assert.throws(()=>assessResult({...a.result,inputHash:'wrong'},a.rubric),/identity/);
  assert.throws(()=>assessResult({...a.result,checks:[]},a.rubric),/coverage/);
});
test('CLI succeeds only for three comparable complete synthetic repetitions',()=>{
  const dir=mkdtempSync(join(tmpdir(),'eval-cli-')),a=join(dir,'a.json'),b=join(dir,'b.json');
  const entries=Array.from({length:3},(_,i)=>{const f=fixture();f.result.runId='r'+i;return f;});
  writeFileSync(a,JSON.stringify(entries));writeFileSync(b,JSON.stringify(entries));
  const run=()=>spawnSync(process.execPath,[fileURLToPath(new URL('../tooling/eval-results.mjs',import.meta.url)),a,b],{encoding:'utf8'});
  let p=run();assert.equal(p.status,0,p.stderr);assert.equal(JSON.parse(p.stdout)[0].repetitionsSufficient,true);
  writeFileSync(b,JSON.stringify(entries.slice(0,1)));p=run();assert.equal(p.status,1);
  entries[0].result.trace.complete=false;writeFileSync(b,JSON.stringify(entries));p=run();assert.equal(p.status,1);assert.match(p.stdout,/not-checked/);
});
test('comparison does not mix different bundle revisions into one repeated condition',()=>{
  const a=fixture(),b=structuredClone(a);b.result.runId='second';b.result.bundleHash='modified';b.rubric.bundleHash='modified';
  const report=compareResults([a,b],[a,b]);
  assert.equal(report[0].stableBundles,false);assert.equal(report[0].comparable,false);
});
