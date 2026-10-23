import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { calculateRecalculation, meanSeconds } from '../src/recalculation.ts';
import { createCorrectionPlan, validateCorrectionPlan } from '../src/correction-plan.ts';
import { executeCorrectionPlan, verifyCorrectionPlan, verifyCorrectionStatistics } from '../src/correction-executor.ts';
import { FileCorrectionHost } from '../src/recalculation-store.ts';
import { digest, timestamp } from '../src/recalculation-evidence.ts';
import { FixtureApi, units, key, at, bonusId, memoryHost, team } from './recalculation-fixture.ts';

const destroyed = (required: number) => ({ id: 'synthetic-destroyed', reason: 'Уничтожен тигр2', type: 'destroyed-code', units,
  required, destroyedUnitId: '1', choice: 'reduce-required-by-one' });
test('destroyed-code policy is offered, never automatic; author examples for all codes', async () => {
  const api = new FixtureApi(), evidence = await api.read();
  const undecided = { ...destroyed(5), choice: undefined };
  // JSON input omits missing fields.
  delete undecided.choice;
  const choice = calculateRecalculation(evidence, undecided);
  assert.equal(choice.status, 'needs-clarification'); assert.equal(choice.rows.length, 0);
  await assert.rejects(createCorrectionPlan(evidence, undecided), /Resolve/);
  const result = calculateRecalculation(evidence, destroyed(5));
  assert.equal(result.rows[0].bonusSeconds, 0); assert.equal(result.rows[1].bonusSeconds, 10);
  assert.equal(result.rows[1].targetSeconds, 40);
  assert.equal(calculateRecalculation(evidence, { ...destroyed(5), choice: 'keep-results' }).rows.length, 0);
});
test('four of five becomes three living codes only after choosing that variant', async () => {
  const api = new FixtureApi(); api.durations = [40, 40];
  api.order(1, ['тигр2', 'лев3', 'слон1', 'мышь5']); api.order(2, ['мышь5', 'кот4', 'лев3', 'слон1']);
  const result = calculateRecalculation(await api.read(), destroyed(4));
  assert.deepEqual(result.rows.map(r => [r.targetSeconds, r.bonusSeconds]), [[40, 0], [30, 10]]);
});
test('wrong engine answer credits rejected intended input but waits for other required codes', async () => {
  const api = new FixtureApi(); api.events = [api.event(1, 'верно1', 10, false, 1), api.event(1, 'другой2', 30, true, 2), api.event(1, 'верно1', 50, true, 3)];
  const result = calculateRecalculation(await api.read(), { id: 'fix', reason: 'Ошибка ответа', type: 'wrong-answer', fixedAt: at(40),
    units: [{ id: 'a', answers: ['верно1'] }, { id: 'b', answers: ['другой2'] }], affectedUnitIds: ['a'], required: 2, participants: [key(1)] });
  assert.equal(result.rows[0].targetSeconds, 30); assert.equal(result.rows[0].bonusSeconds, 20); assert.deepEqual(result.rows[0].evidence, ['0:950001', '0:950002']);
});
test('full ordered composite chain, incomplete chain and exact strings', async () => {
  const api = new FixtureApi(); api.events = [api.event(1, 'часть2', 5, false, 1), api.event(1, 'часть1', 10, false, 2), api.event(1, 'часть2', 25, false, 3)];
  const rule = { id: 'chain', reason: 'Цепочка', type: 'wrong-answer', fixedAt: at(40), units: [{ id: 'a', answers: [], parts: [['часть1'], ['часть2']], ordered: true }], affectedUnitIds: ['a'], required: 1, participants: [key(1)] };
  assert.equal(calculateRecalculation(await api.read(), rule).rows[0].targetSeconds, 25);
  api.events.pop(); assert.equal(calculateRecalculation(await api.read(), rule).status, 'needs-clarification');
  api.events.push(api.event(1, 'ЧАСТЬ2', 25, false, 3));
  assert.equal(calculateRecalculation(await api.read(), rule).status, 'needs-clarification');
  assert.equal(calculateRecalculation(await api.read(), { ...rule, comparison: 'trim-casefold' }).rows[0].targetSeconds, 25);
});
test('bonus 20 -> 120 credits 100 once; unknown historical award is not zero', async () => {
  const api = new FixtureApi(); const first = api.event(1, 'бонус1', 20, true, 1);
  api.bonusEvents = [{ ...first, enter_date_time: at(20), bonus_id: bonusId }, { ...first, action_id: 950002, enter_date_time: at(30), bonus_id: bonusId }];
  const rule = { id: 'bonus-fix', reason: 'Неверный размер бонуса', type: 'bonus', bonusId, answers: ['бонус1'], intendedSeconds: 120 };
  assert.equal(calculateRecalculation(await api.read(), rule).status, 'needs-clarification');
  const result = calculateRecalculation(await api.read(), { ...rule, creditedSeconds: { [key(1)]: 20 } });
  assert.equal(result.rows[0].bonusSeconds, 100); assert.equal(result.rows[0].evidence.length, 1);
  assert.equal(calculateRecalculation(await api.read(), { ...rule, creditedSeconds: { [key(1)]: 0 } }).rows[0].bonusSeconds, 120);
});
test('mean uses normal completions before cutoff; both signs, no donors and 50 percent', async () => {
  const api = new FixtureApi(); api.events = []; api.durations = [60, 120, 180, 150, 90]; api.passTypes = [0, 0, 0, 1, 2];
  const rule = { id: 'mean', reason: 'Слетел уровень', type: 'cancelled-level', cutoff: at(200), rosterConfirmed: true };
  const preview = calculateRecalculation(await api.read(), rule);
  assert.equal(preview.summary?.passed, 3); assert.equal(preview.summary?.participants, 5); assert.equal(preview.status, 'needs-clarification');
  const result = calculateRecalculation(await api.read(), { ...rule, choice: 'average' });
  assert.equal(result.summary?.meanSeconds, 120); assert.equal(result.summary?.sumSeconds, 360);
  assert.deepEqual(result.rows.map(r => [r.bonusSeconds, r.penaltySeconds]), [[0, 0], [0, 0], [0, 0], [30, 0], [0, 30]]);
  assert.equal(result.rows[3].reason, 'Среднее время на уровне 5');
  api.durations = [60, 61, 90, 90]; api.passTypes = [0, 0, 1, 1];
  const half = calculateRecalculation(await api.read(), rule); assert.equal(half.summary?.suggested, 'ask');
  assert.equal(calculateRecalculation(await api.read(), { ...rule, choice: 'average' }).status, 'needs-clarification');
  assert.equal(calculateRecalculation(await api.read(), { ...rule, choice: 'average', rounding: 'ceil' }).rows[2].targetSeconds, 61);
  api.passTypes = [1, 1, 2, 2]; assert.equal(calculateRecalculation(await api.read(), { ...rule, choice: 'average' }).status, 'needs-clarification');
  assert.throws(() => meanSeconds([]), /No normal/);
});
test('paginated raw evidence preserves fields; incomplete pages and missing time fail closed', async () => {
  const api = new FixtureApi(); api.pages = 2;
  assert.equal((await api.read()).events.length, 10);
  api.omitPage = true; await assert.rejects(api.read(), /Incomplete/);
  api.omitPage = false; api.events[0].answer_date_time = '2026-10-14 10:00:00';
  await assert.rejects(api.read(), /timezone/);
});
test('exact table approval, SDK POST and verified read-back; repeated apply never resends', async () => {
  const api = new FixtureApi(), client = api.client(), plan = await createCorrectionPlan(await api.read(client), destroyed(5));
  const host = memoryHost(false); await assert.rejects(executeCorrectionPlan(client, plan, host), /Human confirmation/); assert.equal(api.writes, 0);
  host.approvedValue = true;
  const result = await executeCorrectionPlan(client, plan, host); assert.equal(api.writes, 1); assert.equal(result.entries[0].state, 'verified');
  assert.equal(api.items[0].game_player_id, 920002); assert.equal(api.items[0].seconds, 10); assert.equal(api.items[0].is_bonus, true);
  await executeCorrectionPlan(client, plan, host); assert.equal(api.writes, 1);
  assert.equal(api.items[0].comment, 'Уничтожен тигр2');
  const refreshed = calculateRecalculation(await api.read(), { ...destroyed(5), existingCorrectionIds: [result.entries[0].correctId] }); assert.equal(refreshed.rows[1].bonusSeconds, 0);
});
test('changed sources, changed table, hidden payload mismatch and changed account stop writes', async () => {
  const api = new FixtureApi(), client = api.client(), plan = await createCorrectionPlan(await api.read(client), destroyed(5));
  api.version = 'changed'; await assert.rejects(executeCorrectionPlan(client, plan, memoryHost()), /Source data changed/); assert.equal(api.writes, 0);
  const altered = structuredClone(plan); altered.table += 'edited'; await assert.rejects(validateCorrectionPlan(altered), /changed/);
  const hidden = structuredClone(plan); hidden.operations[0].seconds = 900;
  const { id: _id, ...body } = hidden; hidden.id = await digest(body); await assert.rejects(validateCorrectionPlan(hidden), /payload differ/);
  api.token = 'another-synthetic-token'; await assert.rejects(executeCorrectionPlan(client, plan, memoryHost()), /changed/);
});
test('lost response is unknown and reconciles without POST; failed read-back is not rejection', async () => {
  for (const fault of ['loseWriteResponse', 'failReadBack'] as const) {
    const api = new FixtureApi(); api[fault] = true;
    const client = api.client(), plan = await createCorrectionPlan(await api.read(client), destroyed(5)), host = memoryHost();
    const journal = await executeCorrectionPlan(client, plan, host); assert.equal(journal.entries[0].state, 'unknown');
    api[fault] = false;
    const checked = await verifyCorrectionPlan(client, plan, journal); assert.equal(checked.entries[0].state, 'verified'); assert.equal(api.writes, 1);
  }
});
test('multiple rows stop on rejection; durable host requires matching table and retains journal', async () => {
  const api = new FixtureApi(); api.order(1, ['мышь5', 'кот4', 'лев3', 'слон1', 'тигр2']); api.failWrite = true;
  const client = api.client(), plan = await createCorrectionPlan(await api.read(client), destroyed(5));
  const host = new FileCorrectionHost(await mkdtemp(join(tmpdir(), 'recalculation-')));
  await assert.rejects(host.approve(plan, 'wrong'), /exact table/); assert.equal(await host.approved(plan.id), false);
  await host.approve(plan, plan.id); const journal = await executeCorrectionPlan(client, plan, host);
  assert.deepEqual(journal.entries.map(r => r.state), ['rejected', 'pending']); assert.equal(api.writes, 1);
  const restarted = new FileCorrectionHost(host.root); await executeCorrectionPlan(client, plan, restarted); assert.equal(api.writes, 1);
});
test('dismissal is a separate confirmed operation and unfinished games cannot produce write plans', async () => {
  const api = new FixtureApi(), client = api.client();
  const rule = { id: 'cancel', reason: 'Уровень отменён', type: 'cancelled-level', cutoff: at(20), rosterConfirmed: true, choice: 'dismiss' };
  const plan = await createCorrectionPlan(await api.read(client), rule); assert.equal(plan.operations[0].kind, 'dismiss');
  assert.equal((await executeCorrectionPlan(client, plan, memoryHost())).entries[0].state, 'verified');
  api.finished = false; await assert.rejects(createCorrectionPlan(await api.read(), destroyed(5)), /finished/);
});
test('CLI creates the same calculated table and packaged Python script checks arithmetic', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recalculate-cli-')), evidence = join(directory, 'evidence.json'), rules = join(directory, 'rules.json'), output = join(directory, 'calculation.json');
  await writeFile(evidence, JSON.stringify(await new FixtureApi().read())); await writeFile(rules, JSON.stringify(destroyed(5)));
  const cli = new URL('../src/recalculation-cli.ts', import.meta.url);
  const run = spawnSync(process.execPath, [cli.pathname.replace(/^\/(\w:)/, '$1'), 'calculate', '--evidence', evidence, '--rules', rules, '--out', output], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr); assert.equal(JSON.parse(await readFile(output, 'utf8')).rows[1].bonusSeconds, 10);
  const input = join(directory, 'math.json'); await writeFile(input, JSON.stringify({ timesSeconds: [60, 120, 180], targets: [{ key: key(1), currentSeconds: 150, targetSeconds: 120 }] }));
  const python = spawnSync('python', [new URL('../dist/skills/game-recalculation/scripts/math_check.py', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), '--input', input], { encoding: 'utf8' });
  assert.equal(python.status, 0, python.stderr); assert.equal(JSON.parse(python.stdout).rows[0].bonusSeconds, 30);
});
test('unknown partial batch blocks new approval until read-only reconciliation; verified IDs prevent duplicate awards', async () => {
  const api = new FixtureApi(); api.order(1, ['мышь5', 'кот4', 'лев3', 'слон1', 'тигр2']); api.loseWriteResponse = true;
  const client = api.client(), plan = await createCorrectionPlan(await api.read(client), destroyed(5));
  const host = new FileCorrectionHost(await mkdtemp(join(tmpdir(), 'recalc-partial-')));
  await host.approve(plan, plan.id); const attempt = await executeCorrectionPlan(client, plan, host);
  assert.deepEqual(attempt.entries.map(row => row.state), ['unknown', 'pending']);
  const beforeReconcile = await createCorrectionPlan(await api.read(), destroyed(5));
  await assert.rejects(host.approve(beforeReconcile, beforeReconcile.id), /Reconcile previous/);
  api.loseWriteResponse = false; const checked = await verifyCorrectionPlan(client, plan, attempt); await host.save(checked);
  const ids = await host.incidentCorrectionIds(plan.rule.id, plan.scope, plan.sessionKey); assert.equal(ids.length, 1);
  const remaining = await createCorrectionPlan(await api.read(), { ...destroyed(5), existingCorrectionIds: ids });
  assert.equal(remaining.operations.length, 1); assert.equal(remaining.operations[0].key, key(2));
  await host.approve(remaining, remaining.id); const done = await executeCorrectionPlan(client, remaining, host);
  assert.equal(done.entries[0].state, 'verified'); assert.equal(api.writes, 2);
  assert.equal((await verifyCorrectionStatistics(client, remaining)).state, 'verified');
});
test('mean operation comments stay exactly author-facing, without journal markers', async () => {
  const api = new FixtureApi(); api.events = []; api.durations = [60, 120, 180, 150]; api.passTypes = [0, 0, 0, 1];
  const plan = await createCorrectionPlan(await api.read(), { id: 'mean-comment', reason: 'Слёт', type: 'cancelled-level', cutoff: at(200), rosterConfirmed: true, choice: 'average' });
  assert.equal(plan.operations[0].comment, 'Среднее время на уровне 5');
});
test('calendar dates, timezone and missing completion dates never become guessed donor times', async () => {
  assert.throws(() => timestamp('2026-02-30T12:00:00Z'), /calendar/);
  assert.equal(timestamp('2026-10-14T03:00:00+03:00'), timestamp('2026-10-14T00:00:00Z'));
  const api = new FixtureApi(); const original = api.stats.bind(api);
  api.stats = () => original().map((row, i) => ({ ...row, enter_date_time: i === 1 ? '0001-01-01T00:00:00Z' : row.enter_date_time }));
  const result = calculateRecalculation(await api.read(), { id: 'no-date', reason: 'Слёт', type: 'cancelled-level', cutoff: at(100), rosterConfirmed: true, choice: 'average' });
  assert.equal(result.summary?.passed, 1); assert.equal(result.summary?.participants, 2); assert.equal(result.rows[1].state, 'unresolved');
});
test('unordered composite alternatives find the first complete assignment without reusing an input', async () => {
  const api = new FixtureApi(); api.events = [api.event(1, 'a', 10, false, 1), api.event(1, 'b', 20, false, 2)];
  const result = calculateRecalculation(await api.read(), { id: 'unordered', reason: 'Составной код', type: 'wrong-answer', fixedAt: at(40), required: 1,
    affectedUnitIds: ['a'], units: [{ id: 'a', answers: [], parts: [['a', 'b'], ['a']], ordered: false }], participants: [key(1)] });
  assert.equal(result.rows[0].targetSeconds, 20); assert.equal(result.rows[0].evidence.length, 2);
});
test('ordered parts sharing a timestamp need clarification even if a later repeat could complete them', async () => {
  const api = new FixtureApi(); api.events = [api.event(1, 'a', 10, false, 1), api.event(1, 'b', 10, false, 2), api.event(1, 'b', 20, false, 3)];
  const result = calculateRecalculation(await api.read(), { id: 'tied', reason: 'Цепочка', type: 'wrong-answer', fixedAt: at(40), required: 1,
    affectedUnitIds: ['a'], units: [{ id: 'a', answers: [], parts: [['a'], ['b']], ordered: true }], participants: [key(1)] });
  assert.equal(result.status, 'needs-clarification'); assert.equal(result.rows[0].targetSeconds, null);
});
test('dismissed levels need a restoration decision and a source edit between rows stops remaining writes', async () => {
  const api = new FixtureApi(); api.dismissed = true;
  await assert.rejects(createCorrectionPlan(await api.read(), destroyed(5)), /restoring/);
  api.dismissed = false; api.order(1, ['мышь5', 'кот4', 'лев3', 'слон1', 'тигр2']);
  const original = api.fetch;
  api.fetch = async (url, init) => { const response = await original(url, init); if (init?.method === 'POST') api.version = 'concurrent-author-edit'; return response; };
  const client = api.client(), plan = await createCorrectionPlan(await api.read(client), destroyed(5));
  const journal = await executeCorrectionPlan(client, plan, memoryHost());
  assert.deepEqual(journal.entries.map(row => row.state), ['verified', 'pending']); assert.equal(api.writes, 1); assert.match(journal.stoppedReason!, /Source data/);
});
