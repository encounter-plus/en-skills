import { OpenAIImageReader, ImageReaderWithFallback } from './image-model.ts';
import { PublicGoogleSources } from './google-public.ts';
import { RouteCalculator } from './routing.ts';
import { readFile } from 'node:fs/promises';
import { EncounterClient } from './encounter.ts';
import {captureAuthoringExport} from './authoring-export.ts';
import {createAuthoringApi} from './authoring-factory.ts';
import {resolveEngineProfile} from './engine-profile.ts';
import {createNodeLegacySession,parseLegacyCookieJar} from './node-legacy-session.ts';
import { GoogleVisionOcr } from './ocr.ts';
export const remoteCommands: Record<string, string[]> = {
  route: ['input','out'],
  'encounter-game': ['game','domain','out'], 'encounter-levels': ['game','domain','out'],
  'encounter-export':['game','domain','input','out'], 'encounter-files':['game','domain','out'], 'encounter-scenario':['game','domain','out'],
  'encounter-level': ['game','level','domain','out'],
  'google-public': ['url','out'],
  'google-public-all': ['url','out'],
  ocr: ['input','out'],
};
export async function runRemoteCommand(command: string, values: Record<string, unknown>) {
  const flag = (key: string) => {
    if (typeof values[key] !== 'string' || !values[key]) throw new Error(`Missing --${key}`);
    return values[key] as string;
  };
  const token = (name: string) => () => {
    if (!process.env[name]) throw new Error(`Missing environment variable ${name}`);
    return process.env[name]!;
  };
  if (command === 'google-public') return new PublicGoogleSources().read(flag('url'));
  if (command === 'google-public-all') return new PublicGoogleSources().readAll(flag('url'));
  if (command === 'route') return new RouteCalculator({apiKey:()=>process.env.ORS_API_KEY??''}).calculate(JSON.parse(await readFile(flag('input'),'utf8')));
  if (command.startsWith('encounter-')) {
    const domain=resolveEngineProfile(flag('domain')).domain,gameId=Number(flag('game'));if(!Number.isSafeInteger(gameId)||gameId<1)throw new Error('Invalid game identity');
    const legacy=resolveEngineProfile(domain).engine==='legacy';
    const session=legacy?await createNodeLegacySession({domain,gameId,credential:async()=>{const path=process.env.ENCOUNTER_LEGACY_SESSION_FILE;if(!path)throw new Error('Set ENCOUNTER_LEGACY_SESSION_FILE to an explicitly authorized browser session export; bearer credentials cannot authenticate legacy');const bytes=await readFile(path);if(bytes.length>128000)throw new Error('Legacy session export exceeds host limit');try{return parseLegacyCookieJar(JSON.parse(bytes.toString('utf8')),domain);}catch{throw new Error('Invalid authorized legacy session export for this tenant');}}}):undefined;
    const api=createAuthoringApi({domain,gameId,sessionEpoch:session?.binding.sessionEpoch??crypto.randomUUID(),...(session?{legacySession:session}:{token:token('ENCOUNTER_ACCESS_TOKEN')})});
    if(command==='encounter-export')return captureAuthoringExport(api,{draftPresentation:typeof values.input==='string'?JSON.parse(await readFile(values.input,'utf8')):undefined});
    if(command==='encounter-files'||command==='encounter-scenario'){if(!legacy)throw new Error('Observed file/scenario codec is legacy-only; no guessed modern endpoint');const response=await api.request(`/admin/games/${gameId}/${command==='encounter-files'?'files':'scenario-export'}`);if(!response.ok)throw new Error('Scoped reference read unavailable');return response.json();}
    const client = new EncounterClient({domain,api});
    if (command === 'encounter-level') return client.level(flag('game'), flag('level'));
    if (command === 'encounter-levels') return client.levels(flag('game'));
    return client.game(flag('game'));
  }
  if (command === 'ocr') {
    const primary = new OpenAIImageReader({ token: token('OPENAI_API_KEY'), model: process.env.IMAGE_MODEL ?? '' });
    const fallback = process.env.GOOGLE_VISION_ACCESS_TOKEN && process.env.GOOGLE_CLOUD_PROJECT
      ? new GoogleVisionOcr({ token: token('GOOGLE_VISION_ACCESS_TOKEN'), quotaProject: process.env.GOOGLE_CLOUD_PROJECT }) : undefined;
    const client = new ImageReaderWithFallback(primary, fallback);
    return client.recognize(await readFile(flag('input')));
  }
  throw new Error('Unknown remote command');
}
