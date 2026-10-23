export type TokenProvider = () => string | Promise<string>;
export interface ConnectionOptions { token: TokenProvider; fetch?: typeof fetch; timeoutMs?: number }
export class RemoteError extends Error {
  readonly status: number;
  constructor(status: number) { super(`Remote request failed (HTTP ${status})`); this.name = 'RemoteError'; this.status = status; }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected remote JSON object');
  return value as Record<string, unknown>;
}
export async function requestJson(options: ConnectionOptions, url: string, init: RequestInit = {}) {
  const token = await options.token();
  if (!token || /[\r\n]/.test(token)) throw new Error('Missing or invalid access token');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, { ...init, headers, credentials: 'omit', redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000) });
  } catch { throw new Error('Remote transport failed; request was not retried'); }
  // Do not expose remote error bodies: they may echo credentials or game content.
  if (!response.ok) throw new RemoteError(response.status);
  if (response.status === 204) return { status: response.status, data: {} };
  let data: Record<string, unknown>;
  try { data = object(await response.json()); }
  catch { throw new Error('Invalid remote JSON response'); }
  return { status: response.status, data };
}
export function positiveId(id: string): string {
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Expected positive numeric ID');
  return id;
}
