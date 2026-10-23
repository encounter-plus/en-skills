import { canonical, digest, evidenceFingerprint, requireData, type RecalculationEvidence } from './recalculation-evidence.ts';
import { calculateRecalculation, type RecalculationResult, type RecalculationRule } from './recalculation.ts';
import { renderRecalculationReport } from './recalculation-report.ts';

export interface CorrectionOperation {
  kind: 'correction' | 'dismiss'; key: string; gamePlayerId: number; playerId: number;
  seconds: number; isBonus: boolean; comment: string;
}
export interface CorrectionPlan {
  schemaVersion: 1; id: string; nonce: string; createdAt: string; scope: RecalculationEvidence['scope']; sessionKey: string;
  evidenceHash: string; rule: RecalculationRule; calculation: RecalculationResult; table: string;
  operations: CorrectionOperation[];
  correctionIdsBefore: number[];
  legacy?: {finalTotals:unknown;corrections:unknown[]};
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function operationsFor(calculation: RecalculationResult, nonce: string): CorrectionOperation[] {
  return calculation.dismiss ? [{ kind: 'dismiss', key: 'level', gamePlayerId: 0, playerId: 0, seconds: 0, isBonus: false, comment: calculation.rule.reason }] :
    calculation.rows.filter(row => row.state === 'ready').map((row, index) => ({ kind: 'correction', key: row.key,
      gamePlayerId: row.gamePlayerId, playerId: row.playerId, seconds: row.bonusSeconds || row.penaltySeconds,
      isBonus: row.bonusSeconds > 0, comment: row.reason }));
}
export async function createCorrectionPlan(evidence: RecalculationEvidence, rule: unknown): Promise<CorrectionPlan> {
  requireData(evidence.finished === true, 'Game must be finished before preparing writes');
  requireData(evidence.canWrite === true, 'Author correction permission required');
  const calculation = calculateRecalculation(evidence, rule);
  requireData(calculation.status === 'complete', 'Resolve calculation questions before proposing corrections');
  if (calculation.rows.some(row => row.basis === 'elapsed' && row.state === 'ready'))
    requireData((evidence.raw.editor.level as Record<string, unknown>).dismissed === false, 'Level is dismissed or state unknown; agree on restoring it before time corrections');
  const nonce = crypto.randomUUID();
  const operations = operationsFor(calculation, nonce);
  if (calculation.dismiss) requireData((evidence.raw.editor.level as Record<string, unknown>).dismissed === false, 'Level already dismissed or state unknown');
  const data = { schemaVersion: 1 as const, nonce, createdAt: new Date().toISOString(), scope: evidence.scope, sessionKey: evidence.sessionKey,
    evidenceHash: await evidenceFingerprint(evidence), rule: calculation.rule, calculation, table: renderRecalculationReport(calculation), operations,
    correctionIdsBefore: (evidence.raw.corrections.items as Record<string, unknown>[]).map(row => { requireData(Number.isSafeInteger(row.correct_id) && Number(row.correct_id) > 0, 'Unknown existing correction identity'); return Number(row.correct_id); }),
    ...(evidence.legacy?{legacy:{finalTotals:evidence.legacy.finalTotals,corrections:evidence.raw.corrections.items as unknown[]}}:{}) };
  return freeze(JSON.parse(canonical({ ...data, id: await digest(data) })) as CorrectionPlan);
}
export async function validateCorrectionPlan(plan: CorrectionPlan) {
  requireData(plan?.schemaVersion === 1 && typeof plan.id === 'string' && /^[a-f0-9]{64}$/.test(plan.id), 'Invalid correction plan');
  const { id, ...data } = plan;
  requireData(await digest(data) === id, 'Approved table or payload changed');
  requireData(plan.table === renderRecalculationReport(plan.calculation) && canonical(plan.rule) === canonical(plan.calculation.rule)
    && canonical(plan.operations) === canonical(operationsFor(plan.calculation, plan.nonce)), 'Table and correction payload differ');
}
