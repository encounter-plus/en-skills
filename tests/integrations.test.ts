import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EncounterClient, type LevelPlan } from '../src/encounter.ts';
import { GoogleVisionOcr } from '../src/ocr.ts';
import { loadSkill, loadSkillReference } from '../src/skills.ts';

function mock(...responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('Unexpected request');
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetch: fetcher };
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const plan = (): LevelPlan => ({ domain: 'demo.en.cx', gameId: '900001', levelId: '900002', baseVersion: 'v-test-1',
  ops: [{ entity: 'answer', op: 'update', id: 900003, fields: { answer_text: '0012' } }] });
const client = (fetcher: typeof fetch) => new EncounterClient({ domain: 'demo.en.cx', token: () => 'synthetic-token', fetch: fetcher });

test('Encounter captures full DTO and sends tenant/automation headers to fixed origin', async () => {
  const dto = { version: 'v-test-1', answers: [{ answer_text: '0012' }], unfamiliar: { preserved: true } };
  const transport = mock(json(dto));
  const result = await client(transport.fetch).level('900001','900002');
  assert.deepEqual(result.data, dto);
  assert.equal(transport.calls[0].url, 'https://api.en.cx/admin/games/900001/levels/900002/editor');
  const headers = new Headers(transport.calls[0].init.headers);
  assert.equal(headers.get('X-En-Domain'), 'demo.en.cx');
  assert.equal(headers.get('X-En-Client'), 'automation');
  assert.equal(transport.calls[0].init.redirect, 'error');
});
test('401 deactivates session and does not relogin or retry; error body stays private', async () => {
  const transport = mock(json({ error: 'synthetic-secret' },401));
  const c = client(transport.fetch);
  await assert.rejects(c.game('900001'), error => !String(error).includes('synthetic-secret'));
  await assert.rejects(c.game('900001'), /inactive/);
  assert.equal(transport.calls.length,1);
});
test('Invalidation fences a delayed token before sending and a delayed response', async () => {
  let resolveToken!: (token: string) => void;
  const transport = mock(json({}));
  const c = new EncounterClient({ domain:'demo.en.cx', token: () => new Promise(resolve => { resolveToken = resolve; }), fetch: transport.fetch });
  const pending = c.game('900001'); c.invalidate(); resolveToken('synthetic-token');
  await assert.rejects(pending,/changed/); assert.equal(transport.calls.length,0);
  let resolveResponse!: (r: Response) => void;
  const d = client(async () => new Promise(resolve => { resolveResponse = resolve; }));
  const second = d.game('900001');
  await new Promise(resolve => setImmediate(resolve)); d.invalidate(); resolveResponse(json({}));
  await assert.rejects(second,/changed/);
});
test('stale plan or active-player batch is rejected before mutation', async () => {
  for (const dto of [{ version:'new-version',players_started:false },{ version:'v-test-1',players_started:true }]) {
    const transport = mock(json(dto));
    const p = plan(); p.ops.push({ entity:'task',op:'create',fields:{task_text:'synthetic task'} });
    assert.equal((await client(transport.fetch).applyLevel(p)).state,'rejected');
    assert.equal(transport.calls.length,1);
  }
});
test('207 tracks individual outcomes and fetches new editor without resending writes', async () => {
  const transport = mock(json({version:'v-test-1',players_started:false}),
    json({ version:'v-test-2',results:[{index:0,status:'ok',id:900003},{index:1,status:'error',code:'validation'}],warnings:[] },207),
    json({version:'v-test-2',answers:[{answer_text:'0012'}]}));
  const p = plan(); p.ops.push({ entity:'task',op:'create',fields:{task_text:'synthetic task'} });
  const result = await client(transport.fetch).applyLevel(p);
  assert.equal(result.state,'partial'); assert.equal(result.snapshot?.data.version,'v-test-2');
  assert.equal(result.requiresReconciliation,true);
  assert.equal(transport.calls.filter(c=>c.init.method==='POST').length,1);
});
test('timeout after write has unknown outcome; no retries', async () => {
  const transport = mock(json({version:'v-test-1',players_started:false}),new Error('synthetic timeout'));
  const result = await client(transport.fetch).applyLevel(plan());
  assert.equal(result.state,'unknown'); assert.equal(transport.calls.length,2);
});
test('409 is rejected; malformed result indexes cannot be claimed successful', async () => {
  for (const response of [json({},409), json({version:'v2',results:[{index:3,status:'ok'}]})]) {
    const transport = mock(json({version:'v-test-1',players_started:false}),response);
    const result = await client(transport.fetch).applyLevel(plan());
    assert.equal(result.state, response.status===409 ? 'rejected' : 'unknown');
    assert.equal(transport.calls.length,2);
  }
});
test('acknowledged write with failed read-back remains explicitly unreconciled', async () => {
  const transport=mock(json({version:'v-test-1',players_started:false}),json({version:'v2',results:[{index:0,status:'ok'}]}),json({},503));
  const result=await client(transport.fetch).applyLevel(plan());
  assert.equal(result.state,'applied'); assert.equal(result.readBackError,true); assert.equal(result.requiresReconciliation,true);
});
const png=Buffer.from([137,80,78,71,13,10,26,10,0]); // Synthetic signature, provider is mocked.
test('OCR preserves literal text and boxes but never labels evidence visually confirmed', async () => {
  const raw={textAnnotations:[{description:'конь6\n0012',boundingPoly:{vertices:[{}, {x:10,y:20}]}}]};
  const transport=mock(json({responses:[raw]}));
  const evidence=await new GoogleVisionOcr({token:()=> 'synthetic-token',quotaProject:'synthetic-project',fetch:transport.fetch}).recognize(png);
  assert.equal(evidence.text,'конь6\n0012'); assert.deepEqual(evidence.raw,raw);
  assert.equal(evidence.needsVisualReview,true); assert.match(evidence.imageSha256,/^[a-f0-9]{64}$/);
  const body=JSON.parse(String(transport.calls[0].init.body));
  assert.deepEqual(Object.keys(body.requests[0]),['image','features']);
});
test('OCR handles per-image error, blank image result and invalid local files', async () => {
  const transport=mock(json({responses:[{error:{code:3,message:'synthetic private text'}}]}),json({responses:[{}]}));
  const ocr=new GoogleVisionOcr({token:()=> 'synthetic-token',quotaProject:'synthetic-project',fetch:transport.fetch});
  await assert.rejects(ocr.recognize(png),/recognition failed/);
  assert.equal((await ocr.recognize(png)).text,'');
  await assert.rejects(ocr.recognize(Buffer.from('not an image')),/PNG or JPEG/);
  assert.equal(transport.calls.length,2);
});
test('skill loader resolves standalone references and refuses traversal', async () => {
  assert.match((await loadSkill('check-code-photos')).instructions,/\]\(references\/code-marking\.md(?:#[^)]+)?\)/);
  assert.match(await loadSkillReference('check-code-photos','code-marking.md'),/кон66/);
  await assert.rejects(loadSkillReference('check-code-photos','../../README.md'),/filename/);
  assert.ok((await loadSkillReference('level-script','scripting/common.md')).length > 0);
  for (const filename of ['scripting/../../README.md','/scripting/common.md','scripting\\common.md','scripting/%2e%2e/common.md','scripting//common.md','scripting/common.md#section']) {
    await assert.rejects(loadSkillReference('level-script',filename),/filename/);
  }
});

test('local contract excerpt pins the implemented operations and apply result states', async () => {
  const { readFile } = await import('node:fs/promises');
  const contract = JSON.parse(await readFile(new URL('../docs/encounter-adapter-contract.json', import.meta.url),'utf8'));
  for (const path of ['/admin/games/{id}','/admin/games/{id}/levels','/admin/games/{id}/levels/{levelId}/editor'])
    assert.ok(contract.paths[path].get.responses['200']);
  const apply=contract.paths['/admin/games/{id}/levels/{levelId}/apply'].post;
  for (const status of ['200','207','409']) assert.ok(apply.responses[status]);
  assert.equal(contract.definitions['models.AdminLevelApplyResult'].properties.status.description,'ok | error');
});
test('mutation shape and tenant checks happen before network requests', async () => {
  const transport=mock(); const c=client(transport.fetch);
  const other=plan(); other.domain='other.en.cx';
  await assert.rejects(c.applyLevel(other),/tenant/);
  const many=plan(); many.ops=Array.from({length:201},()=>many.ops[0]);
  await assert.rejects(c.applyLevel(many),/plan/);
  const noId=plan(); delete noId.ops[0].id;
  await assert.rejects(c.applyLevel(noId),/ID/);
  assert.equal(transport.calls.length,0);
});
