import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {makePage} from '../harness/page.mjs';
import {legacyPreviewPageCommand} from '../harness/engine-preview/legacy-page.mjs';
const browser=await chromium.launch({channel:process.env.EN_SCRIPT_TEST_CHANNEL??'msedge',headless:true});
const host=await readFile(new URL('../harness/rn-host.js',import.meta.url),'utf8');
const runtime=await readFile(new URL('../harness/snapshot-react-native/enplus-injected.js',import.meta.url),'utf8');
try {
 for(const lifecycle of [false,true]) {
  const errors=[],blocked=[];
  const task='<div id="task-literal">001 конь6 &amp; text</div><script>window.order=["task:"+jQuery.fn.jquery];window.memory=(window.memory||0)+1;'+(lifecycle?'jQuery(function(){window.order.push("ready:"+Boolean(document.getElementById("message")));});':'')+'</script>';
  let seed={seed:'stored'};
  const fixture=()=>({documentToken:lifecycle?2:1,authorStorageSeed:seed,messages:[{id:1,owner:'Synthetic',hasScript:true,html:'<div id="message">Message</div><script>window.order.push("message");</script>'}]});
  let html=await makePage('legacy-enplus-react-native',task,fixture(),'harness/snapshot-react-native');
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='fixture.en.cx'){blocked.push(url.href);return route.abort();}if(url.pathname==='/rn-host.js')return route.fulfill({contentType:'text/javascript',body:host});if(url.pathname.startsWith('/admin/games/levels/preview/'))return route.fulfill({contentType:'text/html',body:html});return route.abort();});
  await page.goto('https://fixture.en.cx/admin/games/levels/preview/42?level=1');
  await page.waitForFunction(()=>window.__harness.events.some(e=>e.type==='ready'));
  const initial=await page.evaluate(()=>({en:typeof window.EN,jquery:jQuery.fn.jquery,order:window.order,seed:localStorage.getItem('seed'),literal:document.getElementById('task-literal').textContent}));
  assert.equal(initial.en,'undefined');assert.equal(initial.jquery,'1.6.2');assert.equal(initial.seed,'stored');assert.equal(initial.literal,'001 конь6 & text');assert.deepEqual(initial.order,lifecycle?['task:1.6.2','message','ready:true']:['task:1.6.2','message']);
  const eventsBefore=await page.evaluate(()=>window.__harness.events.length);await page.evaluate(runtime);assert.equal(await page.evaluate(()=>window.__harness.events.length),eventsBefore,'fallback must not reinstall runtime');
  await page.evaluate(async()=>{await window.__enplus.updateTask('<div id="updated">Updated</div><script>window.order.push("update");</script>');});
  assert.equal(await page.locator('#updated').count(),lifecycle?0:1);
  assert.equal(await page.evaluate(()=>window.__harness.refreshRequests.length),lifecycle?1:0);
  await page.evaluate(()=>{localStorage.setItem('seed','changed');window.memory=99;});
  seed=await page.evaluate(()=>window.__harness.storage);html=await makePage('legacy-enplus-react-native',task,fixture(),'harness/snapshot-react-native');await page.reload();await page.waitForFunction(()=>window.__harness.events.some(e=>e.type==='ready'));
  assert.equal(await page.evaluate(()=>window.memory),1);assert.equal(await page.evaluate(()=>localStorage.getItem('seed')),'changed');assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);await page.close();
 }

 const renderer=await import('../harness/snapshot-react-native/renderer.mjs');
 async function rnPage(task,fixture={},dependencyFailure=false,mockReply='valid') {
  const page=await browser.newPage(),errors=[],resources=[],blocked=[];
  page.on('pageerror',error=>errors.push(error.message));
  let html=await makePage('legacy-enplus-react-native',task,fixture,'harness/snapshot-react-native');
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='fixture.en.cx'){blocked.push(url.href);return route.abort();}
   if(url.pathname==='/rn-host.js')return route.fulfill({contentType:'text/javascript',body:host});
   if(url.pathname==='/dependency.js'){await new Promise(resolve=>setTimeout(resolve,60));resources.push(dependencyFailure?'error':'load');return dependencyFailure?route.fulfill({status:503,body:'expected fixture failure'}):route.fulfill({contentType:'text/javascript',body:'window.order.push("dependency");window.dep=true;'});}
   if(url.pathname==='/__mock/action'){const action=route.request().postDataJSON();await new Promise(resolve=>setTimeout(resolve,150));return route.fulfill({contentType:'application/json',body:JSON.stringify({requestId:mockReply==='wrong-id'?'wrong':action.requestId,ok:true,...(mockReply==='missing-json'?{}:{engineJson:{which:'late'}})})});}
   if(url.pathname.startsWith('/admin/games/levels/preview/'))return route.fulfill({contentType:'text/html',body:html});
   return route.abort();
  });
  await page.goto('https://fixture.en.cx/admin/games/levels/preview/42?level=1');await page.waitForFunction(()=>window.__harness.events.some(e=>e.type==='ready'));
  return {page,errors,resources,blocked,rebuild:async(nextTask,nextFixture)=>{html=await makePage('legacy-enplus-react-native',nextTask,nextFixture,'harness/snapshot-react-native');await page.reload();await page.waitForFunction(()=>window.__harness.events.some(e=>e.type==='ready'));}};
 }
 for(const failure of [false,true]) {
  const probe=await rnPage('<div id="dependency-target"></div><script>window.order=["task"];</script><script src="/dependency.js"></script><script>window.order.push("after:"+Boolean(window.dep));</script>',{},failure);
  assert.deepEqual(await probe.page.evaluate(()=>window.order),failure?['task','after:false']:['task','dependency','after:true']);
  assert.deepEqual(probe.resources,[failure?'error':'load']);assert.deepEqual(probe.blocked,[]);
  // A queue continuing after dependency error is not reported as a successful load.
  assert.equal(failure?probe.resources[0]==='error':probe.errors.length===0,true);await probe.page.close();
 }
 {
  const task='<div id="task-literal">Before</div><script>window.bonusTaskRuns=0;window.helpRuns=0;</script>';
  const replacement='<b>001 конь6 &amp; exact</b><img id="changed-image" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">';
  const help='<script>window.helpRuns++;document.getElementById("task-literal").innerHTML='+JSON.stringify(replacement)+';if(!localStorage.getItem("help-submitted")){localStorage.setItem("help-submitted","yes");var answer=document.getElementById("Answer");answer.value="synthetic-only";answer.form.submit();}</script>';
  const raw={BonusId:7,Number:1,Name:'Synthetic',Task:'<span id="bonus-task">Bonus</span><script>window.bonusTaskRuns++;</script>',Help:help,IsAnswered:false,Answer:null,Expired:false,SecondsToStart:0,SecondsLeft:60,AwardTime:60,Negative:false};
  const answered={...raw,IsAnswered:true,Answer:{Answer:'synthetic-only',Login:'Synthetic',AnswerDateTime:'2026-10-19T00:00:00Z'}};
  const probe=await rnPage(task,{bonuses:[renderer.serializers.serializeBonus(raw)]});
  assert.equal(await probe.page.evaluate(()=>window.bonusTaskRuns),1);assert.equal(await probe.page.evaluate(()=>window.helpRuns),0);
  const bonus=renderer.serializers.serializeBonus(answered);assert.ok(!bonus.task.includes('<script>'));assert.ok(bonus.help.includes('<script>'));
  const hint=renderer.serializers.serializeHint({HelpId:8,Number:1,HelpText:'<div id="hint">Hint</div><script>window.hintRuns=(window.hintRuns||0)+1;</script>',RemainSeconds:0});
  await probe.page.evaluate(async data=>{await window.__enplus.updateHints({hints:[data.hint],penaltyHints:[]});await window.__enplus.updateBonuses([data.bonus]);},{hint,bonus});
  await probe.page.waitForFunction(()=>window.__harness.actions.length===1);
  assert.equal(await probe.page.evaluate(()=>window.hintRuns),1);assert.equal(await probe.page.evaluate(()=>window.bonusTaskRuns),1);assert.equal(await probe.page.evaluate(()=>window.helpRuns),1);
  assert.equal(await probe.page.locator('#task-literal').innerHTML(),replacement);
  const seed=await probe.page.evaluate(()=>window.__harness.storage);
  await probe.rebuild(task,{bonuses:[bonus],hints:[hint],authorStorageSeed:seed});
  assert.equal(await probe.page.evaluate(()=>window.helpRuns),1);assert.equal(await probe.page.evaluate(()=>window.bonusTaskRuns),0);assert.equal(await probe.page.evaluate(()=>window.__harness.actions.length),0,'storage guard prevents duplicate submission after rebuild');
  assert.equal(await probe.page.locator('#task-literal').innerHTML(),replacement);assert.deepEqual(probe.errors,[]);await probe.page.close();
 }
 {
  const probe=await rnPage('<div>Proxy fixture</div>');
  const result=await probe.page.evaluate(async()=>{
   const seen=[],xhr=new XMLHttpRequest();xhr.onload=()=>seen.push(JSON.parse(xhr.responseText).which);
   xhr.open('GET','?json=1');xhr.send();const first=window.__harness.events.filter(e=>e.type==='engineJsonRequest').at(-1).requestId;
   xhr.open('GET','?json=1');xhr.send();const second=window.__harness.events.filter(e=>e.type==='engineJsonRequest').at(-1).requestId;
   window.__enplus.resolveEngineJsonRequest(first,{which:'STALE'});await Promise.resolve();const afterStale=seen.slice();
   window.__enplus.resolveEngineJsonRequest(second,{which:'FRESH'});await new Promise(resolve=>setTimeout(resolve,10));
   const before=window.__harness.events.length;window.ReactNativeWebView.postMessage(JSON.stringify({type:'answerCodeSubmit',code:'must-ignore',documentToken:999999}));
   return {afterStale,seen,staleDocumentIgnored:window.__harness.events.length===before};
  });
  assert.deepEqual(result,{afterStale:[],seen:['FRESH'],staleDocumentIgnored:true});await probe.page.close();
 }

 for(const failure of ['missing-json','wrong-id']) {
  const probe=await rnPage('<div>Proxy error fixture</div>',{},false,failure);
  const observed=await probe.page.evaluate(async()=>{let rejected;try{await fetch('?json=1');}catch(error){rejected=error.message;}return {rejected,results:window.__harness.results};});
  assert.equal(observed.results.length,1);assert.ok(observed.results[0].error);assert.equal(observed.results[0].ok,undefined);assert.ok(observed.rejected);
  assert.match(observed.results[0].error,failure==='missing-json'?/engineJson response not supplied/:/Mismatched RN request ID/);
  await probe.page.close();
 }
 const page=await browser.newPage();
 const fixture='<div class="task"><div id="result">Before</div></div><form method="post"><input type="hidden" name="LevelId" value="12"><input type="hidden" name="LevelNumber" value="1"><input name="LevelAction.Answer"><button type="submit">Send</button></form><script>window.jQuery={fn:{jquery:"1.6.2"}};window.submits=0;document.forms[0].onsubmit=e=>{e.preventDefault();window.submits++;document.getElementById("result").textContent="After";};</script>';
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:fixture}));await page.goto('https://fixture.en.cx/admin/games/levels/preview/42?level=1');
 const base={expectedUrl:page.url(),gameId:42,levelNumber:1,session:'synthetic-session-1234'};
 const command=body=>page.evaluate(legacyPreviewPageCommand,{...base,...body});
 assert.equal((await command({kind:'start'})).runtimeDetected,true);
 const submitted=await command({kind:'answer',value:'001 конь6 '});assert.equal(submitted.outcome,'unknown');assert.equal(await page.evaluate(()=>window.submits),1);
 assert.equal((await command({kind:'observe',selector:'#result'})).text,'After');
 await assert.rejects(command({kind:'answer',value:'001 конь6 '}),/unknown/);assert.equal(await page.evaluate(()=>window.submits),1);
 await assert.rejects(command({kind:'observe',selector:'body'}),/outside/);await command({kind:'stop'});await command({kind:'start'});await assert.rejects(command({kind:'answer',value:'no-repeat'}),/unknown/);assert.equal(await page.evaluate(()=>window.submits),1);await command({kind:'stop'});await page.close();
 console.log('Actual RN inline/fallback, Task/Hint/Message/Bonus Help, dependencies load/error/order, storage/rebuild, stale IDs and synthetic legacy exactly-once controller passed. Device and live verdicts unverified.');
} finally {await browser.close();}
