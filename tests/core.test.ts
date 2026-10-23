import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditGame, parseGame, comparePhotoCodes, suggestCodeVariants, applyLocalChanges } from '../src/core.ts';
const load = (name: string) => JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), 'utf8'));
const fixture = () => load('game');
const observations = () => load('observations');

test('healthy local scenario still reports untested semantic coverage', () => {
  const report = auditGame(fixture());
  assert.deepEqual(report.findings, []);
  assert.equal(report.coverage.automatedOnly, true);
  assert.ok(report.coverage.notChecked.length);
});
test('hint at autopass and later produces evidence without silently changing time', () => {
  const game = fixture(); game.levels[0].helps[0].afterSeconds = 600;
  assert.equal(auditGame(game).findings[0].ruleId, 'AUTO-TIMING-HELP');
  game.levels[0].helps[0].afterSeconds = 601;
  assert.equal(auditGame(game).findings[0].ruleId, 'AUTO-TIMING-HELP');
  assert.equal(game.levels[0].helps[0].afterSeconds, 601);
});
test('absence of autopass is not interpreted as zero timeout', () => {
  const game = fixture(); game.levels[0].autoPassSeconds = null;
  assert.deepEqual(auditGame(game).findings, []);
});
test('unreachable sector count is distinct from missing answer data', () => {
  const game = fixture(); game.levels[0].requiredSectors = 2;
  assert.ok(auditGame(game).findings.some(f => f.ruleId === 'AUTO-SECTORS-COUNT' && f.severity === 'error'));
  game.levels[0].requiredSectors = 1; game.levels[0].sectors[0].answers = [];
  assert.ok(auditGame(game).findings.some(f => f.ruleId === 'AUTO-SECTORS-ANSWERS' && f.severity === 'warning'));
});
test('leading zeros and distinct Unicode answer strings are preserved', () => {
  const game = fixture(); game.levels[0].sectors[0].answers = ['0012', 'О0', 'O0', 'ё', 'е'];
  assert.deepEqual(parseGame(game).levels[0].sectors[0].answers, game.levels[0].sectors[0].answers);
  assert.deepEqual(auditGame(game).findings, []);
});
test('reject duplicate IDs, absent fields, negative/fractional timings and numeric codes', () => {
  const mutations = [
    (g: any) => g.levels.push(structuredClone(g.levels[0])),
    (g: any) => delete g.levels[0].playersStarted,
    (g: any) => g.levels[0].helps[0].afterSeconds = -1,
    (g: any) => g.levels[0].autoPassSeconds = 3.5,
    (g: any) => g.levels[0].sectors[0].answers = [12],
    (g: any) => g.levels[0].server_timeout = 3,
  ];
  for (const mutate of mutations) { const game = fixture(); mutate(game); assert.throws(() => parseGame(game)); }
});
test('photo wins over a conflicting document; comparison does not rewrite either', () => {
  const game = fixture(), obs = observations(); obs[0].transcription = 'учебный7';
  const result = comparePhotoCodes(game, obs)[0];
  assert.equal(result.status, 'mismatch'); assert.equal(result.photographed, 'учебный7');
  assert.equal(result.document, 'конь6'); assert.equal(game.levels[0].sectors[0].answers[0], 'конь6');
  assert.equal(result.autoApply, false);
});
test('exact match can still suggest кон66 while preserving конь6', () => {
  const result = comparePhotoCodes(fixture(), observations())[0];
  assert.equal(result.status, 'match');
  assert.ok(result.suggestedVariants.some(v => v.code === 'кон66'));
  assert.deepEqual(result.engine, ['конь6']);
  assert.equal(result.autoApply, false);
});
test('ambiguous, old, unmapped or cross-tenant photo cannot propose a correction', () => {
  const mutations = [
    (o: any) => { o.reading = 'ambiguous'; o.alternatives = ['кон66']; },
    (o: any) => { o.reading = 'unreadable'; o.transcription = null; },
    (o: any) => o.mappingVerified = false,
    (o: any) => o.currentMarkingVerified = false,
    (o: any) => o.gameId = 'synthetic-other-game',
    (o: any) => o.domain = 'other.invalid',
    (o: any) => o.sectorId = 'synthetic-missing-sector',
  ];
  for (const mutate of mutations) {
    const obs = observations(); mutate(obs[0]); const result = comparePhotoCodes(fixture(), obs)[0];
    assert.equal(result.status, 'unresolved'); assert.deepEqual(result.suggestedVariants, []);
    assert.equal(result.suggestedAction, 'none');
  }
});
test('clear reading with alternatives or without literal string is invalid', () => {
  const obs = observations(); obs[0].alternatives = ['кон66'];
  assert.throws(() => comparePhotoCodes(fixture(), obs));
  obs[0].alternatives = []; obs[0].transcription = null;
  assert.throws(() => comparePhotoCodes(fixture(), obs));
});
test('already accepted variant is not proposed again', () => {
  const game = fixture(); game.levels[0].sectors[0].answers.push('кон66');
  assert.ok(!comparePhotoCodes(game, observations())[0].suggestedVariants.some(v => v.code === 'кон66'));
});
test('live or unknown player state proposes preservation instead of replacement', () => {
  const game = fixture(), obs = observations(); obs[0].transcription = 'учебный7';
  game.phase = 'live';
  assert.equal(comparePhotoCodes(game, obs)[0].suggestedAction, 'review-additional-variant-preserve-existing');
  game.phase = 'draft'; game.levels[0].playersStarted = null;
  assert.equal(comparePhotoCodes(game, obs)[0].suggestedAction, 'review-additional-variant-preserve-existing');
});
test('variant suggestions are bounded hypotheses, not automatic normalization', () => {
  const result = suggestCodeVariants('конь6');
  assert.equal(result.original, 'конь6'); assert.equal(result.automaticAcceptance, false);
  assert.ok(result.variants.some(v => v.code === 'кон66' && v.from === 'ь' && v.to === '6'));
  const large = suggestCodeVariants('O'.repeat(30));
  assert.equal(large.variants.length, 16); assert.equal(large.truncated, true);
});
test('local change preserves original and unrelated fields', () => {
  const game = fixture(), original = structuredClone(game);
  const result = applyLocalChanges(game, load('text-plan'));
  assert.deepEqual(game, original); assert.equal(result.applied, 1);
  assert.deepEqual(result.game.levels[0].sectors, original.levels[0].sectors);
  assert.equal(result.game.levels[0].task, load('text-plan').edits[0].after);
});
test('local multi-edit plan fails entirely on stale value', () => {
  const game = fixture(), original = structuredClone(game), plan = load('text-plan');
  plan.edits.push({ levelId: game.levels[0].id, field: 'answerFormat', before: 'stale', after: 'test', reason: 'test' });
  assert.throws(() => applyLocalChanges(game, plan), /stale/);
  assert.deepEqual(game, original);
});
test('local writes reject live, wrong tenant, uncertain players and duplicate edits', () => {
  const game = fixture(), plan = load('text-plan');
  game.phase = 'live'; assert.throws(() => applyLocalChanges(game, plan));
  game.phase = 'draft'; game.levels[0].playersStarted = null; assert.throws(() => applyLocalChanges(game, plan));
  game.levels[0].playersStarted = false; plan.domain = 'other.invalid'; assert.throws(() => applyLocalChanges(game, plan));
  plan.domain = game.domain; plan.edits.push(structuredClone(plan.edits[0])); assert.throws(() => applyLocalChanges(game, plan));
});
