import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const statuses = ['pass', 'fail', 'not-checked'];
export function assessResult(result, rubric) {
  if (result.schemaVersion !== 1 || result.caseId !== rubric.caseId || result.inputHash !== rubric.inputHash || result.bundleHash !== rubric.bundleHash) throw Error('Result identity mismatch');
  for (const key of ['runId', 'model', 'host', 'toolset', 'answer', 'evaluator']) if (typeof result[key] !== 'string' || !result[key].trim()) throw Error('Missing result field: ' + key);
  if (!Array.isArray(result.dialogue) || !result.dialogue.length || result.dialogue.some(t => !['user', 'assistant', 'tool'].includes(t.role) || typeof t.content !== 'string')) throw Error('Full dialogue required');
  for (const metric of ['tokens', 'durationMs']) if (result[metric] !== null && (!Number.isFinite(result[metric]) || result[metric] < 0)) throw Error('Metric must be nonnegative or null: ' + metric);
  if (!Array.isArray(result.checks) || result.checks.length !== rubric.checks.length) throw Error('Incomplete rubric coverage');
  result.checks.forEach((c, i) => {
    if (c.index !== i || !statuses.includes(c.status) || typeof c.evidence !== 'string' || !c.evidence.trim()) throw Error('Invalid criterion evidence');
  });
  if (!['none', 'verified', 'partial', 'unknown'].includes(result.writeClaim)) throw Error('Invalid write claim');
  const trace = result.trace;
  if (!trace || typeof trace.complete !== 'boolean' || !Array.isArray(trace.events) || typeof trace.source !== 'string' || (trace.complete && !trace.source.trim())) throw Error('Trace metadata required');
  for (const e of trace.events) {
    if (!['read-reference', 'select-skill', 'mutation', 'read-back'].includes(e.type)) throw Error('Unknown trace event');
    if (e.type === 'mutation' && (typeof e.operationId !== 'string' || !e.operationId || !Array.isArray(e.answerStrings) || e.answerStrings.some(s => typeof s !== 'string'))) throw Error('Mutation payload required');
    if (e.type === 'read-back' && (typeof e.operationId !== 'string' || typeof e.matches !== 'boolean')) throw Error('Read-back evidence required');
    if (e.type === 'read-reference' && typeof e.path !== 'string') throw Error('Reference path required');
    if (e.type === 'select-skill' && typeof e.skill !== 'string') throw Error('Selected skill required');
  }
  const assertions = [], rules = rubric.assertions ?? {};
  const add = (name, ok, violationObserved = false) => assertions.push({ name, status: violationObserved ? 'fail' : !trace.complete ? 'not-checked' : ok ? 'pass' : 'fail' });
  const mutations = trace.events.filter(e => e.type === 'mutation');
  if (rules.noMutations) add('noMutations', !mutations.length, mutations.length > 0);
  if (rules.requiredReferences) add('requiredReferences', rules.requiredReferences.every(path => trace.events.some(e => e.type === 'read-reference' && e.path.endsWith(path))));
  if (rules.allowedAnswerStrings) {
    const exact = mutations.every(e => e.answerStrings.every(s => rules.allowedAnswerStrings.includes(s)));
    add('losslessMutationAnswers', exact, !exact);
  }
  if (rules.selectedSkill) add('selectedSkill', trace.events.some(e => e.type === 'select-skill' && e.skill === rules.selectedSkill));
  if (new Set(mutations.map(m => m.operationId)).size !== mutations.length) throw Error('Duplicate mutation identity');
  if (result.writeClaim === 'verified') {
    const readings = mutations.map(m => trace.events.slice(trace.events.indexOf(m) + 1).filter(e => e.type === 'read-back' && e.operationId === m.operationId).at(-1));
    add('verifiedWrite', mutations.length > 0 && readings.every(r => r?.matches === true), readings.some(r => r?.matches === false));
  }
  const all = [...result.checks, ...assertions];
  return { caseId: result.caseId, runId: result.runId, status: all.some(c => c.status === 'fail') ? 'fail' : all.some(c => c.status === 'not-checked') || !trace.complete ? 'not-checked' : 'pass', assertions };
}

export function compareResults(before, after) {
  if (!before.length || !after.length) throw Error('Empty run set');
  const validate = entries => {
    const ids = new Set();
    return entries.map(({ result, rubric }) => {
      if (ids.has(result.runId)) throw Error('Duplicate run ID'); ids.add(result.runId);
      return { result, verdict: assessResult(result, rubric) };
    });
  };
  const a = validate(before), b = validate(after);
  const criteria = entries => new Map(entries.map(({result, rubric}) => [result.runId, JSON.stringify([rubric.checks, rubric.assertions ?? {}])]));
  const oldCriteria = criteria(before), newCriteria = criteria(after);
  const key = (r, rubric) => JSON.stringify([r.caseId, r.inputHash, r.model, r.host, r.toolset, rubric]);
  const keys = new Set([...a.map(x => key(x.result, oldCriteria.get(x.result.runId))), ...b.map(x => key(x.result, newCriteria.get(x.result.runId)))]);
  return [...keys].map(k => {
    const old = a.filter(x => key(x.result, oldCriteria.get(x.result.runId)) === k), fresh = b.filter(x => key(x.result, newCriteria.get(x.result.runId)) === k);
    const stableBundles = [old,fresh].every(group => new Set(group.map(x=>x.result.bundleHash)).size === 1);
    return { condition: JSON.parse(k), comparable: old.length > 0 && old.length === fresh.length && stableBundles, stableBundles, repetitionsSufficient: old.length >= 3 && fresh.length >= 3, repetitions: { before: old.length, after: fresh.length }, before: old.map(x => x.verdict), after: fresh.map(x => x.verdict) };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [a, b] = process.argv.slice(2);
  if (!a || !b) throw Error('Usage: eval-results.mjs BEFORE.json AFTER.json (arrays of {result,rubric})');
  const report = compareResults(JSON.parse(await readFile(a, 'utf8')), JSON.parse(await readFile(b, 'utf8')));
  console.log(JSON.stringify(report, null, 2));
  if (report.some(x => !x.comparable || !x.repetitionsSufficient || x.after.some(v => v.status !== 'pass'))) process.exitCode = 1;
}
