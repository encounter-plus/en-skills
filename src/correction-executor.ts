import { RemoteError } from './http.ts';
import type { EncounterClient } from './encounter.ts';
import { evidenceFingerprint, readRecalculationEvidence, record, requireData } from './recalculation-evidence.ts';
import { validateCorrectionPlan, type CorrectionOperation, type CorrectionPlan } from './correction-plan.ts';
import { calculateRecalculation } from './recalculation.ts';
import { canonical } from './recalculation-evidence.ts';
import {resolveEngineProfile} from './engine-profile.ts';
import type {LegacyStatistics} from './legacy-statistics.ts';

const legacy=(client:EncounterClient)=>resolveEngineProfile(client.domain).engine==='legacy';
type NativeContext=Awaited<ReturnType<LegacyStatistics['read']>>;
function nativeCorrection(row:Record<string,unknown>,context:NativeContext):Record<string,unknown>{
  const recipient=context.roster.find(p=>row[context.statistics.mode==='team'?'team_id':'user_id']===p.id);
  return {...row,level_id:row.level_num===null?null:context.statistics.levels.find(level=>level.levelNumber===row.level_num)?.levelId,game_player_id:recipient?.gamePlayerId??null};
}
async function correctionRead(client:EncounterClient,plan:CorrectionPlan,id:number){
  const row=await client.correction(plan.scope.gameId,id);if(!legacy(client))return row;
  const context=await client.legacyRecalculationContext(plan.scope.gameId) as unknown as NativeContext;
  return nativeCorrection(row,context);
}

