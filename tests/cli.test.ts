import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const game = fileURLToPath(new URL('../examples/game.json', import.meta.url));
const plan = fileURLToPath(new URL('../examples/text-plan.json', import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: tmpdir(), encoding: 'utf8' });
test('CLI works from unrelated cwd and keeps Cyrillic variants', () => {
  const p = run('code-variants', '--code', 'конь6'); assert.equal(p.status, 0, p.stderr);
  assert.ok(JSON.parse(p.stdout).variants.some((v: any) => v.code === 'кон66'));
});
test('checklist has 98 separate statuses and virtual excludes field checks', () => {
  const p = run('checklist', '--format', 'virtual'); assert.equal(p.status, 0, p.stderr);
  const result = JSON.parse(p.stdout); assert.equal(result.rules.length, 98);
  assert.ok(result.rules.some((r: any) => r.id === 'MARK-01' && r.status === 'not-applicable'));
  assert.ok(result.rules.some((r: any) => r.id === 'LOGIC-01' && r.status === 'not-checked'));
});
test('CLI invalid input and unknown flags fail with JSON stderr', () => {
  for (const args of [['validate'], ['code-variants', '--code', 'конь6', '--format', 'virtual'], ['missing-command']]) {
    const p = run(...args); assert.equal(p.status, 1); assert.ok(JSON.parse(p.stderr).message);
  }
});
test('apply-local creates a new draft and refuses overwrites', () => {
  const dir = mkdtempSync(join(tmpdir(), 'en-skills-test-')), out = join(dir, 'result.json');
  const p = run('apply-local', '--input', game, '--plan', plan, '--out', out);
  assert.equal(p.status, 0, p.stderr);
  const saved = readFileSync(out, 'utf8'); assert.match(JSON.parse(saved).levels[0].task, /одну надпись/);
  const again = run('apply-local', '--input', game, '--plan', plan, '--out', out);
  assert.equal(again.status, 1); assert.equal(readFileSync(out, 'utf8'), saved);
});
test('audit machine errors have exit 2 and parsable report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'en-skills-audit-')), path = join(dir, 'game.json');
  const bad = JSON.parse(readFileSync(game, 'utf8')); bad.levels[0].requiredSectors = 99;
  writeFileSync(path, JSON.stringify(bad)); const p = run('audit', '--input', path);
  assert.equal(p.status, 2, p.stderr); assert.ok(JSON.parse(p.stdout).findings.some((f: any) => f.ruleId === 'AUTO-SECTORS-COUNT'));
});

test('remote CLI validates credentials locally and never prints credential values', () => {
  const env={...process.env};
  delete env.ENCOUNTER_ACCESS_TOKEN;
  for (const args of [['encounter-game','--domain','demo.en.cx','--game','900001']]) {
    const p=spawnSync(process.execPath,[cli,...args],{cwd:tmpdir(),encoding:'utf8',env});
    assert.equal(p.status,1);
    assert.match(JSON.parse(p.stderr).message,/Missing environment variable/);
  }
});


test('retired Google commands fail as unknown even with a legacy token in the environment', () => {
  for (const command of ['google-doc','google-sheet','google-values','google-file']) {
    const p=spawnSync(process.execPath,[cli,command],{cwd:tmpdir(),encoding:'utf8',env:{...process.env,GOOGLE_ACCESS_TOKEN:'synthetic-retired-token'}});
    assert.equal(p.status,1);
    assert.equal(JSON.parse(p.stderr).message,`Unknown command: ${command}`);
    assert.ok(!p.stderr.includes('synthetic-retired-token'));
  }
});
