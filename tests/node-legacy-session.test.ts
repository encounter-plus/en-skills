import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNodeLegacySession,parseLegacyCookieJar} from '../src/node-legacy-session.ts';
import {validateLegacyRecipe} from '../src/legacy-recipe-guard.ts';
const domain='fixture.en.cx';
const cookie=()=>parseLegacyCookieJar({cookies:[{name:'auth',value:'SYNTHETIC_SECRET',domain,path:'/',secure:true,httpOnly:true,expires:-1},{name:'foreign',value:'MUST_NOT_SEND',domain:'evil.test',path:'/',secure:true,httpOnly:true,expires:-1}]},domain);
const html=(login='Author')=>`<a class="white bold no_decoration" href="/UserDetails.aspx">${login}</a><a id="lnkUserName" href="/UserDetails.aspx">${login}</a><a href="/Login.aspx?action=logout">Logout</a><form id="LevelsCreateForm"></form>`;
const response=(value=html())=>new Response(value,{headers:{'Content-Type':'text/html; charset=utf-8'}});
const recipe={kind:'level-editor-read' as const,effect:'read' as const,method:'GET' as const,path:'/Administration/Games/LevelEditor.aspx?gid=42&level=1'};

test('authorized browser user agent survives import and accompanies principal and recipe reads',async()=>{
 const userAgent='Mozilla/5.0 SyntheticBrowser/1.0';
 let jar=parseLegacyCookieJar({...cookie(),userAgent},domain),calls=0;
 const session=await createNodeLegacySession({domain,gameId:42,credential:async()=>jar,minRequestIntervalMs:0,fetch:async(_url,init)=>{
  calls++;return new Headers(init?.headers).get('User-Agent')===userAgent?response():new Response(null,{status:302,headers:{location:'/Login.aspx'}});
 }});
 assert.equal((await session.dispatch(recipe)).status,200);assert.equal(calls,2);
 jar=parseLegacyCookieJar({...jar,userAgent:'ChangedBrowser/2.0'},domain);
 await assert.rejects(session.dispatch(recipe),/session-changed/);assert.equal(calls,2);
});

test('browser user agent rejects injected headers and invalid imported values',()=>{
 for(const userAgent of ['',42,'bad\r\nInjected: yes','x'.repeat(2049)])assert.throws(()=>parseLegacyCookieJar({...cookie(),userAgent},domain));
});

test('Node legacy cookie host fences metadata locally and dispatches only fixed scoped recipes',async()=>{
 const calls:{url:string;init:RequestInit}[]=[];
 const session=await createNodeLegacySession({domain,gameId:42,credential:async()=>cookie(),minRequestIntervalMs:0,fetch:async(url,init)=>{calls.push({url:String(url),init:init!});return response();}});
 for(let i=0;i<100;i++)await session.currentBinding();assert.equal(calls.length,0);
 const result=await session.dispatch(recipe);assert.equal(result.status,200);assert.equal(calls.length,2);
 for(const call of calls){const headers=new Headers(call.init.headers);assert.equal(headers.get('Cookie'),'auth=SYNTHETIC_SECRET');assert.equal(headers.get('Authorization'),null);assert.equal(call.init.redirect,'manual');assert.ok(call.url.startsWith('https://fixture.en.cx/'));}
 assert.match(session.binding.sessionEpoch,/^[a-f0-9-]{36}$/);
 await assert.rejects(session.dispatch({...recipe,path:'https://evil.test/'}));
 await assert.rejects(session.dispatch({...recipe,kind:'task-delete',path:'/Administration/Games/TaskEdit.aspx?gid=42&level=1&action=TaskDelete&tid=2'}));
 assert.equal(calls.length,2);
});

test('cookie imports reject malformed data and filter foreign origins',()=>{
 assert.equal(cookie().cookies.length,1);
 assert.throws(()=>parseLegacyCookieJar({cookies:[]},domain));
 const jar=cookie();jar.cookies[0].value='bad\r\nInjected: yes';assert.throws(()=>parseLegacyCookieJar(jar,domain));
 assert.throws(()=>parseLegacyCookieJar(cookie(),'demo.en.cx'));
});

