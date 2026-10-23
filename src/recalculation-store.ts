import { mkdir, readFile, writeFile, rename, open, unlink, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { digest, requireData } from './recalculation-evidence.ts';
import { validateCorrectionPlan, type CorrectionPlan } from './correction-plan.ts';
import type { CorrectionHost, CorrectionJournal } from './correction-executor.ts';

/** Files are private host state. The MCP server exposes no approval-writing tool. */
export class FileCorrectionHost implements CorrectionHost {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  #path(id: string, suffix: string) { requireData(/^[a-f0-9]{64}$/.test(id), 'Invalid stored plan ID'); return join(this.root, `${id}.${suffix}.json`); }
  async #read(id: string, suffix: string): Promise<unknown | null> {
    try { return JSON.parse(await readFile(this.#path(id, suffix), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async #save(id: string, suffix: string, value: unknown) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const target = this.#path(id, suffix), temporary = target + '.' + crypto.randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
  }
  async putPlan(plan: CorrectionPlan) { await validateCorrectionPlan(plan); await this.#save(plan.id, 'plan', plan); }
  async getPlan(id: string): Promise<CorrectionPlan> {
    const plan = await this.#read(id, 'plan') as CorrectionPlan; await validateCorrectionPlan(plan); return plan;
  }
  async approve(plan: CorrectionPlan, confirmedTableHash: string) {
    await validateCorrectionPlan(plan); requireData(confirmedTableHash === plan.id, 'Confirmation must name the exact table hash');
    await this.#noUnknown(plan);
    const knownIds = await this.incidentCorrectionIds(plan.rule.id, plan.scope, plan.sessionKey);
    requireData(knownIds.every(id => plan.rule.existingCorrectionIds?.includes(id)), 'Recalculate with this store: previously verified corrections must be included in the table');
    await this.putPlan(plan);
    await this.#save(plan.id, 'approval', { planId: plan.id, sessionKey: plan.sessionKey });
  }
  async approved(id: string) {
    const approval = await this.#read(id, 'approval') as { planId?: string; sessionKey?: string } | null;
    if (!approval || approval.planId !== id) return false;
    const plan = await this.getPlan(id); await this.#noUnknown(plan); return approval.sessionKey === plan.sessionKey;
  }
  async #noUnknown(plan: CorrectionPlan) {
    let names: string[]; try { names = await readdir(this.root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const name of names) {
      const match = /^([a-f0-9]{64})\.journal\.json$/.exec(name); if (!match || match[1] === plan.id) continue;
      const journal = await this.load(match[1]);
      if (!journal?.entries.some(entry => entry.state === 'unknown')) continue;
      const prior = await this.getPlan(match[1]);
      requireData(prior.scope.domain !== plan.scope.domain || prior.scope.gameId !== plan.scope.gameId || prior.scope.levelId !== plan.scope.levelId, 'Reconcile previous unknown correction on this level before confirming a new table');
    }
  }
  async load(id: string) { return await this.#read(id, 'journal') as CorrectionJournal | null; }
  async save(journal: CorrectionJournal) { await this.#save(journal.planId, 'journal', structuredClone(journal)); }
  async incidentCorrectionIds(incidentId: string, scope: CorrectionPlan['scope'], sessionKey: string): Promise<number[]> {
    let names: string[]; try { names = await readdir(this.root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const ids = new Set<number>();
    for (const name of names) {
      const match = /^([a-f0-9]{64})\.journal\.json$/.exec(name); if (!match) continue;
      const plan = await this.getPlan(match[1]);
      if (plan.rule.id !== incidentId || plan.sessionKey !== sessionKey || plan.scope.domain !== scope.domain || plan.scope.gameId !== scope.gameId || plan.scope.levelId !== scope.levelId) continue;
      const journal = await this.load(match[1]);
      requireData(!journal?.entries.some(entry => entry.state === 'unknown'), 'Verify previous unknown correction before calculating this incident');
      for (const entry of journal?.entries ?? []) if (entry.state === 'verified' && entry.correctId) ids.add(entry.correctId);
    }
    return [...ids];
  }
  async withLock<T>(scope: string, action: () => Promise<T>): Promise<T> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const path = join(this.root, `${await digest(scope)}.lock`);
    const handle = await open(path, 'wx', 0o600).catch(() => { throw new Error('Another correction run holds this level lock; reconcile an abandoned lock before retrying'); });
    try { return await action(); } finally { await handle.close(); await unlink(path); }
  }
}
