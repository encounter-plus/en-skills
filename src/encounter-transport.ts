import { EncounterClient as SdkClient } from '@encounter-api/sdk';
import { RemoteError, type ConnectionOptions } from './http.ts';
import {resolveEngineProfile} from './engine-profile.ts';

export const ENCOUNTER_API_ORIGIN = 'https://api.en.cx';
export interface EncounterTransportOptions extends ConnectionOptions {
  domain: string;
  maxResponseBytes?: number;
}
export class EncounterTransportError extends Error {
  readonly code: 'aborted' | 'network_error' | 'invalid_response' | 'response_too_large';
  constructor(code: EncounterTransportError['code']) {
    super(`Encounter transport: ${code}`); this.name = 'EncounterTransportError'; this.code = code;
  }
}

/** Shared SDK transport. Hosts still own scope, permissions, approvals and write reconciliation. */
export class EncounterTransport {
  readonly sdk: SdkClient;
  constructor(options: EncounterTransportOptions) {
    if (resolveEngineProfile(options.domain).engine !== 'modern') throw new Error('Modern SDK transport is unavailable for this engine');
    if (options.domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(options.domain))
      throw new Error('Expected an Encounter tenant hostname');
    const limit = options.maxResponseBytes ?? 8 * 1024 * 1024;
    const timeout = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(timeout) || timeout < 1) throw new Error('Invalid transport limits');
    this.sdk = new SdkClient({ baseUrl: ENCOUNTER_API_ORIGIN, siteDomain: options.domain,
      tokenProvider: async () => {
        const token = await options.token();
        if (!token || /[\r\n]/.test(token)) throw new Error('Missing or invalid access token');
        return token;
      },
      fetch: async (url, init) => {
        if (new URL(String(url)).origin !== ENCOUNTER_API_ORIGIN) throw new Error('Unexpected API origin');
        const headers = new Headers(init?.headers);
        headers.set('X-En-Client', 'automation'); headers.set('Accept', 'application/json');
        const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
        let response: Response;
        try {
          signal.throwIfAborted();
          response = await (options.fetch ?? fetch)(url, { ...init, headers, signal,
            cache: 'no-store', referrerPolicy: 'no-referrer', credentials: 'omit', redirect: 'error' });
        } catch { throw new EncounterTransportError(signal.aborted ? 'aborted' : 'network_error'); }
        // Intercept before the SDK reads error bodies, which can contain credentials or game content.
        if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new RemoteError(response.status); }
        if (signal.aborted) { void response.body?.cancel().catch(() => {}); throw new EncounterTransportError('aborted'); }
        if (response.status === 204 || response.status === 205) return response;
        if (Number(response.headers.get('Content-Length')) > limit) {
          void response.body?.cancel().catch(() => {}); throw new EncounterTransportError('response_too_large');
        }
        const reader = response.body?.getReader();
        // Some PUT endpoints acknowledge with an empty 200. JSON consumers validate their own body.
        if (!reader) return response;
        const abort = () => { void reader.cancel().catch(() => {}); };
        signal.addEventListener('abort', abort, { once: true });
        const chunks: Uint8Array[] = []; let size = 0;
        try {
          for (;;) {
            signal.throwIfAborted();
            const item = await reader.read();
            signal.throwIfAborted();
            if (item.done) break;
            size += item.value.byteLength;
            if (size > limit) throw new EncounterTransportError('response_too_large');
            chunks.push(item.value);
          }
        } catch (error) {
          throw signal.aborted ? new EncounterTransportError('aborted') :
            error instanceof EncounterTransportError ? error : new EncounterTransportError('network_error');
        } finally {
          signal.removeEventListener('abort', abort);
          void reader.cancel().catch(() => {}); reader.releaseLock();
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { throw new EncounterTransportError('invalid_response'); }
        return new Response(bytes, { status: response.status, headers: response.headers });
      },
    });
  }
  /** One SDK attempt, with raw status preserved for host-specific acknowledgment rules. */
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!path.startsWith('/') || path.startsWith('//') || /[\\#\r\n]/.test(path) || /(?:^|\/)\.{1,2}(?:\/|\?|$)/.test(path))
      throw new Error('Expected a relative API path');
    if (new URL(path, ENCOUNTER_API_ORIGIN).pathname !== path.split('?')[0]) throw new Error('Noncanonical API path');
    if (init.signal?.aborted) throw new EncounterTransportError('aborted');
    return this.sdk.fetchApi(`${ENCOUNTER_API_ORIGIN}${path}`, init);
  }
}