test('durable recalculation binding includes imported cookies and verified principal; JSON is allowed only for statistics recipe',async()=>{
 let login='Author',jsonType='application/json';
 const fetchImpl:typeof fetch=async(url)=>String(url).includes('/gamestatistics/')?new Response('{"safe":"fixture"}',{headers:{'Content-Type':jsonType}}):response(html(login));
 const options={domain,gameId:42,credential:async()=>cookie(),minRequestIntervalMs:0,persistentBinding:true,fetch:fetchImpl};
 const first=await createNodeLegacySession(options),second=await createNodeLegacySession(options);
 assert.equal(first.binding.sessionEpoch,second.binding.sessionEpoch);assert.match(first.binding.sessionEpoch,/^legacy-principal:[a-f0-9]{64}$/);
 const stats={kind:'statistics-json' as const,effect:'read' as const,method:'GET' as const,path:'/gamestatistics/full/42?json=1'};
 assert.equal((await first.dispatch(stats)).html,'{"safe":"fixture"}');
 login='Another';const different=await createNodeLegacySession(options);assert.notEqual(first.binding.sessionEpoch,different.binding.sessionEpoch);
 await assert.rejects(first.dispatch(stats),/session-changed/);
 jsonType='text/html';await assert.rejects(different.dispatch(stats),/unavailable/);
});

test('rotation and account change stop before mutation; old epochs cannot resume',async()=>{
 let jar=cookie(),login='Author',posts=0;
 const session=await createNodeLegacySession({domain,gameId:42,credential:async()=>jar,minRequestIntervalMs:0,fetch:async(_url,init)=>{if(init?.method==='POST')posts++;return response(html(login));}});
 await session.dispatch(recipe);login='Other';
 const mutation={kind:'task-update' as const,effect:'mutation' as const,method:'POST' as const,path:'/Administration/Games/TaskEdit.aspx?gid=42&level=1&action=TaskEdit&tid=2',body:'inputTask=literal'};
 await assert.rejects(session.dispatch(mutation),/session-changed/);assert.equal(posts,0);
 await assert.rejects(session.currentBinding(),/session-changed/);
 const another=await createNodeLegacySession({domain,gameId:42,credential:async()=>jar,minRequestIntervalMs:0,fetch:async()=>response()});jar={...jar,importId:crypto.randomUUID()};
 await assert.rejects(another.dispatch(recipe),/session-changed/);
});

test('unknown writes and authentication checkpoints are never replayed',async()=>{
 let posts=0,calls=0;
 const session=await createNodeLegacySession({domain,gameId:42,credential:async()=>cookie(),minRequestIntervalMs:0,fetch:async(_url,init)=>{calls++;if(init?.method==='POST'){posts++;throw new Error('SYNTHETIC_SECRET');}return response();}});
 const mutation={kind:'task-update' as const,effect:'mutation' as const,method:'POST' as const,path:'/Administration/Games/TaskEdit.aspx?gid=42&level=1&action=TaskEdit&tid=2',body:'inputTask=literal'};
 await assert.rejects(session.dispatch(mutation),error=>error instanceof Error&&/outcome unknown/.test(error.message)&&!error.message.includes('SYNTHETIC_SECRET'));
 await session.dispatch(recipe);assert.equal(posts,1);assert.equal(calls,4);
 let authCalls=0;const blocked=await createNodeLegacySession({domain,gameId:42,credential:async()=>cookie(),minRequestIntervalMs:0,fetch:async()=>{authCalls++;return new Response(null,{status:302,headers:{Location:'/Login.aspx'}});}});
 await assert.rejects(blocked.dispatch(recipe),/checkpoint/);await assert.rejects(blocked.dispatch(recipe));assert.equal(authCalls,1);
});

