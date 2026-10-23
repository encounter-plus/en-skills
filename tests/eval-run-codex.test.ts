import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {parseTrace,zeroBasedChecks,createCodexExecutor,maskWorkspacePaths,readEvidenceSucceeded}=await import(new URL('../tooling/eval-run-codex.mjs',import.meta.url).href);
const lines=(events:object[])=>events.map(e=>JSON.stringify(e)).join('\n');
test('compound command failure can prove a successful read only with the exact file output',()=>{
  const item={type:'command_execution',exit_code:1,command:'Get-Content skills/a/SKILL.md; Get-Content missing.md',aggregated_output:'---\r\nname: a\r\n---\r\nInstruction.\r\nCannot find missing.md'};
  assert.equal(readEvidenceSucceeded(item,'skills/a/SKILL.md','---\nname: a\n---\nInstruction.\n'),true);
  assert.equal(readEvidenceSucceeded(item,'missing.md','Missing file content'),false);
  assert.equal(readEvidenceSucceeded(item,'skills/b/SKILL.md','---\nname: a\n---\nInstruction.'),false);
  assert.equal(readEvidenceSucceeded(item,'skills/a/SKILL.md',''),false);
});
test('raw CLI traces require terminal success and completed tool calls',()=>{
  const started={type:'item.started',item:{id:'tool1',type:'command_execution'}};
  const tool={type:'item.completed',item:{id:'tool1',type:'command_execution',command:'Get-Content input.json',aggregated_output:'001',exit_code:0}};
  const answer={type:'item.completed',item:{id:'answer',type:'agent_message',text:'001'}};
  const end={type:'turn.completed',usage:{input_tokens:10,output_tokens:3}};
  const full=parseTrace(lines([started,tool,answer,end]));
  assert.equal(full.complete,true);assert.equal(full.answer,'001');assert.equal(full.tokens,13);
  assert.equal(full.completed[0].aggregated_output,'001');
  assert.equal(parseTrace(lines([started,answer,end])).complete,false);
  assert.equal(parseTrace(lines([started,tool,answer])).complete,false);
  assert.equal(parseTrace(lines([started,tool,answer,end,{type:'turn.failed'}])).complete,false);
  assert.equal(parseTrace(lines([started,{type:'error',message:'Reconnecting...'},tool,answer,end])).complete,true);
  assert.throws(()=>parseTrace('{truncated'),SyntaxError);
});
test('judge numbering correction preserves evidence and rejects ambiguity',()=>{
  const checks=[{index:1,status:'fail',evidence:'Actual failure'},{index:2,status:'pass',evidence:'Actual success'}];
  assert.deepEqual(zeroBasedChecks(checks),checks.map((c,index)=>({...c,index})));
  assert.deepEqual(checks.map(c=>c.index),[1,2]);
  assert.throws(()=>zeroBasedChecks([{index:0},{index:2}]),/Ambiguous/);
});
test('blinding masks only workspace paths and preserves literal code and answer strings',()=>{
  const workspace='C:\\eval\\candidate\\agent';
  const value={candidate:'candidate',answer:'baseline-001',code:'const candidate = "baseline";',path:workspace+'\\input.json'};
  assert.deepEqual(maskWorkspacePaths(value,workspace),{...value,path:'<workspace>\\input.json'});
  assert.equal(value.path,workspace+'\\input.json');
  assert.equal(maskWorkspacePaths(workspace.replaceAll('\\','\\\\'),workspace),'<workspace>');
});
test('host cleans up its own hung CLI only after terminal success, then resumes without rerunning',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'eval-host-')),cli=join(dir,'fake-cli.mjs');
  await writeFile(cli,`console.log(JSON.stringify({type:'item.completed',item:{id:'answer',type:'agent_message',text:'001'}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));setInterval(()=>{},1000);`);
  const execute=createCodexExecutor({cliEntry:cli,model:'synthetic-test'}),run=join(dir,'run');
  const first=await execute(run,dir,'synthetic');assert.equal(first.complete,true);assert.equal(first.answer,'001');
  assert.equal(JSON.parse(await readFile(join(run,'completed.json'),'utf8')).terminalCleanup,true);
  await writeFile(cli,'throw Error("Must not rerun");');
  assert.equal((await execute(run,dir,'synthetic')).answer,'001');
  const tracePath=join(run,'trace.jsonl');
  await writeFile(tracePath,(await readFile(tracePath,'utf8')).replace('001','002'));
  await assert.rejects(execute(run,dir,'synthetic'),/integrity mismatch/);
});
test('failed attempts are retained and an automatic retry can be resumed without another model call',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'eval-retry-')),cli=join(dir,'fake-cli.mjs'),run=join(dir,'run');
  await writeFile(cli,`import {dirname} from 'node:path';const output=process.argv[process.argv.indexOf('-o')+1];if(dirname(output).endsWith('retry')){console.log(JSON.stringify({type:'item.completed',item:{id:'answer',type:'agent_message',text:'002'}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));}else{console.log(JSON.stringify({type:'turn.failed'}));process.exitCode=1;}process.stdin.resume();`);
  const execute=createCodexExecutor({cliEntry:cli,model:'synthetic-test',retryPartial:true});
  assert.equal((await execute(run,dir,'synthetic')).answer,'002');
  assert.match(await readFile(join(run,'trace.jsonl'),'utf8'),/turn.failed/);
  assert.equal(JSON.parse(await readFile(join(run,'failed.json'),'utf8')).code,1);
  await writeFile(cli,'throw Error("Must not rerun");');
  assert.equal((await execute(run,dir,'synthetic')).answer,'002');
});
