import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const builder=fileURLToPath(new URL('../tooling/skill-packaging.mjs',import.meta.url));
test('20 discovered skills share one source, include transitive references and discard stale generated files',()=>{
  const root=mkdtempSync(join(tmpdir(),'en-skills-build-'));
  mkdirSync(join(root,'knowledge'));mkdirSync(join(root,'skills'));
  writeFileSync(join(root,'knowledge','domain.md'),'Version one. [More](details.md#part)');
  writeFileSync(join(root,'knowledge','details.md'),'# Part\nDetails');
  for(let n=0;n<20;n++){
    const name='synthetic-'+n;mkdirSync(join(root,'skills',name));
    writeFileSync(join(root,'skills',name,'SKILL.md'),`---\nname: ${name}\ndescription: Synthetic\n---\n[Domain](../../knowledge/domain.md)`);
  }
  const run=()=>{const p=spawnSync(process.execPath,[builder,root],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);};
  mkdirSync(join(root,'skills/synthetic-0/scripts'));mkdirSync(join(root,'skills/synthetic-0/agents'));
  writeFileSync(join(root,'skills/synthetic-0/scripts/check.py'),'print(123)\n');
  writeFileSync(join(root,'skills/synthetic-0/agents/openai.yaml'),'interface:\n  display_name: "Synthetic"\n');
  run();assert.equal(readdirSync(join(root,'dist/skills')).length,20);
  writeFileSync(join(root,'knowledge/domain.md'),'Version two.');
  writeFileSync(join(root,'dist/skills/synthetic-0/stale.md'),'old');
  run();
  for(let n=0;n<20;n++){
    assert.equal(readFileSync(join(root,'dist/skills', 'synthetic-'+n,'references/domain.md'),'utf8'),'Version two.');
    assert.ok(!existsSync(join(root,'dist/skills','synthetic-'+n,'references/details.md')));
    assert.ok(!existsSync(join(root,'skills','synthetic-'+n,'references')));
    assert.match(readFileSync(join(root,'skills','synthetic-'+n,'SKILL.md'),'utf8'),/\.\.\/\.\.\/knowledge/);
  }
  assert.ok(!existsSync(join(root,'dist/skills/synthetic-0/stale.md')));
  assert.equal(readFileSync(join(root,'dist/codex/skills/synthetic-0/scripts/check.py'),'utf8'),'print(123)\n');
  assert.match(readFileSync(join(root,'dist/claude/skills/synthetic-0/agents/openai.yaml'),'utf8'),/Synthetic/);
});
