import type { EncounterClient as SdkClient } from '@encounter-api/sdk';
import { GamesMonitoringApi, GamesStatisticsApi, GamesPlayersApi, GamesResultsApi } from '@encounter-api/sdk/generated';
import { positiveId, object, RemoteError, type ConnectionOptions } from './http.ts';
import { EncounterTransport } from './encounter-transport.ts';
import {ModernAuthoringAdapter, AuthoringApiError, type AuthoringApiPort} from './authoring-api.ts';

export interface EncounterOptions extends Omit<ConnectionOptions,'token'> { domain: string; token?: ConnectionOptions['token']; api?: AuthoringApiPort }
export interface CorrectionWrite { gamePlayerId: number; playerId: number; levelId: number; seconds: number; isBonus: boolean; comment: string; score?: never }
export interface AdminSnapshot {
  schemaVersion: 1; source: 'encounter-admin'; domain: string; gameId: string;
  levelId: string | null; capturedAt: string; data: Record<string, unknown>;
}
export interface ApplyOperation {
  entity: 'task' | 'help' | 'penalty_help' | 'bonus' | 'sector' | 'answer';
  op: 'create' | 'update' | 'delete'; id?: number; tmp_id?: string; fields?: Record<string, unknown>;
}
export interface LevelPlan {
  domain: string; gameId: string; levelId: string; baseVersion: string; ops: ApplyOperation[];
}
export interface ApplyOutcome {
  state: 'applied' | 'partial' | 'rejected' | 'unknown';
  httpStatus?: number; results?: Record<string, unknown>[]; version?: string;
  warnings?: unknown; snapshot?: AdminSnapshot; readBackError?: true;
  requiresReconciliation: boolean;
}
/** One instance belongs to one tenant and one user session. Replace after logout/token revocation. */
export class EncounterClient {
  #options: EncounterOptions;
  #active = true;
  #epoch = 0;
  #sessionToken: string | undefined;
  constructor(options: EncounterOptions) {
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.en\.cx$/.test(options.domain)) throw new Error('Expected an Encounter tenant hostname');
    if (options.api && options.api.metadata.binding.domain !== options.domain) throw new Error('Authoring port tenant mismatch');
    this.#options = { ...options };
  }
  invalidate() { this.#active = false; this.#epoch++; }
  get domain() { return this.#options.domain; }
  async legacyRecalculationContext(gameId:string,signal?:AbortSignal){return (await this.#call(`/games/${positiveId(gameId)}/recalculation-context`,{signal})).data;}
  async legacyCreateCorrection(gameId:string,body:{playerId:number;levelId:number;seconds:number;isBonus:boolean;comment:string},version:string){
    return (await this.#call(`/games/${positiveId(gameId)}/corrections`,{method:'POST',headers:{'If-Match':version},body:JSON.stringify({player_id:body.playerId,level_id:body.levelId,seconds:body.seconds,is_bonus:body.isBonus,comment:body.comment})})).data;
  }
  async legacyDismissLevel(gameId:string,levelId:string,version:string){await this.#call(`/admin/games/${positiveId(gameId)}/levels/${positiveId(levelId)}/dismiss`,{method:'POST',headers:{'X-Authoring-Expected-Revision':version}});}
  async identity(): Promise<string> {
    if (this.#options.api) { if (!this.#active) throw new Error('Encounter session is inactive'); return JSON.stringify(this.#options.api.metadata.binding); }
    const token = await this.#token();
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(this.#options.domain + ':' + token));
    return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async #token() {
    if (!this.#active) throw new Error('Encounter session is inactive');
    const epoch = this.#epoch, token = await this.#options.token?.();
    if (!this.#active || epoch !== this.#epoch) throw new Error('Encounter session changed');
    if (!token || /[\r\n]/.test(token)) throw new Error('Missing or invalid access token');
    if (this.#sessionToken !== undefined && token !== this.#sessionToken) {
      this.invalidate(); throw new Error('Encounter session changed');
    }
    this.#sessionToken = token;
    return token;
  }
  #sdk(token: string) {
    return new EncounterTransport({ ...this.#options, token: () => token }).sdk;
  }

  async #call(path: string, init?: RequestInit) {
    if (!this.#active) throw new Error('Encounter session is inactive');
    const epoch = this.#epoch;
    // Capture credentials before request; invalidate() fences both delayed tokens and delayed results.
    const port = this.#options.api;
    const token = port ? '' : await this.#token();
    if (!this.#active || epoch !== this.#epoch) throw new Error('Encounter session changed');
    try {
      const gameId = Number(path.match(/^\/(?:admin\/)?games\/([1-9]\d*)(?:\/|$|\?)/)?.[1]);
      const api = port ?? new ModernAuthoringAdapter({...this.#options,token:()=>token,gameId,sessionEpoch:String(epoch)});
      const response = await api.request(path, { ...init,
        headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
      if (!this.#active || epoch !== this.#epoch) throw new Error('Encounter session changed');
      const data = response.status === 204 ? {} : object(await response.json());
      if (!this.#active || epoch !== this.#epoch) throw new Error('Encounter session changed');
      return { status: response.status, data };
    } catch (error) {
      if (error instanceof RemoteError && error.status === 401) this.invalidate();
      throw error;
    }
  }
  async #snapshot(gameId: string, levelId: string | null, suffix: string): Promise<AdminSnapshot> {
    const { data } = await this.#call(`/admin/games/${positiveId(gameId)}${suffix}`);
    return { schemaVersion: 1, source: 'encounter-admin', domain: this.#options.domain, gameId,
      levelId, capturedAt: new Date().toISOString(), data };
  }
  game(gameId: string) { return this.#snapshot(gameId, null, ''); }
  levels(gameId: string) { return this.#snapshot(gameId, null, '/levels'); }
  level(gameId: string, levelId: string) {
    return this.#snapshot(gameId, positiveId(levelId), `/levels/${positiveId(levelId)}/editor`);
  }
  async #generated(build: (sdk: SdkClient) => Promise<{path: string; method: string; query?: Record<string, unknown>; body?: unknown}>, signal?: AbortSignal) {
    // Request-option builders are local SDK codecs only; the selected port owns
    // the actual network request and rejects unsupported legacy endpoints.
    const options = await build(this.#options.api
      ? new EncounterTransport({domain:'demo.en.cx',token:()=> 'request-options-only'}).sdk
      : this.#sdk(await this.#token()));
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) query.set(key, String(value));
    return (await this.#call(options.path + (query.size ? '?' + query : ''), {
      method: options.method, signal, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) })).data;
  }
  monitoringPage(gameId: string, levelId: string, tab: 0 | 1, page: number, signal?: AbortSignal) {
    return this.#generated(sdk => sdk.api(GamesMonitoringApi).getGamesByIdMonitoringRequestOpts({
      id: Number(positiveId(gameId)), levelId: Number(positiveId(levelId)), tab, page, pageSize: 200, typeAnswers: 0, unique: false }), signal);
  }
  statisticsPage(gameId: string, levelNumber: number, page: number, signal?: AbortSignal) {
    positiveId(String(levelNumber));
    return this.#generated(sdk => sdk.api(GamesStatisticsApi).getGamesByIdLevelsByLevelStatisticsRequestOpts({ id: Number(positiveId(gameId)), level: levelNumber, page, pageSize: 200 }), signal);
  }
  gameStatisticsPage(gameId: string, page: number, signal?: AbortSignal) {
    return this.#generated(sdk => sdk.api(GamesStatisticsApi).getGamesByIdStatisticsRequestOpts({ id: Number(positiveId(gameId)), page, pageSize: 200 }), signal);
  }
  playersPage(gameId: string, page: number, signal?: AbortSignal) {
    return this.#generated(sdk => sdk.api(GamesPlayersApi).getGamesByIdPlayersRequestOpts({ id: Number(positiveId(gameId)), page }), signal);
  }
  corrections(gameId: string, signal?: AbortSignal) {
    return this.#generated(sdk => sdk.api(GamesResultsApi).getGamesByIdCorrectionsRequestOpts({ id: Number(positiveId(gameId)) }), signal);
  }
  correction(gameId: string, correctId: number, signal?: AbortSignal) {
    positiveId(String(correctId));
    return this.#generated(sdk => sdk.api(GamesResultsApi).getGamesByIdCorrectionsByCorrectIdRequestOpts({ id: Number(positiveId(gameId)), correctId }), signal);
  }
  createCorrection(gameId: string, body: CorrectionWrite, signal?: AbortSignal) {
    if (!Number.isSafeInteger(body.seconds) || body.seconds! <= 0 || typeof body.isBonus !== 'boolean' || !body.comment?.trim() || body.comment.length > 1000 || body.score !== undefined)
      throw new Error('Invalid time correction');
    for (const value of [body.levelId, body.playerId, body.gamePlayerId]) positiveId(String(value));
    return this.#generated(sdk => sdk.api(GamesResultsApi).postGamesByIdCorrectionsRequestOpts({ id: Number(positiveId(gameId)), body }), signal);
  }
  async dismissLevel(gameId: string, levelId: string) {
    await this.#call(`/admin/games/${positiveId(gameId)}/levels/${positiveId(levelId)}/dismiss`, { method: 'POST' });
  }
  /** Explicit low-level write. fields are server contract fields, never inferred from GameDraft.
   * Caller must persist the reviewed plan before calling, and persist the returned outcome.
   * Never automatically retry this method, including after timeout or partial success.
   */
  async applyLevel(plan: LevelPlan): Promise<ApplyOutcome> {
    if (this.#options.api && !this.#options.api.metadata.capabilities.batch.available) throw new AuthoringApiError('unsupported');
    if (plan.domain !== this.#options.domain) throw new Error('Plan tenant mismatch');
    positiveId(plan.gameId); positiveId(plan.levelId);
    if (typeof plan.baseVersion !== 'string' || !plan.baseVersion || !Array.isArray(plan.ops) ||
        !plan.ops.length || plan.ops.length > 200) throw new Error('Invalid level plan');
    // Freeze the payload before awaiting a network read; host cannot mutate a reviewed plan in flight.
    const payload = JSON.parse(JSON.stringify({ base_version: plan.baseVersion, ops: plan.ops })) as
      { base_version: string; ops: ApplyOperation[] };
    for (const op of payload.ops) {
      if (!['task','help','penalty_help','bonus','sector','answer'].includes(op.entity) ||
          !['create','update','delete'].includes(op.op)) throw new Error('Invalid operation');
      if (op.op !== 'create' && (!Number.isSafeInteger(op.id) || op.id! <= 0)) throw new Error('Operation needs an ID');
      if (op.op !== 'delete') object(op.fields);
    }
    const gameId = plan.gameId, levelId = plan.levelId;
    const before = await this.level(gameId, levelId);
    if (before.data.version !== payload.base_version) return { state: 'rejected', snapshot: before, requiresReconciliation: true };
    if (typeof before.data.players_started !== 'boolean') throw new Error('Unknown players_started');
    if (before.data.players_started && (payload.ops.length !== 1 || payload.ops[0].op !== 'update'))
      return { state: 'rejected', snapshot: before, requiresReconciliation: true };
    let response;
    try {
      response = await this.#call(`/admin/games/${gameId}/levels/${levelId}/apply`,
        { method: 'POST', body: JSON.stringify(payload) });
    } catch (error) {
      // These errors conclusively reject the request; 5xx/transport/malformed responses may follow a write.
      const rejected = error instanceof RemoteError && [400,401,403,404,409].includes(error.status);
      return { state: rejected ? 'rejected' : 'unknown',
        ...(error instanceof RemoteError ? { httpStatus: error.status } : {}), requiresReconciliation: true };
    }
    const { data, status } = response;
    let results: Record<string, unknown>[];
    try {
      if (![200,207].includes(status) || !Array.isArray(data.results) || data.results.length !== payload.ops.length ||
          typeof data.version !== 'string') throw new Error();
      results = data.results.map(object);
      const indexes = new Set();
      for (const result of results) {
        if (!Number.isInteger(result.index) || Number(result.index) < 0 || Number(result.index) >= payload.ops.length ||
            indexes.has(result.index) || !['ok','error'].includes(String(result.status))) throw new Error();
        indexes.add(result.index);
      }
    } catch { return { state: 'unknown', httpStatus: status, requiresReconciliation: true }; }
    const state = results.every(r => r.status === 'ok') ? 'applied' :
      results.some(r => r.status === 'ok') ? 'partial' : 'rejected';
    const outcome: ApplyOutcome = { state, httpStatus: status, results, version: String(data.version),
      warnings: data.warnings, requiresReconciliation: true };
    try { outcome.snapshot = await this.level(gameId, levelId); }
    catch { outcome.readBackError = true; }
    // Even "applied" is a server acknowledgment. Host compares snapshot values to intended fields.
    return outcome;
  }
}