test('lost mutation acknowledgement cannot bypass changed principal, rotated credentials or authentication denial on reconciliation',async()=>{
 const mutation={kind:'task-update' as const,effect:'mutation' as const,method:'POST' as const,path:'/Administration/Games/TaskEdit.aspx?gid=42&level=1&action=TaskEdit&tid=2',body:'inputTask=literal'};
 for(const change of ['principal','credential','denied'] as const){
   let posts=0,login='Author',jar=cookie(),denied=false;
   const session=await createNodeLegacySession({domain,gameId:42,credential:async()=>jar,minRequestIntervalMs:0,fetch:async(_url,init)=>{
     if(init?.method==='POST'){posts++;if(change==='principal')login='Another';if(change==='credential')jar={...jar,importId:crypto.randomUUID()};if(change==='denied')denied=true;throw new Error('Lost acknowledgement');}
     return denied?new Response(null,{status:401}):response(html(login));
   }});
   await assert.rejects(session.dispatch(mutation),/outcome unknown/);
   await assert.rejects(session.dispatch(recipe));await assert.rejects(session.currentBinding(),/session-changed/);assert.equal(posts,1);
 }
});

test('same-domain Node dispatch is serial and rate bounded across concurrent work',async()=>{
 let active=0,max=0;const starts:number[]=[];
 const session=await createNodeLegacySession({domain,gameId:42,credential:async()=>cookie(),minRequestIntervalMs:15,fetch:async()=>{active++;max=Math.max(max,active);starts.push(Date.now());await new Promise(resolve=>setTimeout(resolve,2));active--;return response();}});
 await Promise.all([session.dispatch(recipe),session.dispatch(recipe)]);assert.equal(max,1);assert.equal(starts.length,4);
 for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=13);
});

 test('root host-only cookies and conflicting body game scope never cross the tenant boundary',async()=>{
 const jar=cookie();jar.cookies.push({...jar.cookies[0],name:'rootOnly',domain:'en.cx'},{...jar.cookies[0],name:'parentDomain',domain:'.en.cx'});
 const calls:RequestInit[]=[];const session=await createNodeLegacySession({domain,gameId:42,credential:async()=>jar,minRequestIntervalMs:0,fetch:async(_url,init)=>{calls.push(init!);return response();}});
 await session.dispatch(recipe);assert.equal(new Headers(calls[0].headers).get('Cookie'),'auth=SYNTHETIC_SECRET; parentDomain=SYNTHETIC_SECRET');
 await assert.rejects(session.dispatch({kind:'task-update',effect:'mutation',method:'POST',path:'/Administration/Games/TaskEdit.aspx?gid=42&level=1&action=TaskEdit&tid=2',body:'gid=99&inputTask=x'}),/Invalid legacy/);assert.equal(calls.length,2);
 });

test('Node bonus delete proof reads only exact view recipe and rejects altered coordinates',async()=>{
 const session=await createNodeLegacySession({domain,gameId:42,credential:async()=>cookie(),minRequestIntervalMs:0,fetch:async()=>response()});
 const view={kind:'bonus-form-read' as const,effect:'read' as const,method:'GET' as const,path:'/Administration/Games/BonusEdit.aspx?gid=42&level=1&bonus=71&action=view'};
 assert.doesNotThrow(()=>validateLegacyRecipe(view,session.binding));assert.throws(()=>validateLegacyRecipe({...view,path:view.path.replace('bonus=71','bonus=0')},session.binding));assert.throws(()=>validateLegacyRecipe({...view,path:view.path+'&delete=1'},session.binding));
});

test('credential import during principal preflight fences the pending mutation before sending cookies',async()=>{
 let jar=cookie(),calls=0,posts=0;const session=await createNodeLegacySession({domain,gameId:42,credential:async()=>jar,minRequestIntervalMs:0,fetch:async(_url,init)=>{calls++;if(init?.method==='POST')posts++;jar={...jar,importId:crypto.randomUUID()};return response();}});
 await assert.rejects(session.dispatch({kind:'task-update',effect:'mutation',method:'POST',path:'/Administration/Games/TaskEdit.aspx?gid=42&level=1&action=TaskEdit&tid=2',body:'inputTask=literal'}),/session-changed/);assert.equal(posts,0);assert.equal(calls,1);
});

