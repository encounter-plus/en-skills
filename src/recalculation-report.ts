import type { RecalculationResult } from './recalculation.ts';
const cell = (value: unknown) => String(value ?? '—').replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function renderRecalculationReport(result: RecalculationResult): string {
  const lines = [`Причина: ${cell(result.rule.reason)}`, `Статус: ${result.status}`, `Формула: ${cell(result.formula)}`];
  if (result.summary) {
    const s = result.summary;
    lines.push(`Прошли ${s.passed} из ${s.participants} (${s.percent}%). Среднее: ${s.exactMean} = ${s.meanSeconds ?? 'не определено'} с.`,
      '', '| Донор | Время, с |', '|---|---:|', ...s.donorKeys.map((key, i) => `| ${cell(key)} | ${s.donorSeconds[i]} |`));
  }
  lines.push('', '| Команда | ID участника / команды | База | Исходное, с | Целевое, с | Уже бонусом, с | Бонус, с | Штраф, с | Причина | Опорные вводы | Принятие после фикса | Прохождение: было → предложено | Статус |', '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|---|');
  const events = (rows: NonNullable<RecalculationResult['rows'][number]['inputs']>) => rows.map(event => `${event.answer} @ ${event.at} (${event.ref}, ${event.correct === true ? 'принят' : event.correct === false ? 'не принят' : 'вердикт неизвестен'})`).join('; ');
  for (const r of result.rows) lines.push(`| ${[r.label, `${r.gamePlayerId} / ${r.playerId}`, r.basis, r.beforeSeconds, r.targetSeconds, r.existingIncidentAward, r.bonusSeconds, r.penaltySeconds, r.reason, events(r.inputs ?? []) || r.evidence.join(', '), events(r.acceptedInputs ?? []), `${r.completedAt ?? '—'} → ${r.targetCompletedAt ?? '—'}`, r.state + ': ' + r.note].map(cell).join(' | ')} |`);
  if (result.dismiss) lines.push('', 'Предложено снятие уровня; требуется подтверждение этого действия.');
  if (result.questions.length) lines.push('', ...result.questions.map(q => '- ' + cell(q)));
  return lines.join('\n') + '\n';
}
export function renderRecalculationCsv(result: RecalculationResult): string {
  const quote = (value: unknown) => {
    let text = String(value ?? ''); if (typeof value === 'string' && /^[=+@\-\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows: unknown[][] = [['key', 'team', 'game_player_id', 'player_id', 'basis', 'before_seconds', 'target_seconds', 'existing_incident_award', 'bonus_seconds', 'penalty_seconds', 'reason', 'completed_at', 'target_completed_at', 'evidence', 'state']];
  for (const row of result.rows) rows.push([row.key, row.label, row.gamePlayerId, row.playerId, row.basis, row.beforeSeconds, row.targetSeconds,
    row.existingIncidentAward, row.bonusSeconds, row.penaltySeconds, row.reason, row.completedAt, row.targetCompletedAt, row.evidence.join(';'), row.state]);
  return rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
}
