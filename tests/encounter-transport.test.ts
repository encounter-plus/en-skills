import test from 'node:test';
import assert from 'node:assert/strict';
import { EncounterTransport } from '../src/encounter-transport.ts';
import { RemoteError } from '../src/http.ts';

const options = { domain: 'demo.en.cx', token: () => 'synthetic-token' };
test('SDK transport sends one request with tenant/auth and preserves raw status and DTO', async () => {
  let calls = 0;
  const payload = { base_version: 'v1', ops: [{ entity: 'task', op: 'update', id: 9, fields: { task_text: '0012' } }] };
  const api = new EncounterTransport({ ...options, fetch: async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://api.en.cx/admin/games/42/levels/9/apply');
    assert.equal(init?.method, 'POST'); assert.deepEqual(JSON.parse(String(init?.body)), payload);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer synthetic-token');
    assert.equal(headers.get('X-En-Domain'), 'demo.en.cx');
    assert.equal(headers.get('X-En-Client'), 'automation');
    assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error');
    assert.equal(init?.cache, 'no-store'); assert.equal(init?.referrerPolicy, 'no-referrer');
    return Response.json({ version: 'v2', results: [], extra: 'preserved' }, { status: 207 });
  } });
  const response = await api.request('/admin/games/42/levels/9/apply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  assert.equal(response.status, 207);
  assert.deepEqual(await response.json(), { version: 'v2', results: [], extra: 'preserved' });
  assert.equal(calls, 1);
});

test('SDK error interception discards private bodies and never retries writes', async () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429, 500]) {
    let calls = 0, cancelled = false;
    const api = new EncounterTransport({ ...options, fetch: async () => {
      calls++;
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status });
    } });
    await assert.rejects(api.request('/admin/games/42/levels/9/apply', { method: 'POST' }), error => {
      assert.ok(error instanceof RemoteError); assert.equal(error.status, status);
      assert.equal('payload' in error, false); return true;
    });
    assert.equal(calls, 1); assert.equal(cancelled, true);
  }
  const api = new EncounterTransport({ ...options, fetch: async () => { throw new Error('private-token'); } });
  await assert.rejects(api.request('/admin/games/42'), { code: 'network_error' });
});

test('body limits cover declared and chunked responses; invalid UTF-8 is rejected', async () => {
  for (const response of [new Response('{}', { headers: { 'Content-Length': '101' } }), new Response('x'.repeat(101))]) {
    const api = new EncounterTransport({ ...options, maxResponseBytes: 100, fetch: async () => response });
    await assert.rejects(api.request('/admin/games/42'), { code: 'response_too_large' });
  }
  const api = new EncounterTransport({ ...options, fetch: async () => new Response(new Uint8Array([0xff])) });
  await assert.rejects(api.request('/admin/games/42'), { code: 'invalid_response' });
});

test('abort while waiting for a token prevents dispatch; abort while reading cancels the body', async () => {
  let calls = 0, release!: (token: string) => void;
  const controller = new AbortController();
  const api = new EncounterTransport({ ...options, token: () => new Promise(resolve => { release = resolve; }),
    fetch: async () => { calls++; return Response.json({}); } });
  const pending = api.request('/admin/games/42', { signal: controller.signal });
  controller.abort(); release('synthetic-token');
  await assert.rejects(pending, { code: 'aborted' }); assert.equal(calls, 0);

  let ready!: () => void, cancelled = false;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const abortBody = new AbortController();
  const reading = new EncounterTransport({ ...options, fetch: async () => {
    ready(); return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  } }).request('/admin/games/42', { signal: abortBody.signal });
  await started; await new Promise(resolve => setImmediate(resolve)); abortBody.abort();
  await assert.rejects(reading, { code: 'aborted' }); assert.equal(cancelled, true);
});

test('status-only acknowledgments keep empty 200 and 204 bodies and paths cannot escape origin', async () => {
  for (const status of [200, 204]) {
    const api = new EncounterTransport({ ...options, fetch: async () => new Response(null, { status }) });
    assert.equal((await api.request('/admin/games/42/levels/9/settings', { method: 'PUT' })).status, status);
  }
  let calls = 0;
  const api = new EncounterTransport({ ...options, fetch: async () => { calls++; return Response.json({}); } });
  for (const path of ['https://other.test/', '//other.test/', '/\\other.test/', '/admin/../auth/session', '/admin#fragment'])
    await assert.rejects(api.request(path));
  assert.equal(calls, 0);
});
