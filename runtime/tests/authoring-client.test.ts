import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryCredentialStore} from '../src/credential-store.js';
import {createRuntimeApi,runtimeAuthoringPort,runtimeProfile} from '../src/authoring-client.js';
import {legacyCredentialKey,parseLegacyCookieJar} from '../../src/node-legacy-session.ts';
const profile={name:'node-legacy-fixture',domain:'fixture.en.cx',apiBaseUrl:'https://api.en.cx',webBaseUrl:'https://fixture.en.cx'};
const jar=()=>parseLegacyCookieJar({cookies:[{name:'auth',value:'SYNTHETIC_ONLY',domain:profile.domain,path:'/',secure:true,httpOnly:true,expires:-1}]},profile.domain);

test('runtime legacy bindings persist across tool client instances and rotate on explicit session import',async()=>{
 const store=new MemoryCredentialStore();await store.set(legacyCredentialKey(profile.name),JSON.stringify(jar()));
 let requests=0;const mock:typeof fetch=async()=>{requests++;return new Response('<a class="white bold no_decoration" href="/UserDetails.aspx">Synthetic author</a><a id="lnkUserName" href="/UserDetails.aspx">Synthetic author</a><a href="/Login.aspx?action=logout">Logout</a><form id="LevelsCreateForm"></form>',{headers:{'Content-Type':'text/html'}});};
 const first=await runtimeAuthoringPort(profile,store,42,mock),second=await runtimeAuthoringPort(profile,store,42,mock);
 assert.equal(first,second);assert.match(first.metadata.binding.sessionEpoch,/^legacy-principal:[a-f0-9]{64}$/);assert.equal(requests,1);
 const otherGame=await runtimeAuthoringPort(profile,store,43,mock);assert.notEqual(first.metadata.binding.gameId,otherGame.metadata.binding.gameId);assert.equal(requests,2);
 await store.set(legacyCredentialKey(profile.name),JSON.stringify({...jar(),importId:crypto.randomUUID()}));
 const rotated=await runtimeAuthoringPort(profile,store,42,mock);assert.notEqual(first.metadata.binding.sessionEpoch,rotated.metadata.binding.sessionEpoch);
 await assert.rejects(first.request('/admin/games/42/levels'),/session-changed/);assert.equal(requests,3);
});

test('runtime legacy never consumes a bearer slot or accepts unscoped/auth-retry paths',async()=>{
 const store=new MemoryCredentialStore();await store.set(profile.name,'BEARER_MUST_NOT_AUTHENTICATE_LEGACY');
 const api=createRuntimeApi(profile,store,async()=>{throw new Error('must not dispatch');});
 await assert.rejects(api.request('GET','/admin/games/42/levels'),/Import an authorized/);
 await assert.rejects(api.request('GET','https://evil.test/'),/scoped/);
 await assert.rejects(api.request('GET','/admin/games/42/levels',{retryAuth:true}),/automatic auth retry/);
 assert.equal(runtimeProfile(profile).previewUrlTemplate,'https://fixture.en.cx/admin/games/levels/preview/{gameId}?level={levelNumber}');
 assert.equal(runtimeProfile({...profile,domain:'demo.en.cx'}).previewUrlTemplate,'https://demo.en.cx/admin/games/{gameId}/levels/preview/{levelNumber}');
});

test('cached Node runtime port reconciles a lost native POST acknowledgement, then remains usable without replay',async()=>{
 const store=new MemoryCredentialStore();await store.set(legacyCredentialKey(profile.name),JSON.stringify(jar()));
 let description='Before',posts=0,changedPrincipal=false;
 const principal=()=>`<a class="white bold no_decoration" href="/UserDetails.aspx">${changedPrincipal?'Another author':'Synthetic author'}</a><a id="lnkUserName" href="/UserDetails.aspx">Synthetic author</a><a href="/Login.aspx?action=logout">Logout</a><form id="LevelsCreateForm"></form>`;
 const form=()=>`<form method="post" action="/Administration/Games/GameEditor.aspx"><input type="hidden" name="gid" value="42"><input type="hidden" name="action" value="update"><input name="GameTitle" value="Synthetic"><textarea name="Descr">${description}</textarea><input type="image" name="btnUpdate"></form>`;
 const mock:typeof fetch=async(url,init)=>{
   if(init?.method==='POST'){posts++;description=new URLSearchParams(String(init.body)).get('Descr')!;if(posts===1)throw new Error('Lost ACK after synthetic server applied POST');return new Response(form(),{headers:{'Content-Type':'text/html'}});}
   return new Response(String(url).includes('/LevelManager.aspx')?principal():form(),{headers:{'Content-Type':'text/html'}});
 };
 const api=createRuntimeApi(profile,store,mock),port=await runtimeAuthoringPort(profile,store,42,mock);
 const before=await api.request<{version:string}>('GET','/admin/games/42');
 const result=await api.request<{game:{descr:string}}>('PUT','/admin/games/42',{headers:{'If-Match':before.version},body:{descr:'After lost ACK'}});
 assert.equal(result.game.descr,'After lost ACK');assert.equal(posts,1);
 assert.equal(await runtimeAuthoringPort(profile,store,42,mock),port);
 const verified=await api.request<{version:string;game:{descr:string}}>('GET','/admin/games/42');assert.equal(verified.game.descr,'After lost ACK');assert.equal(posts,1);
 // An explicitly new operation after successful reconciliation remains possible; the lost POST is never resent.
 const next=await api.request<{game:{descr:string}}>('PUT','/admin/games/42',{headers:{'If-Match':verified.version},body:{descr:'A distinct reviewed edit'}});assert.equal(next.game.descr,'A distinct reviewed edit');assert.equal(posts,2);
 changedPrincipal=true;
 await assert.rejects(api.request('GET','/admin/games/42'),/session-changed/);
 await assert.rejects(api.request('GET','/admin/games/42'),/session-changed/);assert.equal(posts,2);
});

test('a rejected runtime principal initialization is evicted without retrying its request automatically',async()=>{
 const store=new MemoryCredentialStore();await store.set(legacyCredentialKey(profile.name),JSON.stringify(jar()));let calls=0;
 const mock:typeof fetch=async()=>{calls++;if(calls===1)throw new Error('Transient initialization network failure');return new Response('<a class="white bold no_decoration" href="/UserDetails.aspx">Synthetic author</a><a id="lnkUserName" href="/UserDetails.aspx">Synthetic author</a><a href="/Login.aspx?action=logout">Logout</a><form id="LevelsCreateForm"></form>',{headers:{'Content-Type':'text/html'}});};
 await assert.rejects(runtimeAuthoringPort(profile,store,42,mock),/request failed/);assert.equal(calls,1);
 const recovered=await runtimeAuthoringPort(profile,store,42,mock);assert.equal(calls,2);assert.match(recovered.metadata.binding.sessionEpoch,/^legacy-principal:/);
});
