#!/usr/bin/env node
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,realpath} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import assert from 'node:assert/strict';
import {makeAnnouncementPage} from './page.mjs';
const here=fileURLToPath(new URL('.',import.meta.url));
const {values}=parseArgs({options:{html:{type:'string'},scenario:{type:'string'},assets:{type:'string'},out:{type:'string'},channel:{type:'string'},serve:{type:'boolean'},headed:{type:'boolean'}}});
const out=resolve(values.out??'.local/announcement-check');
const author=await readFile(resolve(values.html??join(here,'example.html')),'utf8');
const scenario=values.scenario?JSON.parse(await readFile(resolve(values.scenario),'utf8')):values.html?{steps:[]}:JSON.parse(await readFile(join(here,'scenario.json'),'utf8'));
if(!Array.isArray(scenario.steps))throw new Error('scenario.steps must be an array');
for(const step of scenario.steps){
 if(!step || typeof step!=='object' || Object.keys(step).some(k=>!['click','fill','press','expectText','expectVisible'].includes(k)))throw new Error('Unknown scenario step');
 if(step.click && typeof step.click!=='string')throw new Error('click must be a selector');
 if(step.fill && (typeof step.fill.selector!=='string'||typeof step.fill.value!=='string'))throw new Error('fill requires selector/value');
 if(step.press && (typeof step.press.selector!=='string'||typeof step.press.key!=='string'))throw new Error('press requires selector/key');
 if(step.expectText && (typeof step.expectText.selector!=='string'||typeof step.expectText.text!=='string'))throw new Error('expectText requires selector/text');
 if(step.expectVisible && typeof step.expectVisible!=='string')throw new Error('expectVisible must be a selector');
 if(!Object.keys(step).length)throw new Error('Empty scenario step');
}
const html=await makeAnnouncementPage(author);
const engine=await realpath(join(here,'../engine'));
const assetRoot=values.assets?await realpath(resolve(values.assets)):null;
const manifest=JSON.parse(await readFile(join(here,'manifest.json'),'utf8'));
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.woff2':'font/woff2','.woff':'font/woff'};
const server=createServer(async(req,res)=>{
 try{
  res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'");
  const url=new URL(req.url,'http://localhost');
  if(req.method!=='GET' && req.method!=='HEAD'){res.writeHead(405).end();return;}
  if(url.pathname==='/games/900001'){res.writeHead(200,{'Content-Type':types['.html']}).end(html);return;}
  if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  let path,base;
  const fixed={'/announcement-assets/layout.css':join(here,'layout.css'),'/announcement-assets/site.css':join(engine,'style-1.css'),'/announcement-assets/site-fonts.css':join(engine,'style-0.css')};
  if(fixed[url.pathname]){path=fixed[url.pathname];base=url.pathname.endsWith('layout.css')?here:engine;}
  else if(url.pathname.startsWith('/engine-assets/assets/')){base=join(engine,'assets');path=resolve(base,decodeURIComponent(url.pathname.slice('/engine-assets/assets/'.length)));}
  else if(assetRoot && url.pathname.startsWith('/author-assets/')){base=assetRoot;path=resolve(base,decodeURIComponent(url.pathname.slice('/author-assets/'.length)));}
  else{res.writeHead(404).end();return;}
  const actual=await realpath(path),root=await realpath(base);
  if(!actual.startsWith(root+sep)){res.writeHead(403).end();return;}
  const body=await readFile(actual);
  res.writeHead(200,{'Content-Type':types[extname(actual)]??'application/octet-stream'}).end(req.method==='HEAD'?undefined:body);
 }catch(error){res.writeHead(error.code==='ENOENT'?404:500).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const url=origin+'/games/900001';
if(values.serve){
 console.log(JSON.stringify({url,coverage:manifest.coverage,note:'Resize the browser for mobile/desktop. Ctrl+C to stop.'},null,2));
 await new Promise(r=>{process.once('SIGINT',r);process.once('SIGTERM',r);});
 server.closeAllConnections();await new Promise(r=>server.close(r));process.exit(0);
}
const report={createdAt:new Date().toISOString(),surface:'game-page-announcement',manifest,interactionSteps:scenario.steps.length,
 limitations:[...manifest.limitations,...(scenario.steps.length?[]:['No interaction scenario supplied; only load/layout checked.'])],runs:[]};
let browser;
try{
 await mkdir(out,{recursive:true});
 browser=await chromium.launch({headless:!values.headed,...(values.channel?{channel:values.channel}:{})});
 for(const profile of [{name:'desktop',width:1280,height:900,hasTouch:false},{name:'mobile',width:390,height:844,hasTouch:true}]){
  const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},hasTouch:profile.hasTouch,isMobile:profile.hasTouch,serviceWorkers:'block'});
  const errors=[],blocked=[];
  const run={profile:profile.name,viewport:{width:profile.width,height:profile.height},passed:false,errors,blocked,steps:[]};
  await context.route('**/*',route=>{const target=route.request().url();if(target.startsWith(origin+'/'))return route.continue();blocked.push(target);return route.abort();});
  await context.routeWebSocket(/.*/,ws=>{blocked.push('WebSocket');ws.close();});
  await context.addInitScript(()=>{
   window.__announcementErrors=[];
   addEventListener('error',e=>window.__announcementErrors.push(e.message||'Resource failed'));
   addEventListener('unhandledrejection',e=>window.__announcementErrors.push(String(e.reason)));
   document.addEventListener('securitypolicyviolation',e=>window.__announcementErrors.push('CSP: '+e.violatedDirective+' '+e.blockedURI));
  });
  const page=await context.newPage();page.setDefaultTimeout(5000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url());});
  const id=profile.name;
  await context.tracing.start({screenshots:true,snapshots:true});
  try{
   await page.goto(url,{waitUntil:'networkidle'});
   await page.evaluate(()=>document.fonts.ready);
   await page.screenshot({path:join(out,id+'-before.png'),fullPage:true});
   assert.equal(await page.evaluate(()=>typeof window.EN),'undefined','Announcement must not depend on a gameplay API');
   for(const step of scenario.steps){
    if(step.fill)await page.locator(step.fill.selector).fill(step.fill.value);
    if(step.click){const el=page.locator(step.click);if(profile.hasTouch)await el.tap();else await el.click();}
    if(step.press)await page.locator(step.press.selector).press(step.press.key);
    if(step.expectVisible)await page.locator(step.expectVisible).waitFor({state:'visible'});
    if(step.expectText)await page.waitForFunction(({selector,text})=>document.querySelector(selector)?.textContent===text,step.expectText);
    run.steps.push({passed:true});
   }
   const metrics=await page.evaluate(()=>{
    const host=document.querySelector('[data-announcement-host]');
    return {pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,hostWidth:host.clientWidth,hostScroll:host.scrollWidth,brokenImages:[...host.querySelectorAll('img')].filter(x=>!x.complete||x.naturalWidth===0).length,errors:window.__announcementErrors};
   });
   run.metrics=metrics;
   assert.ok(metrics.pageWidth<=metrics.viewport+1,'Page overflows viewport horizontally');
   assert.ok(metrics.hostScroll<=metrics.hostWidth+1,'Announcement overflows its container horizontally');
   assert.equal(metrics.brokenImages,0,'Broken announcement images');
   assert.deepEqual(metrics.errors,[],'Unhandled error or CSP violation');
   assert.deepEqual(errors,[],'Browser errors');
   assert.deepEqual(blocked,[],'External network blocked');
   run.passed=true;
  }catch(error){run.failure=error.message;process.exitCode=1;}
  finally{
   await page.screenshot({path:join(out,id+'-after.png'),fullPage:true}).catch(()=>{});
   await context.tracing.stop({path:join(out,id+'-trace.zip')});
   report.runs.push(run);await context.close();
  }
 }
}finally{
 await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));
 await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({out,coverage:manifest.coverage,runs:report.runs.map(({profile,passed,failure})=>({profile,passed,failure}))},null,2));
