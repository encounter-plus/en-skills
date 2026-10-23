import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {validateCases, prepareCase} = await import(new URL('../tooling/eval-cases.mjs', import.meta.url).href);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'eval-cases-'));
  await mkdir(join(root, 'skills/demo'), {recursive:true}); await mkdir(join(root,'knowledge'));
  await mkdir(join(root,'evals/fixtures'), {recursive:true});
  await writeFile(join(root,'skills/demo/SKILL.md'), '---\nname: demo\ndescription: Demo\n---\nRead input.');
  await writeFile(join(root,'evals/fixtures/data.txt'), '001');
  const data = {schemaVersion:2,cases:[{id:'one',skill:'demo',mode:'explicit',request:'Read codes',origin:{kind:'synthetic'},tools:[],checks:['SECRET_RUBRIC'],artifacts:['evals/fixtures/data.txt']}]};
  await writeFile(join(root,'evals/cases.json'),JSON.stringify(data)); return {root,data};
}
test('preparation separates rubric from agent inputs and hashes exact installed material',async()=>{
  const {root,data}=await fixture();
  const first=await prepareCase(root,'one',join(root,'agent'),join(root,'judge'));
  const input=JSON.parse(await readFile(join(root,'agent/input.json'),'utf8'));
  assert.ok(!JSON.stringify(input).includes('SECRET_RUBRIC'));assert.equal(input.skill,undefined);
  assert.equal(Buffer.from(input.fixtures[0].base64,'base64').toString(),'001');
  assert.match(await readFile(join(root,'judge/rubric.json'),'utf8'),/SECRET_RUBRIC/);
  await writeFile(join(root,'skills/demo/SKILL.md'),'---\nname: demo\ndescription: Demo\n---\nChanged.');
  const second=await prepareCase(root,'one',join(root,'agent2'),join(root,'judge2'));
  assert.notEqual(first.bundleHash,second.bundleHash);assert.equal(first.inputHash,second.inputHash);
  await assert.rejects(prepareCase(root,'one',join(root,'agent3'),join(root,'agent3/judge')),/separate/);
  await assert.rejects(prepareCase(root,'one',join(root,'agent'),join(root,'judge')),/EEXIST/);
  const dialogue={...data,cases:[{...data.cases[0],mode:'dialogue',turns:[{user:'PRIVATE_FUTURE_TURN'}]}]};
  await writeFile(join(root,'evals/cases.json'),JSON.stringify(dialogue));
  await prepareCase(root,'one',join(root,'conversation'),join(root,'driver'));
  assert.doesNotMatch(await readFile(join(root,'conversation/input.json'),'utf8'),/PRIVATE_FUTURE_TURN/);
  assert.match(await readFile(join(root,'driver/rubric.json'),'utf8'),/PRIVATE_FUTURE_TURN/);
  data.cases[0].mode='routing';await writeFile(join(root,'evals/cases.json'),JSON.stringify(data));
  await prepareCase(root,'one',join(root,'route'),join(root,'judge3'));
  assert.deepEqual(await readdir(join(root,'route/skills')),['demo']);
});
test('catalog rejects duplicates, unknown skills, traversal, absent fixtures and incomplete dialogue',async()=>{
  const {root,data}=await fixture();
  await validateCases(root,data);
  await assert.rejects(validateCases(root,{...data,cases:[...data.cases,...data.cases]}),/duplicate/);
  for(const changes of [{skill:'missing'},{mode:'dialogue'},{artifacts:['evals/fixtures/../../package.json']},{artifacts:['evals/fixtures/missing']},{checks:[]},{origin:{kind:'incident'}},{assertions:{noMutation:true}}]) {
    await assert.rejects(validateCases(root,{...data,cases:[{...data.cases[0],...changes}]}));
  }
});

test('A/B preparation uses a common catalog with separate immutable skill bundles',async()=>{
  const current=await fixture(),baseline=await fixture();
  await writeFile(join(baseline.root,'skills/demo/SKILL.md'),'---\nname: demo\ndescription: Old description\n---\nOld workflow.');
  // Baseline eval schema is deliberately obsolete: only its skill material is used.
  await writeFile(join(baseline.root,'evals/cases.json'),'{"schemaVersion":1}');
  const a=await prepareCase(current.root,'one',join(current.root,'a'),join(current.root,'judge-a'),baseline.root);
  const b=await prepareCase(current.root,'one',join(current.root,'b'),join(current.root,'judge-b'));
  assert.equal(a.inputHash,b.inputHash);assert.notEqual(a.bundleHash,b.bundleHash);
  assert.match(await readFile(join(current.root,'a/skills/demo/SKILL.md'),'utf8'),/Old workflow/);
  assert.doesNotMatch(await readFile(join(current.root,'b/skills/demo/SKILL.md'),'utf8'),/Old workflow/);
});
test('explicit router can read a supplied downstream skill without leaking its rubric',async()=>{
  const {root,data}=await fixture();
  await mkdir(join(root,'skills/target'));
  await writeFile(join(root,'skills/target/SKILL.md'),'---\nname: target\ndescription: Target workflow\n---\nWork.');
  const catalog={...data,cases:[{...data.cases[0],availableSkills:['target']}]};
  await prepareCase(root,'one',join(root,'agent'),join(root,'judge'),root,catalog);
  assert.deepEqual(await readdir(join(root,'agent/skills')),['demo','target']);
  const input=await readFile(join(root,'agent/input.json'),'utf8');
  assert.doesNotMatch(input,/SECRET_RUBRIC/);assert.match(input,/target/);
  await assert.rejects(validateCases(root,{...data,cases:[{...data.cases[0],availableSkills:['missing']}]}),/Unknown available/);
});
