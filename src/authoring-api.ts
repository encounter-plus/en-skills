import {ModernLevels} from './modern-levels.ts';
import {EncounterTransport, type EncounterTransportOptions} from './encounter-transport.ts';
import {resolveEngineProfile, type EngineProfile} from './engine-profile.ts';

export type AuthoringCapability = 'game-read' | 'game-settings-update' | 'game-file-upload' | 'game-description-read' | 'game-description-update' | 'level-index' | 'level-create' | 'level-copy' | 'level-delete' | 'level-move' | 'level-dismiss' | 'level-restore' | 'editor-read' | 'task-read' | 'task-update' | 'task-create' | 'task-delete' | 'sectors-read' | 'sector-create' | 'sector-update' | 'sector-delete' | 'bonuses-read' | 'bonus-create' | 'bonus-update' | 'bonus-delete' | 'answer-create' | 'answers-read' | 'answer-update' | 'answer-delete' | 'hint-read' | 'hint-update' | 'hint-create' | 'hint-delete' | 'level-settings-update' | 'message-update' | 'file-reference-read' | 'scenario-export-read' | 'batch' | 'transfer' | 'live-read' | 'corrections' | 'monitoring-read' | 'correction-ledger' | 'correction-write';
export interface AuthoringBinding { registryVersion: 1; engine: EngineProfile['engine']; domain: string; gameId: number; sessionEpoch: string }
export interface AuthoringMetadata {
  profile: Readonly<EngineProfile>; binding: Readonly<AuthoringBinding>;
  capabilities: Readonly<Record<AuthoringCapability, {available: boolean; reason?: string}>>;
  revision: {kind: 'server-version' | 'observed'; conditionalWrite: boolean; scope: 'level-apply' | 'operation-snapshot'};
}
/** API-shaped authoring protocol v1. DTO fields and raw acknowledgment statuses stay intact. */
export interface AuthoringApiPort {
  readonly metadata: Readonly<AuthoringMetadata>;
  request(path: string, init?: RequestInit): Promise<Response>;
  invalidate(): void;
}
export class AuthoringApiError extends Error {
  readonly code: 'unsupported' | 'session-changed' | 'invalid-scope' | 'incomplete-read' | 'conflict' | 'unknown-after-dispatch';
  constructor(code: AuthoringApiError['code']) {
    super(`Authoring API: ${code}`); this.name = 'AuthoringApiError';
    this.code = code;
  }
}
export function authoringBinding(domain: string, gameId: number, sessionEpoch: string): Readonly<AuthoringBinding> {
  const profile = resolveEngineProfile(domain);
  if (!Number.isSafeInteger(gameId) || gameId < 1 || typeof sessionEpoch !== 'string' || !sessionEpoch || sessionEpoch.length > 500) throw new AuthoringApiError('invalid-scope');
  return Object.freeze({registryVersion: 1, engine: profile.engine, domain: profile.domain, gameId, sessionEpoch});
}
export function sameAuthoringBinding(a: AuthoringBinding, b: AuthoringBinding): boolean {
  return a.registryVersion === b.registryVersion && a.engine === b.engine && a.domain === b.domain && a.gameId === b.gameId && a.sessionEpoch === b.sessionEpoch;
}
const capabilities: AuthoringCapability[] = ['game-read','game-file-upload','game-settings-update','game-description-read','game-description-update','level-index','level-create','level-copy','level-delete','level-move','level-dismiss','level-restore','editor-read','task-read','task-update','task-create','task-delete','sectors-read','sector-create','sector-update','sector-delete','bonuses-read','bonus-create','bonus-update','bonus-delete','answer-create','answers-read','answer-update','answer-delete','hint-read','hint-update','hint-create','hint-delete','level-settings-update','message-update','file-reference-read','scenario-export-read','batch','transfer','live-read','corrections','monitoring-read','correction-ledger','correction-write'];
export function authoringMetadata(binding: AuthoringBinding, supported: AuthoringCapability[]): Readonly<AuthoringMetadata> {
  const profile = resolveEngineProfile(binding.domain);
  if (!sameAuthoringBinding(binding,authoringBinding(binding.domain,binding.gameId,binding.sessionEpoch))) throw new AuthoringApiError('invalid-scope');
  return Object.freeze({profile, binding: Object.freeze({...binding}), capabilities: Object.freeze(Object.fromEntries(capabilities.map(name => [name, Object.freeze(supported.includes(name) ? {available: true} : {available: false, reason: 'not-implemented-and-verified'})])) as AuthoringMetadata['capabilities']),
    revision: Object.freeze({kind: profile.engine === 'modern' ? 'server-version' : 'observed', conditionalWrite: profile.engine === 'modern', scope: profile.engine === 'modern' ? 'level-apply' : 'operation-snapshot'})});
}
/** One instance belongs to one tenant/game/session. Hosts choose the opaque epoch. */
export class ModernAuthoringAdapter implements AuthoringApiPort {
  readonly metadata: Readonly<AuthoringMetadata>;
  readonly #transport: EncounterTransport;
  readonly #levels: ModernLevels;
  #active = true;
  #token: string | undefined;
  constructor(options: EncounterTransportOptions & {gameId: number; sessionEpoch: string}) {
    const binding = authoringBinding(options.domain, options.gameId, options.sessionEpoch);
    if (binding.engine !== 'modern') throw new AuthoringApiError('unsupported');
    this.metadata = authoringMetadata(binding, ['game-read','game-file-upload','game-settings-update','game-description-read','game-description-update','level-index','level-create','level-copy','level-delete','level-dismiss','level-restore','editor-read','task-read','task-update','hint-read','hint-update','level-settings-update','message-update','batch','transfer','live-read','corrections','monitoring-read','correction-ledger','correction-write']);
    this.#transport = new EncounterTransport({...options, domain: binding.domain, token: async () => {
      const token = await options.token();
      if (!this.#active || (this.#token !== undefined && this.#token !== token)) { this.invalidate(); throw new AuthoringApiError('session-changed'); }
      this.#token = token; return token;
    }});
    this.#levels = new ModernLevels(binding,(path,init)=>this.#direct(path,init));
  }
  async #direct(path:string,init?:RequestInit){
    if(!this.#active)throw new AuthoringApiError('session-changed');
    const response=await this.#transport.request(path,init);
    if(!this.#active){void response.body?.cancel().catch(()=>{});throw new AuthoringApiError('session-changed');}
    return response;
  }
  invalidate() { this.#active = false; }
  async request(path: string, init?: RequestInit): Promise<Response> {
    if (!this.#active) throw new AuthoringApiError('session-changed');
    const game = this.metadata.binding.gameId;
    if (!new RegExp(`^/(?:admin/)?games/${game}(?:/|$|\\?)`).test(path) || /[\\#\r\n]/.test(path) || /%/.test(path.split('?')[0])) throw new AuthoringApiError('invalid-scope');
    const parsed = new URL(path,'https://api.en.cx');
    if (parsed.pathname !== path.split('?')[0] || [...parsed.searchParams.keys()].some(key => ['gid','game_id','gameId','domain'].includes(key))) throw new AuthoringApiError('invalid-scope');
    const response = await this.#levels.request(path,init) ?? await this.#direct(path, init);
    if (!this.#active) { void response.body?.cancel().catch(() => {}); throw new AuthoringApiError('session-changed'); }
    return response;
  }
}
