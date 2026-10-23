#!/usr/bin/env node
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';
import { makePage } from './page.mjs';
import { runtimeProfiles } from './profiles.mjs';
import {validateHarnessRequest} from './render.mjs';
import {applyRuntimeUpdate} from './runtime-update.mjs';
const here=fileURLToPath(new URL('.',import.meta.url));
const {values}=parseArgs({options:{html:{type:'string'},scenario:{type:'string'},out:{type:'string'},snapshot:{type:'string'},profile:{type:'string'},headed:{type:'boolean'},channel:{type:'string'},serve:{type:'boolean'}}});
const profile=values.profile??'modern-enplus-kotlin';
if(!runtimeProfiles[profile])throw new Error('Unsupported runtime profile');
const legacy=profile==='legacy-enplus-react-native';
const mode=legacy?profile:'enplus';
const snapshot=resolve(values.snapshot??join(here,runtimeProfiles[profile].directory));
const out=resolve(values.out??'.local/script-check');
await mkdir(out,{recursive:true});
const author=await readFile(resolve(values.html??join(here,legacy?'example-react-native.html':'example.html')),'utf8');
const scenario=JSON.parse(await readFile(resolve(values.scenario??join(here,legacy?'scenario-react-native.json':'scenario.json')),'utf8'));
if((!legacy&&!scenario.state?.level) || !Array.isArray(scenario.steps) || !Array.isArray(scenario.responses))throw new Error('Invalid scenario');
validateHarnessRequest({kind:'script',profile,html:author,scenario});
const manifest=JSON.parse(await readFile(join(snapshot,'manifest.json'),'utf8'));
const engineRoot=join(here,'engine');
const pages={[mode]:await makePage(mode,author,scenario,snapshot)};
let state=structuredClone(scenario.state),requests=[];
const server=createServer(async(req,res)=>{
  try{
    res.setHeader('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; object-src 'none'");
    const url=new URL(req.url,'http://localhost');
    if(req.method==='POST' && url.pathname==='/__mock/action'){
      let body='';for await(const chunk of req){body+=chunk;if(body.length>65536){res.writeHead(413).end();return;}}
      const action=JSON.parse(body);requests.push(action);
      const rule=scenario.responses.find(r=>r.code===action.answer && (!r.action || r.action===action.action))??{ok:false};
      if(rule.delayMs)await new Promise(r=>setTimeout(r,Math.min(rule.delayMs,10000)));
      if(rule.httpStatus){res.writeHead(rule.httpStatus).end();return;}
      if(!legacy && rule.ok===true && rule.sectorId){
        const sector=state.level?.sectors?.find(s=>s.id===rule.sectorId);
        if(sector){sector.isAnswered=true;sector.answer=action.answer;sector.answeredBy='SyntheticPlayer';sector.answeredAt=Date.now();}
        state.level.sectorsLeft=state.level.sectors.filter(s=>!s.isAnswered).length;
      }
      if(rule.snapshot)state=structuredClone(rule.snapshot);
      res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({requestId:action.requestId,ok:rule.ok??null,engineJson:rule.engineJson,snapshot:state,serverTimeMs:Date.now()}));return;
    }
    if(url.pathname==='/'+mode){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(pages[mode]);return;}
    let path;
    if(url.pathname==='/host.js')path=join(here,'host.js');
    else if(url.pathname==='/rn-host.js')path=join(here,'rn-host.js');
    else if(url.pathname.startsWith('/engine-assets/')){
      path=resolve(engineRoot,decodeURIComponent(url.pathname.slice('/engine-assets/'.length)));
      if(!path.startsWith(engineRoot+sep)){res.writeHead(403).end();return;}
    }
    else if(url.pathname.startsWith('/snapshot/')){
      path=resolve(snapshot,decodeURIComponent(url.pathname.slice(10)));
      if(!path.startsWith(snapshot+sep)){res.writeHead(403).end();return;}
    }else{res.writeHead(404).end();return;}
    const types={'.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.gif':'image/gif'};
    res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream'}).end(await readFile(path));
  }catch{if(!res.headersSent)res.writeHead(500);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
if(values.serve){
  console.log(JSON.stringify({profile,url:origin+'/'+mode,note:'EN+ test bridge only. Native Encounter checks use en-engine-check --url. Ctrl+C to stop.'},null,2));
  await new Promise(done=>{process.once('SIGINT',done);process.once('SIGTERM',done);});
  await new Promise(done=>server.close(done));process.exit(0);
}
const report={builtAt:new Date().toISOString(),backend:profile+'-test-bridge',profile,runtime:manifest,
  limitations:['Chromium simulation, not Android device/WebView certification.','EN+ runtime uses a synthetic native bridge and mock responses.','Native Encounter runtime is checked separately on its /preview page.'],runs:[]};
let browser;
try{
  browser=await chromium.launch({headless:!values.headed,...(values.channel?{channel:values.channel}:{})});
  for(const mode of [legacy?profile:'enplus']){
    for(const viewport of [{width:1280,height:800},{width:390,height:844}]){
      state=structuredClone(scenario.state);requests=[];
      const context=await browser.newContext({viewport,serviceWorkers:'block'});
      const blocked=[],errors=[];
      await context.route('**/*',route=>{
        const url=route.request().url();
        if(url.startsWith(origin+'/'))return route.continue();
        blocked.push(url);return route.abort();
      });
      await context.routeWebSocket(/.*/,ws=>ws.close());
      const page=await context.newPage();page.setDefaultTimeout(7000);
      page.on('response',r=>{if(r.status()>=400 && !new URL(r.url()).pathname.startsWith('/__mock/') && !r.url().endsWith('/favicon.ico')) errors.push('Resource HTTP '+r.status()+': '+r.url());});
      page.on('pageerror',error=>errors.push(error.message));
      page.on('console',message=>{if(message.type()==='error' && !message.text().startsWith('Failed to load resource:'))errors.push(message.text());});
      const id=mode+'-'+viewport.width;
      await context.tracing.start({screenshots:true,snapshots:true});
      const run={mode,viewport,passed:false,errors,blocked,steps:[]};
      try{
        let currentAuthor=author,currentFixture=structuredClone(scenario);
        pages[mode]=await makePage(mode,currentAuthor,currentFixture,snapshot);
        await page.goto(origin+'/'+mode);
        await page.waitForFunction(legacy=>legacy?window.__harness?.events.some(event=>event.type==='ready'):window.EN?.getState()?.level && document.body.style.visibility!=='hidden',legacy);
        await page.screenshot({path:join(out,id+'-before.png'),fullPage:true});
        for(const step of scenario.steps){
          let before=await page.evaluate(()=>window.__harness.actions.length);
          if(step.update){await page.evaluate(applyRuntimeUpdate,step.update);if(step.update.section==='task')currentAuthor=step.update.data;else currentFixture[step.update.section]=step.update.section==='hints'?[...step.update.data.hints,...step.update.data.penaltyHints]:step.update.data;}
          if(step.rebuild){const storage=await page.evaluate(()=>window.__harness.storage);currentAuthor=step.rebuild.taskHtml??currentAuthor;currentFixture={...currentFixture,...step.rebuild.fixture,authorStorageSeed:step.rebuild.preserveStorage===false?{}:storage,documentToken:(currentFixture.documentToken??1)+1};pages[mode]=await makePage(mode,currentAuthor,currentFixture,snapshot);await page.reload();await page.waitForFunction(()=>window.__harness?.events.some(event=>event.type==='ready'));before=0;}
          if(step.click)await page.locator(step.click).click();
          else if(step.press){await page.locator(step.press.selector).press(step.press.key);}
          else if(step.fill){await page.locator(step.fill.selector).fill(step.fill.value);}
          else if(step.form){
            if(mode==='enplus')await page.locator(step.form+' input[type="text"]').evaluate((input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));},step.code);
            else await page.locator(step.form+' input[type="text"]').fill(step.code);
            if(step.directSubmit)await page.locator(step.form).evaluate(f=>f.submit());
            else await page.locator(step.form+' button[type="submit"]').click();
          }else if(step.code!==undefined){
            await page.locator('#harness-input').fill(step.code);
            await page.locator('#harness-send').click();
          }
          if(Object.hasOwn(step,'expectOk')||step.expectError){
          await page.waitForFunction(n=>window.__harness.results.length>n,before);
          const captured=await page.evaluate(()=>({actions:window.__harness.actions,results:window.__harness.results}));
          assert.equal(captured.actions.length,before+1,'One interaction must send exactly one action');
          const last=captured.results.at(-1);
          if(step.expectError)assert.ok(last.error,'Expected error');
          else assert.equal(last.ok,step.expectOk,'Unexpected verdict');
          }
          if(step.expectActionCount!==undefined)assert.equal(await page.evaluate(()=>window.__harness.actions.length),step.expectActionCount,'Unexpected current-document action count');
          if(step.expectRefreshRequests!==undefined)assert.equal(await page.evaluate(()=>window.__harness.refreshRequests.length),step.expectRefreshRequests,'Unexpected lifecycle refresh count');
          if(step.expectVisible)await page.locator(step.expectVisible).waitFor({state:'visible'});
          if(step.expectText)assert.equal(await page.locator(step.expectText.selector).textContent(),step.expectText.text);
          run.steps.push({passed:true,step});
        }
        assert.equal(errors.length,0,'Browser/runtime errors');
        assert.equal(blocked.length,0,'External resources blocked; use local/self-contained author assets');
        run.passed=true;
      }catch(error){run.failure=error.message;process.exitCode=1;}
      finally{
        run.requests=structuredClone(requests);
        run.evidence=await page.evaluate(()=>({events:window.__harness?.events,errors:window.__harness?.errors,state:window.EN?.getState(),messages:window.__harness?.events,storage:window.__harness?.storage,refreshRequests:window.__harness?.refreshRequests})).catch(()=>null);
        if(run.evidence?.errors?.length){run.passed=false;run.failure='Unhandled author/runtime error';process.exitCode=1;}
        await page.screenshot({path:join(out,id+'-after.png'),fullPage:true}).catch(()=>{});
        await context.tracing.stop({path:join(out,id+'-trace.zip')});
        report.runs.push(run);await context.close();
      }
    }
  }
}finally{
  await browser?.close();await new Promise(r=>server.close(r));
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));
}
console.log(JSON.stringify({out,runs:report.runs.map(({mode,viewport,passed,failure})=>({mode,width:viewport.width,passed,failure})),engineStyleCoverage:report.engineStyleCoverage},null,2));
