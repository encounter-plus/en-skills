// Render synthetic evidence with a local HTTP stylesheet. No Encounter access.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const evidence=resolve(process.argv[2]),out=join(evidence,'preview');await mkdir(out,{recursive:true});
const state=JSON.parse(await readFile(join(evidence,'state.json'),'utf8')),assets=Object.values(state.assets),level=state.levels.find(l=>l.level_name==='Нейродиалог 1');
let html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+state.messages.filter(m=>m.all_levels).map(m=>m.message_text).join('')+'</head><body>'+level.tasks.map(t=>t.task_text).join('')+'</body></html>';
// Map only URLs actually verified and returned by the synthetic uploader.
for(const [i,a] of assets.entries()){assert.ok(html.includes(a.url),'Uploaded URL must be connected in HTML');html=html.replaceAll(a.url,'/asset-'+i+'.css');}
let loaded=0;const server=createServer((req,res)=>{if(req.url==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(html);return;}const i=Number(/^\/asset-(\d+)\.css$/.exec(req.url??'')?.[1]);if(Number.isInteger(i)&&assets[i]){loaded++;res.writeHead(200,{'content-type':'text/css; charset=utf-8'}).end(assets[i].content);return;}res.writeHead(404).end();});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const origin='http://127.0.0.1:'+server.address().port;let browser;
try{browser=await chromium.launch({headless:true,channel:process.env.IMPORT_PREVIEW_CHANNEL??'chrome',timeout:60000});const page=await browser.newPage();const checks=[];
 for(const width of [1280,390]){await page.setViewportSize({width,height:800});await page.goto(origin,{waitUntil:'load',timeout:60000});const result=await page.evaluate(()=>({text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth,styles:[...document.querySelectorAll('[class]')].map(e=>({className:e.className,color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor,display:getComputedStyle(e).display}))}));assert.ok(result.text.includes('Почему звёзды мерцают?')&&result.text.includes('Из-за неоднородности атмосферы.'));assert.equal(result.overflow,false);assert.ok(result.styles.some(s=>s.color!=='rgb(0, 0, 0)'||!['rgba(0, 0, 0, 0)','rgb(255, 255, 255)'].includes(s.background)),'CSS must affect rendering');await page.screenshot({path:join(out,width+'.png'),fullPage:true});checks.push({width,...result});}
 assert.ok(loaded>=1);await writeFile(join(out,'report.json'),JSON.stringify({status:'passed',kind:'local-http-html-css-preview',realEngineVerified:false,loaded,checks},null,2));console.log('PASS synthetic preview '+out);
}finally{await browser?.close();server.closeAllConnections();await new Promise(ok=>server.close(ok));}
