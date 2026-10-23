/** Offline domain model. These names are NOT Encounter wire DTOs. */
export type Help = { id: string; text: string; afterSeconds: number };
export type Sector = { id: string; answers: string[] };
export type Level = {
  id: string; title: string; kind: 'search' | 'logic' | 'solyanka' | 'transit' | 'pause';
  task: string; answerFormat: string | null; autoPassSeconds: number | null;
  requiredSectors: number | null; playersStarted: boolean | null;
  helps: Help[]; sectors: Sector[];
};
export type GameDraft = {
  schemaVersion: 1; gameId: string; domain: string;
  phase: 'draft' | 'live' | 'finished'; format: 'field' | 'virtual' | 'mixed';
  title: string; levels: Level[];
};
export type Finding = {
  ruleId: string; severity: 'error' | 'warning'; levelId: string;
  path: string; message: string; evidence: unknown;
};
export type PhotoObservation = {
  id: string; image: string; gameId: string; domain: string;
  levelId: string; sectorId: string;
  reading: 'clear' | 'ambiguous' | 'unreadable';
  transcription: string | null; alternatives: string[];
  mappingVerified: boolean; currentMarkingVerified: boolean;
  documentCode: string | null;
};
export class InputError extends Error {
  constructor(message: string) { super(message); this.name = 'InputError'; }
}
function fail(path: string, message: string): never { throw new InputError(`${path}: ${message}`); }
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected object');
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[], path: string) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, 'unknown field');
}
function string(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) fail(path, 'expected string');
  return value;
}
function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected array');
  return value;
}
function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(path, 'expected nonnegative safe integer');
  return value;
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'expected boolean');
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  if (!choices.includes(value as T)) fail(path, `expected ${choices.join(' | ')}`);
  return value as T;
}
function unique(ids: string[], path: string) {
  if (new Set(ids).size !== ids.length) fail(path, 'duplicate ID');
}
export function parseGame(value: unknown): GameDraft {
  const root = object(value, 'game');
  exact(root, ['schemaVersion', 'gameId', 'domain', 'phase', 'format', 'title', 'levels'], 'game');
  if (root.schemaVersion !== 1) fail('schemaVersion', 'expected 1');
  const levels = list(root.levels, 'levels').map((item, i): Level => {
    const p = `levels[${i}]`, l = object(item, p);
    exact(l, ['id', 'title', 'kind', 'task', 'answerFormat', 'autoPassSeconds', 'requiredSectors', 'playersStarted', 'helps', 'sectors'], p);
    const helps = list(l.helps, `${p}.helps`).map((v, j): Help => {
      const hp = `${p}.helps[${j}]`, h = object(v, hp);
      exact(h, ['id', 'text', 'afterSeconds'], hp);
      return { id: string(h.id, `${hp}.id`), text: string(h.text, `${hp}.text`, true), afterSeconds: integer(h.afterSeconds, `${hp}.afterSeconds`) };
    });
    const sectors = list(l.sectors, `${p}.sectors`).map((v, j): Sector => {
      const sp = `${p}.sectors[${j}]`, s = object(v, sp);
      exact(s, ['id', 'answers'], sp);
      return { id: string(s.id, `${sp}.id`), answers: list(s.answers, `${sp}.answers`).map((a, k) => string(a, `${sp}.answers[${k}]`)) };
    });
    unique(helps.map(h => h.id), `${p}.helps`); unique(sectors.map(s => s.id), `${p}.sectors`);
    return {
      id: string(l.id, `${p}.id`), title: string(l.title, `${p}.title`, true),
      kind: choice(l.kind, ['search', 'logic', 'solyanka', 'transit', 'pause'], `${p}.kind`),
      task: string(l.task, `${p}.task`, true), answerFormat: l.answerFormat === null ? null : string(l.answerFormat, `${p}.answerFormat`, true),
      autoPassSeconds: l.autoPassSeconds === null ? null : integer(l.autoPassSeconds, `${p}.autoPassSeconds`),
      requiredSectors: l.requiredSectors === null ? null : integer(l.requiredSectors, `${p}.requiredSectors`),
      playersStarted: l.playersStarted === null ? null : boolean(l.playersStarted, `${p}.playersStarted`),
      helps, sectors,
    };
  });
  unique(levels.map(l => l.id), 'levels');
  return {
    schemaVersion: 1, gameId: string(root.gameId, 'gameId'), domain: string(root.domain, 'domain'),
    phase: choice(root.phase, ['draft', 'live', 'finished'], 'phase'),
    format: choice(root.format, ['field', 'virtual', 'mixed'], 'format'), title: string(root.title, 'title', true), levels,
  };
}
export function auditGame(input: unknown) {
  const game = parseGame(input), findings: Finding[] = [];
  for (const l of game.levels) {
    const add = (ruleId: string, severity: Finding['severity'], path: string, message: string, evidence: unknown) =>
      findings.push({ ruleId, severity, levelId: l.id, path, message, evidence });
    if (!l.task.trim()) add('AUTO-TEXT-EMPTY', 'error', 'task', 'Пустой текст задания; проверьте, не пропущен ли блок при импорте.', l.task);
    if (['logic', 'solyanka'].includes(l.kind) && !l.answerFormat?.trim())
      add('LOGIC-01', 'warning', 'answerFormat', 'Формат ответа не выделен в черновике. Проверьте его наличие в тексте.', l.answerFormat);
    for (const h of l.helps) if (l.autoPassSeconds !== null && h.afterSeconds >= l.autoPassSeconds)
      add('AUTO-TIMING-HELP', 'warning', `helps/${h.id}`, 'Подсказка появляется одновременно с автопереходом или позже. Проверьте достижимость.', { afterSeconds: h.afterSeconds, autoPassSeconds: l.autoPassSeconds });
    const required = l.requiredSectors ?? l.sectors.length;
    if (required > l.sectors.length) add('AUTO-SECTORS-COUNT', 'error', 'requiredSectors', 'Для прохождения требуется больше секторов, чем существует.', { required, available: l.sectors.length });
    const answerable = l.sectors.filter(s => s.answers.length > 0).length;
    if (required > answerable) add('AUTO-SECTORS-ANSWERS', 'warning', 'sectors', 'Недостаточно секторов с ответами. Подтвердите, закрывает ли остальные специальная механика.', { required, answerable });
    for (const s of l.sectors) if (new Set(s.answers).size !== s.answers.length)
      add('AUTO-ANSWER-DUPLICATE', 'warning', `sectors/${s.id}`, 'Точный дубль ответа внутри сектора.', s.answers);
  }
  return { schemaVersion: 1, gameId: game.gameId, findings,
    coverage: { automatedOnly: true, notChecked: ['литературная вычитка', 'факты и дуали', 'проходимость локаций', 'качество фото', 'браузер и WebView', 'полный авторский чеклист'] } };
}
export function parseObservations(input: unknown): PhotoObservation[] {
  const result = list(input, 'observations').map((item, i): PhotoObservation => {
    const p = `observations[${i}]`, v = object(item, p);
    exact(v, ['id', 'image', 'gameId', 'domain', 'levelId', 'sectorId', 'reading', 'transcription', 'alternatives', 'mappingVerified', 'currentMarkingVerified', 'documentCode'], p);
    const observation: PhotoObservation = {
      id: string(v.id, `${p}.id`), image: string(v.image, `${p}.image`),
      gameId: string(v.gameId, `${p}.gameId`), domain: string(v.domain, `${p}.domain`),
      levelId: string(v.levelId, `${p}.levelId`), sectorId: string(v.sectorId, `${p}.sectorId`),
      reading: choice(v.reading, ['clear', 'ambiguous', 'unreadable'], `${p}.reading`),
      transcription: v.transcription === null ? null : string(v.transcription, `${p}.transcription`),
      alternatives: list(v.alternatives, `${p}.alternatives`).map((a, k) => string(a, `${p}.alternatives[${k}]`)),
      mappingVerified: boolean(v.mappingVerified, `${p}.mappingVerified`),
      currentMarkingVerified: boolean(v.currentMarkingVerified, `${p}.currentMarkingVerified`),
      documentCode: v.documentCode === null ? null : string(v.documentCode, `${p}.documentCode`),
    };
    if (observation.reading === 'clear' && (!observation.transcription || observation.alternatives.length))
      fail(p, 'clear reading requires a transcription and no alternatives');
    return observation;
  });
  unique(result.map(o => o.id), 'observations');
  return result;
}
export function comparePhotoCodes(input: unknown, rawObservations: unknown) {
  const game = parseGame(input), observations = parseObservations(rawObservations);
  return observations.map(o => {
    const level = game.levels.find(l => l.id === o.levelId), sector = level?.sectors.find(s => s.id === o.sectorId);
    let status: 'unresolved' | 'match' | 'mismatch' = 'unresolved';
    let reason = 'Требуется читаемое актуальное фото и подтверждённая привязка.';
    if (o.domain !== game.domain || o.gameId !== game.gameId) reason = 'Другое игровое пространство или игра.';
    else if (!sector) reason = 'Уровень или сектор отсутствует в снимке.';
    else if (o.mappingVerified && o.currentMarkingVerified && o.reading === 'clear') {
      status = sector.answers.includes(o.transcription!) ? 'match' : 'mismatch';
      reason = status === 'match' ? 'Буквальное совпадение с одним из ответов.' : 'Буквального совпадения нет; правила нормализации движка здесь не применяются.';
    }
    return { observationId: o.id, image: o.image, levelId: o.levelId, sectorId: o.sectorId,
      photographed: o.transcription, document: o.documentCode, engine: sector?.answers ?? null,
      status, reason, suggestedAction: status !== 'mismatch' ? 'none' :
        game.phase === 'draft' && level?.playersStarted === false ? 'review-replacement-or-addition' : 'review-additional-variant-preserve-existing',
      suggestedVariants: status === 'unresolved' ? [] : suggestCodeVariants(o.transcription!).variants.filter(v => !sector!.answers.includes(v.code)),
      autoApply: false };
  });
}
/** Heuristics for a human/vision reviewer. Never a normalizer or write operation. */
export function suggestCodeVariants(input: unknown) {
  const code = string(input, 'code');
  if ([...code].length > 128) fail('code', 'maximum 128 Unicode code points');
  const substitutions: Record<string, string[]> = {
    'ь': ['6'], 'Ь': ['6'], 'з': ['3'], 'З': ['3'],
    'о': ['0'], 'О': ['0', 'O'], 'O': ['0', 'О'], 'o': ['0'],
    'I': ['1', 'l'], 'l': ['1', 'I'], 'S': ['5'], 's': ['5'],
    'g': ['9'], 'W': ['VV'], 'w': ['vv'],
  };
  const chars = [...code], seen = new Set([code]);
  const variants: Array<{ code: string; position: number; from: string; to: string; reason: string }> = [];
  for (let i = 0; i < chars.length; i++) for (const replacement of substitutions[chars[i]] ?? []) {
    const changed = [...chars]; changed[i] = replacement; const candidate = changed.join('');
    if (!seen.has(candidate)) {
      seen.add(candidate); variants.push({ code: candidate, position: i + 1, from: chars[i], to: replacement, reason: 'Возможное визуальное чтение; подтвердите по фотографии.' });
    }
  }
  return { original: code, variants: variants.slice(0, 16), truncated: variants.length > 16,
    policy: 'review-additional-variant-preserve-original', automaticAcceptance: false,
    limitation: 'Односимвольные гипотезы, не OCR. Смешение алфавитов и изменение механики требуют отдельной проверки.' };
}
export type TextEdit = { levelId: string; field: 'task' | 'answerFormat'; before: string | null; after: string; reason: string };
export type ChangeSet = { schemaVersion: 1; mode: 'local-draft'; gameId: string; domain: string; edits: TextEdit[] };
export function parseChangeSet(input: unknown): ChangeSet {
  const v = object(input, 'plan'); exact(v, ['schemaVersion', 'mode', 'gameId', 'domain', 'edits'], 'plan');
  if (v.schemaVersion !== 1 || v.mode !== 'local-draft') fail('plan', 'expected schemaVersion 1, mode local-draft');
  const edits = list(v.edits, 'edits').map((item, i): TextEdit => {
    const p = `edits[${i}]`, e = object(item, p); exact(e, ['levelId', 'field', 'before', 'after', 'reason'], p);
    const field = choice(e.field, ['task', 'answerFormat'], `${p}.field`);
    if (e.before === null && field === 'task') fail(`${p}.before`, 'task cannot be null');
    return { levelId: string(e.levelId, `${p}.levelId`), field, before: e.before === null ? null : string(e.before, `${p}.before`, true),
      after: string(e.after, `${p}.after`), reason: string(e.reason, `${p}.reason`) };
  });
  unique(edits.map(e => JSON.stringify([e.levelId, e.field])), 'edits');
  return { schemaVersion: 1, mode: 'local-draft', gameId: string(v.gameId, 'gameId'), domain: string(v.domain, 'domain'), edits };
}
/** Atomic only in memory: validates every edit before returning a new local draft. */
export function applyLocalChanges(input: unknown, rawPlan: unknown) {
  const game = parseGame(input), plan = parseChangeSet(rawPlan);
  if (game.phase !== 'draft') fail('phase', 'local changes support draft games only');
  if (game.gameId !== plan.gameId || game.domain !== plan.domain) fail('plan', 'game/domain mismatch');
  for (const e of plan.edits) {
    const l = game.levels.find(l => l.id === e.levelId);
    if (!l) fail(e.levelId, 'level not found');
    if (l.playersStarted !== false) fail(e.levelId, 'playersStarted must be explicitly false');
    if (l[e.field] !== e.before) fail(e.levelId, 'stale before value; re-read and rebuild the plan');
  }
  const output = structuredClone(game);
  for (const e of plan.edits) output.levels.find(l => l.id === e.levelId)![e.field] = e.after;
  return { game: output, applied: plan.edits.length };
}
