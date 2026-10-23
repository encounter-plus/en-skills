import { canonical, integer, record, requireData, timestamp, type AnswerEvent, type Participant, type RecalculationEvidence } from './recalculation-evidence.ts';

export interface CreditUnit { id: string; answers: string[]; parts?: string[][]; ordered?: boolean }
interface CommonRule { id: string; reason: string; participants?: string[]; existingCorrectionIds?: number[]; rounding?: 'exact' | 'floor' | 'ceil' | 'nearest' }
export type RecalculationRule = CommonRule & (
  | { type: 'wrong-answer'; units: CreditUnit[]; required: number; affectedUnitIds: string[]; fixedAt: string; comparison?: 'literal' | 'trim-casefold' }
  | { type: 'destroyed-code'; units: CreditUnit[]; required: number; destroyedUnitId: string; choice?: 'reduce-required-by-one' | 'keep-results'; comparison?: 'literal' | 'trim-casefold' }
  | { type: 'bonus'; bonusId: number | null; answers: string[]; intendedSeconds: number; fromAt?: string; toAt?: string;
      creditedSeconds?: Record<string, number>; source?: 'bonus' | 'main'; acceptUnrecognizedInputs?: boolean; comparison?: 'literal' | 'trim-casefold' }
  | { type: 'cancelled-level'; cutoff: string; choice?: 'average' | 'dismiss' | 'keep-results'; rosterConfirmed?: boolean }
);
export interface CalculationRow {
  key: string; label: string; playerId: number; gamePlayerId: number; basis: 'elapsed' | 'award';
  beforeSeconds: number | null; targetSeconds: number | null; existingIncidentAward: number;
  bonusSeconds: number; penaltySeconds: number; reason: string; evidence: string[];
  state: 'ready' | 'unchanged' | 'unresolved'; note: string;
  startAt?: string | null; completedAt?: string | null; targetCompletedAt?: string | null;
  inputs?: { ref: string; answer: string; at: string; correct: boolean | null }[];
  acceptedInputs?: { ref: string; answer: string; at: string; correct: boolean | null }[];
}
export interface RecalculationResult {
  schemaVersion: 1; status: 'complete' | 'needs-clarification'; rule: RecalculationRule;
  rows: CalculationRow[]; questions: string[]; formula: string; dismiss: boolean;
  summary?: { passed: number; participants: number; percent: number; suggested: 'average' | 'dismiss' | 'ask'; donorKeys: string[];
    donorSeconds: number[]; sumSeconds: number; divisor: number; exactMean: string; meanSeconds: number | null };
}
export function validateRule(value: unknown): RecalculationRule {
  const rule = record(value);
  requireData(typeof rule.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(rule.id), 'Incident ID must be stable ASCII identifier');
  requireData(typeof rule.reason === 'string' && rule.reason.trim().length > 0 && rule.reason.length <= 700, 'Explain the reason for recalculation');
  requireData(['wrong-answer', 'destroyed-code', 'bonus', 'cancelled-level'].includes(String(rule.type)), 'Unknown recalculation reason');
  const common = ['id', 'reason', 'participants', 'existingCorrectionIds', 'rounding'];
  const specific = rule.type === 'wrong-answer' ? ['type', 'units', 'required', 'affectedUnitIds', 'fixedAt', 'comparison'] :
    rule.type === 'destroyed-code' ? ['type', 'units', 'required', 'destroyedUnitId', 'choice', 'comparison'] :
    rule.type === 'bonus' ? ['type', 'bonusId', 'answers', 'intendedSeconds', 'fromAt', 'toAt', 'creditedSeconds', 'source', 'acceptUnrecognizedInputs', 'comparison'] :
    ['type', 'cutoff', 'choice', 'rosterConfirmed'];
  requireData(Object.keys(rule).every(key => [...common, ...specific].includes(key)), 'Unknown rule field');
  if (rule.participants !== undefined) requireData(Array.isArray(rule.participants) && rule.participants.length > 0 && rule.participants.every(x => typeof x === 'string') && new Set(rule.participants).size === rule.participants.length, 'Invalid participant selection');
  if (rule.existingCorrectionIds !== undefined) requireData(Array.isArray(rule.existingCorrectionIds) && rule.existingCorrectionIds.every(x => Number.isSafeInteger(x) && Number(x) > 0) && new Set(rule.existingCorrectionIds).size === rule.existingCorrectionIds.length, 'Invalid existing correction IDs');
  requireData(rule.rounding === undefined || ['exact', 'floor', 'ceil', 'nearest'].includes(String(rule.rounding)), 'Unknown rounding');
  if (rule.type === 'wrong-answer' || rule.type === 'destroyed-code') {
    requireData(Array.isArray(rule.units) && rule.units.length > 0 && rule.units.length <= 500, 'Credit units required');
    const ids = new Set<string>(), aliases = new Map<string, string>();
    for (const raw of rule.units) {
      const unit = record(raw); requireData(typeof unit.id === 'string' && unit.id.trim() && !ids.has(unit.id), 'Duplicate or missing credit unit ID'); ids.add(unit.id);
      requireData(Array.isArray(unit.answers) && unit.answers.every(x => typeof x === 'string' && x.length > 0), 'Literal answer aliases required');
      if (unit.parts !== undefined) requireData(Array.isArray(unit.parts) && unit.parts.length > 0 && unit.parts.every(p => Array.isArray(p) && p.length > 0 && p.every(x => typeof x === 'string' && x.length > 0)), 'Invalid composite answer');
      requireData(unit.answers.length > 0 || unit.parts !== undefined, 'Empty credit unit');
      requireData(unit.ordered === undefined || typeof unit.ordered === 'boolean', 'Invalid chain ordering');
      const strings = [...unit.answers, ...(unit.parts as string[][] ?? []).flat()];
      for (const text of strings) {
        const key = rule.comparison === 'trim-casefold' ? (text as string).trim().toLowerCase() : text as string;
        requireData(!aliases.has(key) || aliases.get(key) === unit.id, 'Ambiguous aliases across credit units'); aliases.set(key, unit.id);
      }
    }
    requireData(integer(rule.required, 1) <= ids.size, 'Required credits exceed unit count');
    if (rule.type === 'wrong-answer') { timestamp(rule.fixedAt); requireData(Array.isArray(rule.affectedUnitIds) && rule.affectedUnitIds.length > 0 && rule.affectedUnitIds.every(x => ids.has(String(x))), 'Affected units required'); }
    else { requireData(ids.has(String(rule.destroyedUnitId)), 'Unknown destroyed credit unit'); requireData(rule.choice === undefined || ['reduce-required-by-one', 'keep-results'].includes(String(rule.choice)), 'Choose a destroyed-code policy'); }
  }
  if (rule.type === 'bonus') {
    requireData(rule.bonusId === null || Number.isSafeInteger(rule.bonusId) && Number(rule.bonusId) > 0, 'Invalid bonus ID');
    requireData(Array.isArray(rule.answers) && rule.answers.length > 0 && rule.answers.every(x => typeof x === 'string' && x.length > 0), 'Bonus answers required');
    integer(rule.intendedSeconds); if (rule.fromAt !== undefined) timestamp(rule.fromAt); if (rule.toAt !== undefined) timestamp(rule.toAt);
    requireData(rule.fromAt === undefined || rule.toAt === undefined || timestamp(rule.fromAt) <= timestamp(rule.toAt), 'Invalid bonus interval');
    if (rule.creditedSeconds !== undefined) for (const value of Object.values(record(rule.creditedSeconds))) integer(value);
    requireData(rule.source === undefined || rule.source === 'bonus' || rule.source === 'main', 'Invalid bonus evidence source');
    requireData(rule.acceptUnrecognizedInputs === undefined || typeof rule.acceptUnrecognizedInputs === 'boolean', 'Invalid bonus verdict policy');
  }
  if (rule.type === 'cancelled-level') { timestamp(rule.cutoff); requireData(rule.choice === undefined || ['average', 'dismiss', 'keep-results'].includes(String(rule.choice)), 'Choose cancelled-level policy'); }
  requireData(rule.comparison === undefined || ['literal', 'trim-casefold'].includes(String(rule.comparison)), 'Unknown answer comparison');
  return JSON.parse(canonical(rule)) as RecalculationRule;
}
function plus(values: number[]): number { const sum = values.reduce((a, b) => a + b, 0); requireData(Number.isSafeInteger(sum), 'Calculation overflow'); return sum; }
export function meanSeconds(values: number[]) {
  requireData(values.length > 0, 'No normal completions for mean'); values.forEach(x => integer(x));
  const sum = plus(values); return { sum, count: values.length, exact: `${sum}/${values.length}`, value: sum / values.length };
}
function whole(value: number, mode: CommonRule['rounding']): number | null {
  if (Number.isSafeInteger(value)) return value;
  if (!mode || mode === 'exact') return null;
  const number = mode === 'floor' ? Math.floor(value) : mode === 'ceil' ? Math.ceil(value) : Math.round(value);
  return Number.isSafeInteger(number) ? number : null;
}
function participantCorrections(e: RecalculationEvidence, p: Participant) {
  return (e.raw.corrections.items as unknown[]).map(record).filter(row => row[e.mode === 'team' ? 'team_id' : 'user_id'] === p.id && row.level_id === Number(e.scope.levelId));
}
function alreadyAwarded(e: RecalculationEvidence, p: Participant, rule: RecalculationRule): number {
  const marker = `[recalc:${rule.id}]`;
  return plus(participantCorrections(e, p).filter(row => rule.existingCorrectionIds?.includes(Number(row.correct_id)) || typeof row.comment === 'string' && row.comment.endsWith(marker))
    .map(row => integerSigned(row.correction_value)));
}
function integerSigned(value: unknown) { requireData(Number.isSafeInteger(value), 'Unknown correction amount'); return Number(value); }
function rowFor(p: Participant, rule: RecalculationRule, before: number | null, target: number | null, existing: number, basis: 'elapsed' | 'award', actions: string[], note: string): CalculationRow {
  // Award signs are opposite to changes in race time.
  const delta = before === null || target === null ? null : basis === 'elapsed' ? target - before + existing : before + existing - target;
  const valid = delta !== null && Number.isSafeInteger(delta);
  return { key: p.key, label: p.label, playerId: p.id, gamePlayerId: p.gamePlayerId, basis, beforeSeconds: before, targetSeconds: target,
    existingIncidentAward: existing, bonusSeconds: valid ? Math.max(0, -delta) : 0, penaltySeconds: valid ? Math.max(0, delta) : 0,
    reason: rule.reason, evidence: actions, state: valid ? delta === 0 ? 'unchanged' : 'ready' : 'unresolved', note };
}
function creditAt(unit: CreditUnit, events: AnswerEvent[], accepts: (e: AnswerEvent) => boolean, normalize: (s: string) => string): { at: number; actions: string[] } | null {
  const matches = (event: AnswerEvent, answers: string[]) => accepts(event) && answers.some(answer => normalize(event.answer) === normalize(answer));
  const wholeAnswer = events.find(event => matches(event, unit.answers));
  let chain: { at: number; actions: string[] } | null = null;
  if (unit.parts) {
    if (unit.ordered) {
      const sameTime = new Map<number, Set<number>>();
      for (const event of events) unit.parts.forEach((part, index) => {
        if (!matches(event, part)) return;
        const parts = sameTime.get(event.at) ?? new Set<number>(); parts.add(index); sameTime.set(event.at, parts);
      });
      const ambiguousAt = Math.min(...[...sameTime].filter(([, parts]) => parts.size > 1).map(([at]) => at));
      if (Number.isFinite(ambiguousAt)) return wholeAnswer && wholeAnswer.at <= ambiguousAt ? directCredit(wholeAnswer) : null;
    }
    const used = new Set<number>(), chosen: AnswerEvent[] = [];
    if (!unit.ordered) {
      const assigned = new Map<number, AnswerEvent>();
      const place = (event: AnswerEvent, visited: Set<number>): boolean => {
        for (let i = 0; i < unit.parts!.length; i++) {
          if (visited.has(i) || !matches(event, unit.parts![i])) continue;
          visited.add(i); const previous = assigned.get(i);
          if (!previous || place(previous, visited)) { assigned.set(i, event); return true; }
        }
        return false;
      };
      for (const event of events) {
        place(event, new Set());
        if (assigned.size === unit.parts.length) { chosen.push(...[...assigned].sort(([a], [b]) => a - b).map(([, event]) => event)); break; }
      }
    } else for (const part of unit.parts) {
      const previous = chosen.at(-1);
      const event = events.find(event => !used.has(event.actionId) && matches(event, part) && (!unit.ordered || !previous || event.at > previous.at));
      if (!event) { chosen.length = 0; break; }
      chosen.push(event); used.add(event.actionId);
    }
    if (chosen.length === unit.parts.length) chain = { at: Math.max(...chosen.map(e => e.at)), actions: chosen.map(e => `0:${e.actionId}`) };
  }
  const direct = directCredit(wholeAnswer);
  return direct && (!chain || direct.at <= chain.at) ? direct : chain;
}
function directCredit(event: AnswerEvent | undefined) { return event ? { at: event.at, actions: [`0:${event.actionId}`] } : null; }
/** Deterministic calculation. Destroyed/cancelled policies are choices, never inferred decisions. */
export function calculateRecalculation(e: RecalculationEvidence, input: unknown): RecalculationResult {
  requireData(e.schemaVersion === 1 && e.complete === true, 'Complete evidence required');
  const rule = validateRule(input);
  if (rule.existingCorrectionIds) {
    const entries = (e.raw.corrections.items as unknown[]).map(record);
    requireData(rule.existingCorrectionIds.every(id => entries.some(row => row.correct_id === id && row.game_id === Number(e.scope.gameId) && row.level_id === Number(e.scope.levelId))), 'Existing correction is missing or belongs to another level/game');
  }
  const selected = rule.participants ? e.participants.filter(p => rule.participants!.includes(p.key)) : e.participants.filter(p => p.eligible);
  requireData(selected.length > 0 && (!rule.participants || selected.length === rule.participants.length), 'Unknown or empty participant selection');
  const result: RecalculationResult = { schemaVersion: 1, status: 'complete', rule, rows: [], questions: [], formula: '', dismiss: false };
  const ask = (question: string) => { result.status = 'needs-clarification'; result.questions.push(question); };
  if (rule.type === 'destroyed-code' && !rule.choice) {
    ask('Предлагаемый вариант: исключить уничтоженный код и снизить порог на один. Выберите это правило, сохранение результатов или опишите другое правило.'); return result;
  }
  if (rule.type === 'cancelled-level') {
    const cutoff = timestamp(rule.cutoff);
    const enteredAfter = selected.filter(p => p.enteredAt && timestamp(p.enteredAt) > cutoff);
    const donors = e.times.filter(t => selected.some(p => p.key === t.key) && t.passType === 0 && t.endMs <= cutoff);
    const sum = plus(donors.map(t => t.rawSeconds)), count = donors.length;
    result.summary = { passed: count, participants: selected.length, percent: count / selected.length * 100,
      suggested: 2 * count > selected.length ? 'average' : 2 * count < selected.length ? 'dismiss' : 'ask',
      donorKeys: donors.map(t => t.key), donorSeconds: donors.map(t => t.rawSeconds), sumSeconds: sum, divisor: count,
      exactMean: `${sum}/${count}`, meanSeconds: count ? sum / count : null };
    result.formula = `Среднее = (${donors.map(t => t.rawSeconds).join(' + ')}) / ${count}`;
    if (!rule.rosterConfirmed || enteredAfter.length) { ask(`Подтвердите состав: прошли ${count} из ${selected.length} команд на момент слёта; после cutoff вошли ${enteredAfter.length}.`); return result; }
    if (!rule.choice) { ask(`Прошли ${count} из ${selected.length}. Выберите среднее время, снятие уровня или сохранение результатов; при ровно 50% правило отдельно уточняется.`); return result; }
    if (rule.choice === 'dismiss') { result.dismiss = true; return result; }
    if (rule.choice === 'keep-results') return result;
    if (!count) { ask('Нет нормально прошедших команд: среднее не определено.'); return result; }
    const target = whole(meanSeconds(donors.map(t => t.rawSeconds)).value, rule.rounding);
    if (target === null) ask('Среднее дробное: выберите округление до целых секунд.');
    for (const p of selected) {
      const time = e.times.find(t => t.key === p.key), passed = donors.some(t => t.key === p.key);
      const existing = alreadyAwarded(e, p, rule);
      const row = rowFor(p, { ...rule, reason: `Среднее время на уровне ${e.scope.levelNumber}` }, time?.rawSeconds ?? null,
        passed ? time!.rawSeconds - existing : target, existing, 'elapsed', [], passed ? 'Нормальное прохождение до слёта; без изменения' : 'Среднее время нормально прошедших до слёта');
      result.rows.push(row);
    }
  } else if (rule.type === 'bonus') {
    result.formula = 'Дополнительный бонус = положено - фактически начислено - уже по этому инциденту';
    if (rule.bonusId !== null) {
      const bonus = (e.raw.editor.bonuses as unknown[]).map(record).find(b => b.bonus_id === rule.bonusId);
      requireData(bonus && bonus.negative === false, 'Positive bonus must be identified in editor');
      if ((bonus.has_absolute_limit === true || bonus.has_relative_limit === true || bonus.has_delay === true) && (!rule.fromAt || !rule.toAt)) {
        ask('Бонус имеет ограничения доступности: подтвердите допустимый интервал вводов.'); return result;
      }
    }
    const normalize = (s: string) => rule.comparison === 'trim-casefold' ? s.trim().toLowerCase() : s;
    for (const p of selected) {
      const events = e.events.filter(event => event.key === p.key && event.tab === (rule.source === 'main' ? 0 : 1)
        && (rule.source === 'main' || rule.bonusId === null || event.bonusId === rule.bonusId)
        && (event.correct === true || rule.acceptUnrecognizedInputs === true && event.correct === false)
        && rule.answers.some(a => normalize(a) === normalize(event.answer))
        && (!rule.fromAt || event.at >= timestamp(rule.fromAt)) && (!rule.toAt || event.at <= timestamp(rule.toAt))).sort((a, b) => a.at - b.at);
      const existing = alreadyAwarded(e, p, rule);
      if (!events.length) {
        result.rows.push(rowFor(p, rule, 0, 0, 0, 'award', [], 'Подтверждённый ввод бонуса не найден; начисление не предложено'));
        continue;
      }
      const credits = participantCorrections(e, p).filter(row => row.bonus_id === rule.bonusId && rule.bonusId !== null && !rule.existingCorrectionIds?.includes(Number(row.correct_id)));
      const credited = rule.creditedSeconds?.[p.key] ?? (credits.length ? plus(credits.map(row => integer(row.correction_value))) : null);
      result.rows.push(rowFor(p, rule, credited, rule.intendedSeconds, existing, 'award', [`${events[0].tab}:${events[0].actionId}`],
        credited === null ? 'Подтвердите фактическое начисление: отсутствие записи не означает 0' : 'Первый подтверждённый ввод бонусного ответа'));
    }
  } else {
    if (rule.type === 'destroyed-code' && rule.choice === 'keep-results') return result;
    const required = rule.required - (rule.type === 'destroyed-code' ? 1 : 0);
    if (required < 1) { ask('После исключения кода порог нулевой: нужно отдельное правило автора.'); return result; }
    result.formula = rule.type === 'destroyed-code' ? `Выбран вариант: ${required} разных живых единиц; delta = целевое - исходное + уже начисленный бонус` : 'Первое выполнение всего условия с зачётом задуманных верных вводов до фикса';
    const normalize = (s: string) => rule.comparison === 'trim-casefold' ? s.trim().toLowerCase() : s;
    for (const p of selected) {
      const time = e.times.find(t => t.key === p.key), existing = alreadyAwarded(e, p, rule);
      if (!time) { result.rows.push(rowFor(p, rule, null, null, existing, 'elapsed', [], 'Нет исходного времени уровня')); continue; }
      const events = e.events.filter(event => event.key === p.key && event.tab === 0 && event.at >= time.startMs && event.at <= time.endMs).sort((a, b) => a.at - b.at || a.actionId - b.actionId);
      const units = rule.units.filter(unit => rule.type !== 'destroyed-code' || unit.id !== rule.destroyedUnitId);
      const credits = units.map(unit => creditAt(unit, events, event => event.correct === true ||
        rule.type === 'wrong-answer' && rule.affectedUnitIds.includes(unit.id) && event.correct === false && event.at < timestamp(rule.fixedAt), normalize)).filter(x => x !== null).sort((a, b) => a.at - b.at);
      const completion = credits[required - 1];
      const target = completion ? whole((Math.min(time.endMs, completion.at) - time.startMs) / 1000, rule.rounding) : null;
      result.rows.push(rowFor(p, rule, time.rawSeconds, target, existing, 'elapsed', credits.slice(0, required).flatMap(x => x.actions),
        completion ? 'Первое выполнение выбранного условия' : 'Недостаточно живых кодов, полной цепочки или подтверждённого порядка вводов'));
    }
  }
  if (result.rows.some(row => row.state === 'unresolved')) ask('Есть строки с недостающими данными или дробным временем; уточните их до подтверждения таблицы.');
  for (const row of result.rows) {
    const time = e.times.find(t => t.key === row.key);
    row.startAt = time ? new Date(time.startMs).toISOString() : null;
    row.completedAt = time ? new Date(time.endMs).toISOString() : null;
    row.targetCompletedAt = time && row.basis === 'elapsed' && row.targetSeconds !== null ? new Date(time.startMs + row.targetSeconds * 1000).toISOString() : null;
    const show = (event: AnswerEvent) => ({ ref: `${event.tab}:${event.actionId}`, answer: event.answer, at: new Date(event.at).toISOString(), correct: event.correct });
    row.inputs = e.events.filter(event => event.key === row.key && row.evidence.includes(`${event.tab}:${event.actionId}`)).map(show);
    if (rule.type === 'wrong-answer') {
      const normalize = (text: string) => rule.comparison === 'trim-casefold' ? text.trim().toLowerCase() : text;
      const answers = rule.units.filter(unit => rule.affectedUnitIds.includes(unit.id)).flatMap(unit => [...unit.answers, ...(unit.parts ?? []).flat()]).map(normalize);
      row.acceptedInputs = e.events.filter(event => event.key === row.key && event.tab === 0 && event.correct === true && event.at >= timestamp(rule.fixedAt)
        && (!time || event.at >= time.startMs && event.at <= time.endMs) && answers.includes(normalize(event.answer))).map(show);
    }
  }
  return result;
}
