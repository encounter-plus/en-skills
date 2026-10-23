/** Read-only routing. Coordinates and the host-owned key go only to openrouteservice. */
export interface RoutePoint { latitude: number; longitude: number }
export interface RouteInput { origin: RoutePoint; destination: RoutePoint; mode: 'driving' | 'walking'; via?: RoutePoint[] }
export type RouteErrorCode = 'invalid_route_input' | 'routing_key_required' | 'routing_auth_failed' | 'routing_quota_exceeded' | 'no_route' | 'routing_unavailable' | 'invalid_route_response' | 'routing_session_changed';
const messages: Record<RouteErrorCode, string> = {
  invalid_route_input: 'Use two WGS84 coordinates with numeric latitude/longitude and mode driving or walking; at most eight via points.',
  routing_key_required: 'Enter a free openrouteservice API key in Route settings (CLI/MCP: ORS_API_KEY). Never send the key in chat.',
  routing_auth_failed: 'openrouteservice rejected the configured key. Check Route settings; no retry was made.',
  routing_quota_exceeded: 'openrouteservice quota exceeded. Wait for the quota to reset; no paid fallback or retry was used.',
  no_route: 'No route could be calculated near these coordinates. Check the parking/entrance points; no straight-line substitute was used.',
  routing_unavailable: 'openrouteservice is unavailable. The route was not calculated and the request was not retried.',
  invalid_route_response: 'The routing response contains no valid distance and duration. No estimate was substituted.',
  routing_session_changed: 'The routing key changed during calculation. Run the calculation again with the current settings.',
};
export class RouteError extends Error {
  readonly code: RouteErrorCode;
  constructor(code: RouteErrorCode) { super(messages[code]); this.name = 'RouteError'; this.code = code; }
}
const pointSchema = { type: 'object', properties: { latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 } }, required: ['latitude', 'longitude'], additionalProperties: false };
export const routeToolDefinition = { type: 'function' as const, function: {
  name: 'calculate_route',
  description: 'Calculate road distance and estimated travel time between two WGS84 coordinates using free openrouteservice. Choose driving or walking; optional via coordinates preserve author-specified turns. No traffic data, game writes, automatic level creation or paid fallback. The API key comes from host settings, never arguments. Returns meters, seconds, attribution and calculation time. Missing routes are explicit errors, never straight-line distances. Only coordinates are sent externally.',
  parameters: { type: 'object', properties: { origin: pointSchema, destination: pointSchema, mode: { type: 'string', enum: ['driving', 'walking'] }, via: { type: 'array', maxItems: 8, items: pointSchema } }, required: ['origin', 'destination', 'mode'], additionalProperties: false },
} };
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function point(value: unknown): RoutePoint {
  if (!object(value) || Object.keys(value).length !== 2 || Object.keys(value).some(key => !['latitude', 'longitude'].includes(key)) || typeof value.latitude !== 'number' || !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 || typeof value.longitude !== 'number' || !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180) throw new RouteError('invalid_route_input');
  return { latitude: value.latitude, longitude: value.longitude };
}
export function parseRouteInput(value: unknown): RouteInput {
  if (!object(value) || Object.keys(value).some(key => !['origin', 'destination', 'mode', 'via'].includes(key)) || typeof value.mode !== 'string' || !['driving', 'walking'].includes(value.mode)) throw new RouteError('invalid_route_input');
  if (value.via !== undefined && (!Array.isArray(value.via) || value.via.length > 8)) throw new RouteError('invalid_route_input');
  return { origin: point(value.origin), destination: point(value.destination), mode: value.mode as RouteInput['mode'], ...(value.via === undefined ? {} : { via: (value.via as unknown[]).map(point) }) };
}
export interface RouteResult extends RouteInput {
  schemaVersion: 1; provider: 'openrouteservice'; profile: 'driving-car' | 'foot-walking';
  distanceMeters: number; distanceKm: number; durationSeconds: number; durationMinutes: number; hintAfterSeconds: number;
  trafficIncluded: false; snapRadiusMeters: number; calculatedAt: string;
  attribution: { text: string; serviceUrl: string; dataUrl: string };
  note: string;
}
export class RouteCalculator {
  private tail: Promise<void> = Promise.resolve();
  private nextStart = 0;
  private readonly options: { apiKey: () => string; fetch?: typeof fetch; minIntervalMs?: number };
  constructor(options: { apiKey: () => string; fetch?: typeof fetch; minIntervalMs?: number }) { this.options = options; }
  async calculate(value: unknown, signal?: AbortSignal): Promise<RouteResult> {
    const input = parseRouteInput(value);
    signal?.throwIfAborted();
    const apiKey = this.options.apiKey().trim();
    if (!apiKey || /[\r\n]/.test(apiKey) || apiKey.length > 4096) throw new RouteError('routing_key_required');
    // Serialize calls within a host instance; provider quotas still apply across tabs/users.
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    try {
      await previous;
      signal?.throwIfAborted();
      const delay = Math.max(0, this.nextStart - Date.now());
      if (delay) await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal?.reason); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, delay);
        signal?.addEventListener('abort', abort, { once: true });
      });
      signal?.throwIfAborted();
      if (this.options.apiKey().trim() !== apiKey) throw new RouteError('routing_session_changed');
      this.nextStart = Date.now() + (this.options.minIntervalMs ?? 2000);
      return await this.request(input, apiKey, signal);
    } finally { release(); }
  }
  private async request(input: RouteInput, apiKey: string, signal?: AbortSignal): Promise<RouteResult> {
    const profile = input.mode === 'driving' ? 'driving-car' : 'foot-walking';
    const points = [input.origin, ...(input.via ?? []), input.destination];
    const snapRadiusMeters = input.mode === 'walking' ? 50 : 150;
    const timeout = AbortSignal.timeout(30_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(`https://api.openrouteservice.org/v2/directions/${profile}/json`, {
        method: 'POST', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: requestSignal,
        headers: { Authorization: apiKey, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ coordinates: points.map(p => [p.longitude, p.latitude]), units: 'm', geometry: false, instructions: false, radiuses: points.map(() => snapRadiusMeters) }),
      });
    } catch { signal?.throwIfAborted(); throw new RouteError('routing_unavailable'); }
    if ([401, 403, 429].includes(response.status)) {
      await response.body?.cancel();
      throw new RouteError(response.status === 429 ? 'routing_quota_exceeded' : 'routing_auth_failed');
    }
    let data: unknown;
    try {
      if (!response.body) throw new Error();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1_000_000) throw new Error(); chunks.push(value); }
      } finally { await reader.cancel(); reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      data = JSON.parse(new TextDecoder().decode(bytes));
    } catch { signal?.throwIfAborted(); throw new RouteError(response.ok ? 'invalid_route_response' : 'routing_unavailable'); }
    signal?.throwIfAborted();
    if (this.options.apiKey().trim() !== apiKey) throw new RouteError('routing_session_changed');
    const error = object(data) && object(data.error) ? data.error : undefined;
    if (error && [2009, 2010, 2011].includes(Number(error.code))) throw new RouteError('no_route');
    if (!response.ok || error) throw new RouteError('routing_unavailable');
    const route = object(data) && Array.isArray(data.routes) ? data.routes[0] : undefined;
    const summary = object(route) && object(route.summary) ? route.summary : undefined;
    const distance = summary?.distance, duration = summary?.duration;
    if (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0 || typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0 || duration > Number.MAX_SAFE_INTEGER) throw new RouteError('invalid_route_response');
    return { schemaVersion: 1, provider: 'openrouteservice', ...input, profile, distanceMeters: distance, distanceKm: distance / 1000, durationSeconds: duration, durationMinutes: duration / 60,
      hintAfterSeconds: Math.ceil(duration), trafficIncluded: false, snapRadiusMeters, calculatedAt: new Date().toISOString(),
      attribution: { text: '© openrouteservice by HeiGIT | © OpenStreetMap contributors', serviceUrl: 'https://openrouteservice.org/', dataUrl: 'https://www.openstreetmap.org/copyright' },
      note: 'Estimated time without live traffic. Endpoints are matched to the nearby road/path network within snapRadiusMeters; verify parking, entrances, access and author-specified turns. hintAfterSeconds rounds the estimate up to a whole second; it is not an auto-pass setting.' };
  }
}