test('Node hint/message delete-proof views allow only exact readonly scoped recipes',async()=>{
 const session=await createNodeLegacySession({domain,gameId:42,credential:async()=>cookie(),minRequestIntervalMs:0,fetch:async()=>response()});
 const views=[{kind:'hint-view-read' as const,path:'/Administration/Games/PromptEdit.aspx?gid=42&level=1&prid=71'},{kind:'hint-view-read' as const,path:'/Administration/Games/PromptEdit.aspx?gid=42&level=1&prid=71&penalty=1'},{kind:'message-view-read' as const,path:'/Administration/Games/MessageEdit.aspx?gid=42&level=1&mid=71'}];
 for(const view of views){const recipe={...view,effect:'read' as const,method:'GET' as const};assert.doesNotThrow(()=>validateLegacyRecipe(recipe,session.binding));for(const suffix of ['&action=delete','&action=edit','&gid=42','&extra=1'])assert.throws(()=>validateLegacyRecipe({...recipe,path:recipe.path+suffix},session.binding));assert.throws(()=>validateLegacyRecipe({...recipe,path:recipe.path.replace('gid=42','gid=99')},session.binding));assert.throws(()=>validateLegacyRecipe({...recipe,method:'POST',body:'action=delete'},session.binding));}
 assert.throws(()=>validateLegacyRecipe({kind:'hint-view-read',effect:'read',method:'GET',path:'/Administration/Games/PromptEdit.aspx?gid=42&level=1&prid=71&penalty=0'},session.binding));
});

test('level index verifies principal from its own response without redundant requests',async()=>{let login='Author',calls=0;const session=await createNodeLegacySession({domain,gameId:42,credential:async()=>cookie(),minRequestIntervalMs:0,fetch:async()=>{calls++;return response(html(login));}});const index={kind:'level-index' as const,effect:'read' as const,method:'GET' as const,path:'/Administration/Games/LevelManager.aspx?gid=42'};await session.dispatch(index);assert.equal(calls,1);login='Another';await assert.rejects(session.dispatch(index),/session-changed/);assert.equal(calls,2);await assert.rejects(session.dispatch(index),/session-changed/);assert.equal(calls,2);});
test('human verification redirect is distinguished and retires transport without retry',async()=>{let calls=0;const session=await createNodeLegacySession({domain,gameId:42,credential:async()=>cookie(),minRequestIntervalMs:0,fetch:async()=>{calls++;return new Response(null,{status:302,headers:{Location:'/NotHumanRequest.aspx?return=private'}});}});await assert.rejects(session.dispatch(recipe),/human-verification/);await assert.rejects(session.dispatch(recipe),/session-changed/);assert.equal(calls,1);});

test('Node uploader encodes native multipart once with scoped cookies and no manual content-type',async()=>{
 let posts=0;const session=await createNodeLegacySession({domain,gameId:42,credential:async()=>cookie(),minRequestIntervalMs:0,fetch:async(url,init)=>{if(init?.method==='POST'){posts++;assert.equal(String(url),'https://fixture.en.cx/Administration/Games/FileUploader.aspx?gid=42');assert.ok(init.body instanceof FormData);assert.equal(new Headers(init.headers).has('Content-Type'),false);assert.equal(init.body.get('__VIEWSTATE'),'fixture');const file=init.body.get('Upload') as File;assert.equal(file.name,'dialog.css');assert.equal(file.type,'text/css');assert.equal(await file.text(),'.dialog{}');}return response();}});
 await session.dispatch({kind:'file-upload',effect:'mutation',method:'POST',path:'/Administration/Games/FileUploader.aspx?gid=42',upload:{field:'Upload',filename:'dialog.css',mime:'text/css',base64:btoa('.dialog{}'),controls:[['__VIEWSTATE','fixture'],['Send','Upload']]}});assert.equal(posts,1);
});