export interface CorrectionJournal {
  schemaVersion: 1; planId: string; entries: { state: 'pending' | 'verified' | 'rejected' | 'unknown'; correctId?: number }[];
  stoppedReason?: string;
}
/** Approval belongs to a human-facing host. It is never an argument supplied by a model tool. */
export interface CorrectionHost {
  approved(planHash: string): Promise<boolean>;
  withLock<T>(scope: string, action: () => Promise<T>): Promise<T>;
  load(planHash: string): Promise<CorrectionJournal | null>;
  save(journal: CorrectionJournal): Promise<void>;
}
function matches(row: Record<string, unknown>, plan: CorrectionPlan, op: CorrectionOperation, correctId: number) {
  return row.correct_id === correctId && row.game_id === Number(plan.scope.gameId) && row.level_id === Number(plan.scope.levelId)
    && row.game_player_id === op.gamePlayerId && row[op.key.startsWith('team:') ? 'team_id' : 'user_id'] === op.playerId
    && row.correction_value === (op.isBonus ? op.seconds : -op.seconds) && row.comment === op.comment;
}
export async function executeCorrectionPlan(client: EncounterClient, input: CorrectionPlan, host: CorrectionHost): Promise<CorrectionJournal> {
  // Snapshot before the first await so the reviewed input cannot change in flight.
  const plan = structuredClone(input); await validateCorrectionPlan(plan);
  return host.withLock(`${plan.scope.domain}:${plan.scope.gameId}:${plan.scope.levelId}`, async () => {
    requireData(await host.approved(plan.id), 'Human confirmation of this exact table is required');
    requireData(await client.identity() === plan.sessionKey, 'Approval belongs to another session');
    const prior = await host.load(plan.id);
    if (prior) {
      requireData(prior.planId === plan.id && prior.entries.length === plan.operations.length, 'Journal mismatch');
      return prior; // Persisted attempts are reconciled separately, never resent.
    }
    const fresh = await readRecalculationEvidence(client, plan.scope.domain, plan.scope.gameId, plan.scope.levelId);
    requireData(await evidenceFingerprint(fresh) === plan.evidenceHash, 'Source data changed; recalculate and confirm a new table');
    requireData(canonical(calculateRecalculation(fresh, plan.rule)) === canonical(plan.calculation), 'Table differs from the deterministic calculation');
    requireData(fresh.finished && fresh.canWrite, 'Game completion or author permissions changed');
    const journal: CorrectionJournal = { schemaVersion: 1, planId: plan.id, entries: plan.operations.map(() => ({ state: 'pending' })) };
    await host.save(journal);
    for (let index = 0; index < plan.operations.length; index++) {
      const op = plan.operations[index], entry = journal.entries[index];
      let correctionVersion:string|undefined;
      let managerVersion:string|undefined;
      requireData(await host.approved(plan.id), 'Approval revoked');
      requireData(await client.identity() === plan.sessionKey, 'Session changed');
      try {
        const observed=legacy(client)?await readRecalculationEvidence(client,plan.scope.domain,plan.scope.gameId,plan.scope.levelId):undefined;
        const current = observed?.raw.corrections??await client.corrections(plan.scope.gameId);
        correctionVersion=typeof current.version==='string'?current.version:undefined;
        const own = new Set(journal.entries.flatMap(entry => entry.correctId ? [entry.correctId] : []));
        requireData(Array.isArray(current.items) && (observed?observed.canWrite:current.can_add === true && current.is_admin === true && current.use_score_value === false), 'Correction permission changed');
        const normalized = (items: unknown[]) => items.map(record).filter(row => !own.has(Number(row.correct_id))).sort((a, b) => Number(a.correct_id) - Number(b.correct_id));
        requireData(canonical(normalized(current.items)) === canonical(normalized(fresh.raw.corrections.items as unknown[])), 'Corrections changed during application');
        const level = observed?.raw.editor??(await client.level(plan.scope.gameId, plan.scope.levelId)).data;
        if(observed)managerVersion=String(record(level._legacy_manager).version);
        requireData(level.version === fresh.levelVersion && record(level.level).dismissed === record(fresh.raw.editor.level).dismissed, 'Level changed during application');
      } catch {
        journal.stoppedReason = 'Source data or permissions changed during application; confirm a freshly calculated table for pending rows';
        await host.save(journal); break;
      }
      // Persist an uncertain attempt before dispatch; a crash cannot make it look unsent.
      entry.state = 'unknown'; await host.save(journal);
      if (!await host.approved(plan.id)) { entry.state = 'pending'; journal.stoppedReason = 'Approval revoked before dispatch'; await host.save(journal); break; }
      let acknowledged = false;
      try {
        if (op.kind === 'dismiss') {
          if(legacy(client))await client.legacyDismissLevel(plan.scope.gameId,plan.scope.levelId,String(managerVersion));else await client.dismissLevel(plan.scope.gameId, plan.scope.levelId);
          acknowledged = true;
          if(legacy(client)){const context=await client.legacyRecalculationContext(plan.scope.gameId) as unknown as Awaited<ReturnType<LegacyStatistics['read']>>;if(context.statistics.levels.find(level=>level.levelId===Number(plan.scope.levelId))?.dismissed===true)entry.state='verified';}
          else{const after = (await client.level(plan.scope.gameId, plan.scope.levelId)).data;if (record(after.level).dismissed === true) entry.state = 'verified';}
        } else {
          const fields={ gamePlayerId: op.gamePlayerId, playerId: op.playerId,levelId: Number(plan.scope.levelId), seconds: op.seconds, isBonus: op.isBonus, comment: op.comment };
          const created = legacy(client)?await client.legacyCreateCorrection(plan.scope.gameId,fields,String(correctionVersion)):await client.createCorrection(plan.scope.gameId,fields);
          acknowledged = true;
          // The schema exposes an integer map, not a named ID. Accept only one unambiguous value,
          // then verify its identity, scope, recipient, sign, amount and comment with GET.
          const values = legacy(client)?[created.correct_id]:Object.values(created);
          if (values.length === 1 && Number.isSafeInteger(values[0]) && Number(values[0]) > 0) {
            entry.correctId = Number(values[0]);
            // Persist ID even if read-back fails.
            await host.save(journal);
            const after = await correctionRead(client,plan,entry.correctId);
            if (matches(after, plan, op, entry.correctId)) entry.state = 'verified';
          }
        }
      } catch (error) {
        // A failure in read-back cannot change an acknowledged/uncertain POST into a rejection.
        if (!acknowledged && error instanceof RemoteError && [400, 401, 403, 404, 409, 422].includes(error.status)) entry.state = 'rejected';
      }
      await host.save(journal);
      if (entry.state !== 'verified') break;
    }
    return journal;
  });
}
/** Read-only reconciliation. Never posts or rolls back; ambiguous matches remain unknown. */
export async function verifyCorrectionPlan(client: EncounterClient, plan: CorrectionPlan, journal: CorrectionJournal): Promise<CorrectionJournal> {
  await validateCorrectionPlan(plan);
  requireData(await client.identity() === plan.sessionKey && journal.planId === plan.id && journal.entries.length === plan.operations.length, 'Session/journal mismatch');
  const result = structuredClone(journal), list = await client.corrections(plan.scope.gameId);
  requireData(Array.isArray(list.items), 'Incomplete correction read-back');
  const nativeContext=legacy(client)?await client.legacyRecalculationContext(plan.scope.gameId) as unknown as NativeContext:undefined;
  for (let i = 0; i < result.entries.length; i++) {
    const entry = result.entries[i], op = plan.operations[i];
    if (entry.state === 'pending' || entry.state === 'rejected') continue;
    entry.state = 'unknown';
    if (op.kind === 'dismiss') {
      if(legacy(client)){const context=await client.legacyRecalculationContext(plan.scope.gameId) as unknown as Awaited<ReturnType<LegacyStatistics['read']>>;if(context.statistics.levels.find(level=>level.levelId===Number(plan.scope.levelId))?.dismissed===true)entry.state='verified';}
      else{const after = (await client.level(plan.scope.gameId, plan.scope.levelId)).data;if (record(after.level).dismissed === true) entry.state = 'verified';}
    } else {
      if (entry.correctId && !plan.correctionIdsBefore.includes(entry.correctId)) {
        const after = await correctionRead(client,plan,entry.correctId);
        if (matches(after, plan, op, entry.correctId)) entry.state = 'verified';
        continue;
      }
      const candidates=[];
      for(const raw of list.items as unknown[]){const row=record(raw),id=Number(row.correct_id);if(plan.correctionIdsBefore.includes(id))continue;const projected=nativeContext?nativeCorrection(row,nativeContext):row;if(matches(projected,plan,op,id))candidates.push(projected);}
      if (candidates.length !== 1) continue;
      const id = Number(candidates[0].correct_id);
      if (Number.isSafeInteger(id) && id > 0) {
        const after = await correctionRead(client,plan,id);
        if (matches(after, plan, op, id)) { entry.correctId = id; entry.state = 'verified'; }
      }
    }
  }
  return result;
}
export function renderCorrectionOutcome(plan: CorrectionPlan, journal: CorrectionJournal): string {
  return plan.operations.map((op, i) => `${op.key}: ${op.kind === 'dismiss' ? 'снятие уровня' : (op.isBonus ? 'бонус ' : 'штраф ') + op.seconds + ' с'}; ${op.comment}; ${journal.entries[i].state}; ID ${journal.entries[i].correctId ?? '—'}`).join('\n')
    + (journal.stoppedReason ? '\n' + journal.stoppedReason : '')
    + '\nСтатус verified подтверждает запись read-back. Для оценки итогов отдельно перечитайте статистику.\n';
}
/** Independent statistics check. A delayed/mismatched total never resends a verified POST. */
export async function verifyCorrectionStatistics(client: EncounterClient, plan: CorrectionPlan) {
  try {
    await validateCorrectionPlan(plan);
    requireData(await client.identity() === plan.sessionKey, 'Session changed');
    if(legacy(client)){
      requireData(plan.legacy,'Legacy final-total baseline unavailable');
      if(plan.operations.some(op=>op.kind==='dismiss'))return {state:'unknown' as const,participants:[],note:'Native dismissal needs independent result semantics; no award was retried'};
      const context=await client.legacyRecalculationContext(plan.scope.gameId) as unknown as Awaited<ReturnType<LegacyStatistics['read']>>;
      const before=record(plan.legacy.finalTotals),totals=before.totals;requireData(Array.isArray(totals),'Missing native baseline totals');
      const ledger=await client.corrections(plan.scope.gameId);requireData(Array.isArray(ledger.items),'Missing current ledger');
      const normalized=ledger.items.map(raw=>nativeCorrection(record(raw),context));
      // Existing awards must remain byte-for-byte equivalent after the same normalization.
      requireData(canonical(normalized.filter(row=>plan.correctionIdsBefore.includes(Number(row.correct_id))))===canonical(plan.legacy.corrections),'Existing native ledger changed');
      const added=normalized.filter(row=>!plan.correctionIdsBefore.includes(Number(row.correct_id)));
      requireData(added.every(row=>plan.operations.some(op=>matches(row,plan,op,Number(row.correct_id)))),'Unrelated native award appeared');
      requireData(added.length===plan.operations.length&&plan.operations.every(op=>added.filter(row=>matches(row,plan,op,Number(row.correct_id))).length===1),'Native planned awards are missing or ambiguous');
      const participants=[...new Set(plan.operations.map(op=>op.key))].map(key=>{
        const original=(totals as unknown[]).map(record).find(row=>row.key===key&&row.kind==='corr'),current=context.final.totals.find(row=>row.key===key&&row.kind==='corr');
        const originalRaw=(totals as unknown[]).map(record).find(row=>row.key===key&&row.kind==='raw'),currentRaw=context.final.totals.find(row=>row.key===key&&row.kind==='raw');
        requireData(original&&current&&originalRaw&&currentRaw&&originalRaw.seconds===currentRaw.seconds,'Native raw totals changed');
        const awards=added.filter(row=>plan.operations.some(op=>op.key===key&&matches(row,plan,op,Number(row.correct_id))));
        const delta=awards.reduce((sum,row)=>sum+Number(row.correction_value),0),expectedSeconds=Number(original.seconds)-delta;
        return {key,expectedSeconds,statisticsSeconds:current.seconds};
      });
      return {state:participants.every(row=>row.expectedSeconds===row.statisticsSeconds)?'verified' as const:'mismatch' as const,participants};
    }
    const totals = new Map<string, number>(); let dismissed: boolean | null = null;
    for (let page = 1, pages = 1; page <= pages; page++) {
      const body = await client.gameStatisticsPage(plan.scope.gameId, page);
      requireData(body.game_id === Number(plan.scope.gameId) && body.current_page === page && body.can_view_stats === true && body.needs_confirm !== true && body.mask_passed !== true && body.mask_more !== true, 'Statistics unavailable');
      const count = Number(body.total_pages); requireData(Number.isSafeInteger(count) && count >= 1 && count <= 1000 && (page === 1 || count === pages), 'Statistics pagination changed'); pages = count;
      if (Array.isArray(body.levels)) for (const raw of body.levels) { const level = record(raw);
        if (level.level_id === Number(plan.scope.levelId) && typeof level.dismissed === 'boolean') dismissed = level.dismissed; }
      requireData(Array.isArray(body.level_corrections), 'Missing statistics corrections');
      const pageTotals = new Map<string, number>();
      for (const raw of body.level_corrections) {
        const row = record(raw); if (row.level_id !== Number(plan.scope.levelId)) continue;
        const key = Number(row.team_id) > 0 ? `team:${row.team_id}` : `user:${row.user_id}`;
        requireData(Number.isSafeInteger(row.correction_value), 'Unknown statistics correction');
        pageTotals.set(key, (pageTotals.get(key) ?? 0) + Number(row.correction_value));
      }
      for (const [key, value] of pageTotals) { requireData(!totals.has(key) || totals.get(key) === value, 'Statistics changed across pages'); totals.set(key, value); }
    }
    if (plan.operations.some(op => op.kind === 'dismiss')) return { state: dismissed === null ? 'unknown' as const : dismissed ? 'verified' as const : 'mismatch' as const, participants: [] };
    const list = await client.corrections(plan.scope.gameId); requireData(Array.isArray(list.items), 'Missing corrections list');
    const keys = [...new Set(plan.operations.filter(op => op.kind === 'correction').map(op => op.key))];
    const participants = keys.map(key => {
      const [kind, id] = key.split(':');
      const listed = (list.items as unknown[]).map(record).filter(row => row.level_id === Number(plan.scope.levelId) && row[kind === 'team' ? 'team_id' : 'user_id'] === Number(id));
      requireData(listed.length > 0 && listed.every(row => Number.isSafeInteger(row.correction_value)), 'Unknown listed award');
      const listedAwardSeconds = listed.reduce((sum, row) => sum + Number(row.correction_value), 0);
      return { key, listedAwardSeconds, statisticsAwardSeconds: totals.get(key) ?? null };
    });
    return { state: participants.every(row => row.listedAwardSeconds === row.statisticsAwardSeconds) ? 'verified' as const : 'mismatch' as const, participants };
  } catch { return { state: 'unknown' as const, participants: [], note: 'Could not verify current statistics; no correction was retried' }; }
}
