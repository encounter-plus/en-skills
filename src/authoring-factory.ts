import {ModernAuthoringAdapter, AuthoringApiError, type AuthoringApiPort} from './authoring-api.ts';
import {LegacyAuthoringAdapter, type LegacySessionPort} from './legacy-authoring.ts';
import {resolveEngineProfile} from './engine-profile.ts';
import type {EncounterTransportOptions} from './encounter-transport.ts';
export type AuthoringApiOptions = Omit<EncounterTransportOptions,'token'> & {gameId: number; sessionEpoch: string; token?: EncounterTransportOptions['token']; legacySession?: LegacySessionPort};
export function createAuthoringApi(options: AuthoringApiOptions): AuthoringApiPort {
  const profile = resolveEngineProfile(options.domain);
  if (profile.engine === 'modern') {
    if (!options.token) throw new AuthoringApiError('session-changed');
    return new ModernAuthoringAdapter({...options,domain:profile.domain,token:options.token});
  }
  const session = options.legacySession;
  if (!session || session.binding.domain !== profile.domain || session.binding.gameId !== options.gameId || session.binding.sessionEpoch !== options.sessionEpoch) throw new AuthoringApiError('session-changed');
  return new LegacyAuthoringAdapter(session);
}
