import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { EncounterClient } from '../../src/encounter.js';
import { readRecalculationEvidence, requireData, type RecalculationEvidence } from '../../src/recalculation-evidence.js';
import { calculateRecalculation, type RecalculationResult } from '../../src/recalculation.js';
import { createCorrectionPlan } from '../../src/correction-plan.js';
import { FileCorrectionHost } from '../../src/recalculation-store.js';
import { executeCorrectionPlan, verifyCorrectionPlan, verifyCorrectionStatistics, renderCorrectionOutcome } from '../../src/correction-executor.js';
import { loadProfile, resolveDataDir } from './config.js';
import { OsCredentialStore } from './credential-store.js';
import { safeError } from './redaction.js';
import {resolveEngineProfile} from '../../src/engine-profile.ts';
import {runtimeAuthoringPort} from './authoring-client.js';

interface Stored { profile: string; evidence: RecalculationEvidence; calculation?: RecalculationResult }
export class RecalculationService {
  constructor(readonly profile: string, readonly directory: string, readonly client: EncounterClient) {}
  #path(ref: string) { requireData(/^[a-f0-9-]{36}$/.test(ref), 'Invalid evidence reference'); return join(this.directory, ref + '.json'); }
  async #put(value: Stored) { await mkdir(this.directory, { recursive: true }); const ref = crypto.randomUUID(); await writeFile(this.#path(ref), JSON.stringify(value), { flag: 'wx', mode: 0o600 }); return ref; }
  async #get(ref: string) { const value = JSON.parse(await readFile(this.#path(ref), 'utf8')) as Stored;
    requireData(value.profile === this.profile && value.evidence.scope.domain === this.client.domain && value.evidence.sessionKey === await this.client.identity(), 'Reference belongs to another scope/session'); return value; }
  async read(gameId: number, levelId: number) {
    const evidence = await readRecalculationEvidence(this.client, this.client.domain, String(gameId), String(levelId));
    const evidenceRef = await this.#put({ profile: this.profile, evidence });
    return { evidenceRef, scope: evidence.scope, complete: evidence.complete, finished: evidence.finished, participants: evidence.participants, eventCount: evidence.events.length,
      note: 'Inspect paginated raw events/times. Ask the reason if missing. Destroyed-code recalculation requires the author to choose a policy.' };
  }
  async inspect(ref: string, collection: 'events' | 'times' | 'participants' | 'rows', offset = 0) {
    const value = await this.#get(ref), rows = collection === 'rows' ? value.calculation?.rows ?? [] : value.evidence[collection];
    return { offset, total: rows.length, items: rows.slice(offset, offset + 25) };
  }
  async calculate(ref: string, rule: unknown) {
    const value = await this.#get(ref), input = structuredClone(rule) as Record<string, unknown>;
    const known = await new FileCorrectionHost(this.directory).incidentCorrectionIds(String(input.id), value.evidence.scope, value.evidence.sessionKey);
    const prior = input.existingCorrectionIds; requireData(prior === undefined || Array.isArray(prior), 'Invalid prior correction IDs');
    input.existingCorrectionIds = [...new Set([...(prior as number[] ?? []), ...known])];
    const calculation = calculateRecalculation(value.evidence, input);
    const calculationRef = await this.#put({ ...value, calculation });
    return { calculationRef, status: calculation.status, questions: calculation.questions, summary: calculation.summary,
      formula: calculation.formula, totalRows: calculation.rows.length, rows: calculation.rows.slice(0, 25), dismiss: calculation.dismiss };
  }
  async propose(ref: string) {
    const value = await this.#get(ref); requireData(value.calculation, 'Calculation reference required');
    const plan = await createCorrectionPlan(value.evidence, value.calculation.rule), host = new FileCorrectionHost(this.directory);
    await host.putPlan(plan);
    return { planRef: plan.id, scope: plan.scope, totalRows: plan.calculation.rows.length, operations: plan.operations.length,
      table: plan.table.length <= 26000 ? plan.table : undefined,
      planFile: join(this.directory, `${plan.id}.plan.json`), tablePages: 'Use encounter_inspect_recalculation_evidence on calculationRef with collection=rows for every row.',
      approval: 'The human must confirm the complete table. The host can then run en-recalculate approve with this planFile, --confirmed-table planRef and --store directory. No model tool can approve it.',
      store: this.directory, applied: false };
  }
  async apply(ref: string, verifyOnly = false) {
    const host = new FileCorrectionHost(this.directory), plan = await host.getPlan(ref);
    requireData(plan.scope.domain === this.client.domain && plan.sessionKey === await this.client.identity(), 'Plan belongs to another scope/session');
    if (!verifyOnly) requireData(process.env.ENCOUNTER_WRITES_DISABLED !== '1', 'Encounter writes disabled');
    const prior = await host.load(ref); if (verifyOnly) requireData(prior, 'No correction attempts to verify');
    const journal = verifyOnly ? await verifyCorrectionPlan(this.client, plan, prior!) : await executeCorrectionPlan(this.client, plan, host);
    if (verifyOnly) await host.save(journal);
    return { journal, report: renderCorrectionOutcome(plan, journal), statistics: await verifyCorrectionStatistics(this.client, plan) };
  }
}
export function registerRecalculationTools(server: McpServer) {
  const profile = z.string().optional(), id = z.number().int().positive(), ref = z.string();
  const service = async (name?: string,scope?:{gameId?:number;ref?:string}) => {
    const selected = await loadProfile(name, resolveDataDir()), credentials = new OsCredentialStore();
    const directory=join(resolveDataDir(),'recalculation',selected.name);
    if(resolveEngineProfile(selected.domain).engine==='legacy'){
      let gameId=scope?.gameId;
      if(gameId===undefined&&scope?.ref){const ref=scope.ref;requireData(/^(?:[a-f0-9-]{36}|[a-f0-9]{64})$/.test(ref),'Invalid evidence/plan reference');
        const stored=JSON.parse(await readFile(join(directory,ref+(ref.length===64?'.plan.json':'.json')),'utf8')) as {profile?:string;evidence?:RecalculationEvidence;scope?:{domain:string;gameId:string}};
        const target=stored.evidence?.scope??stored.scope;requireData(target?.domain===selected.domain&&(stored.profile===undefined||stored.profile===selected.name),'Reference belongs to another profile');gameId=Number(target.gameId);
      }
      requireData(Number.isSafeInteger(gameId)&&Number(gameId)>0,'Legacy recalculation requires a scoped game');
      return new RecalculationService(selected.name,directory,new EncounterClient({domain:selected.domain,api:await runtimeAuthoringPort(selected,credentials,gameId!)}));
    }
    requireData(selected.apiBaseUrl === 'https://api.en.cx', 'Recalculation SDK requires the central Encounter API origin');
    return new RecalculationService(selected.name, join(resolveDataDir(), 'recalculation', selected.name), new EncounterClient({ domain: selected.domain,
      token: async () => { const token = await credentials.get(selected.name); requireData(token, 'Author authentication required'); return token; } }));
  };
  const run = async (name: string | undefined, action: (value: RecalculationService) => Promise<unknown>,scope?:{gameId?:number;ref?:string}) => {
    try { const result = await action(await service(name,scope)); return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: safeError(error) }) }] }; }
  };
  server.registerTool('encounter_read_recalculation_evidence', { description: 'Read complete monitoring, statistics, accepted roster, editor and corrections through the selected engine. Read-only; incomplete native coverage fails closed; returns a session-bound evidenceRef.', inputSchema: { profile, gameId: id, levelId: id } }, ({ profile, gameId, levelId }) => run(profile, s => s.read(gameId, levelId),{gameId}));
  server.registerTool('encounter_inspect_recalculation_evidence', { description: 'Read every page of events, times, participants or calculated rows; offset advances by 25. No writes.', inputSchema: { profile, ref, collection: z.enum(['events', 'times', 'participants', 'rows']), offset: z.number().int().nonnegative().default(0) } }, ({ profile, ref, collection, offset }) => run(profile, s => s.inspect(ref, collection, offset),{ref}));
  server.registerTool('encounter_calculate_recalculation', { description: 'Execute deterministic calculation from evidenceRef and explicit author rules; never calculate in prose. Rule type: wrong-answer, destroyed-code, bonus, cancelled-level. Destroyed-code requires choice reduce-required-by-one or keep-results. Cancelled-level reports passed/participants and asks the author. See game-recalculation skill.', inputSchema: { profile, evidenceRef: ref, rule: z.record(z.string(), z.unknown()) } }, ({ profile, evidenceRef, rule }) => run(profile, s => s.calculate(evidenceRef, rule),{ref:evidenceRef}));
  server.registerTool('encounter_propose_corrections', { description: 'Prepare an immutable table/plan from calculationRef. Show ALL rows to the human and offer to apply. This tool does not approve or write.', inputSchema: { profile, calculationRef: ref } }, ({ profile, calculationRef }) => run(profile, s => s.propose(calculationRef),{ref:calculationRef}));
  server.registerTool('encounter_apply_corrections', { description: 'Apply a stored plan ONLY after the host has recorded human confirmation of that exact table. No confirmed boolean or approval-writing tool exists. Stops after unknown outcome; never retries POST.', inputSchema: { profile, planRef: z.string().regex(/^[a-f0-9]{64}$/) } }, ({ profile, planRef }) => run(profile, s => s.apply(planRef),{ref:planRef}));
  server.registerTool('encounter_verify_corrections', { description: 'Read-only reconciliation of each correction ID/comment/recipient/value. Never resends an uncertain write.', inputSchema: { profile, planRef: z.string().regex(/^[a-f0-9]{64}$/) } }, ({ profile, planRef }) => run(profile, s => s.apply(planRef, true),{ref:planRef}));
}
