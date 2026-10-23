#!/usr/bin/env node
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {parseArgs} from 'node:util';
import {parsePreviewUrl,parseLegacyPreviewUrl,runLegacyPreviewScenario,validatePreviewScenario,runPreviewScenario} from './contract.mjs';
import {previewPageCommand} from './page.mjs';
import {legacyPreviewPageCommand} from './legacy-page.mjs';
import {resolveEngineProfile} from '../../dist/engine-profile.js';
const {values}=parseArgs({options:{url:{type:'string'},scenario:{type:'string'},out:{type:'string'},'storage-state':{type:'string'},'allow-actions':{type:'boolean'},headed:{type:'boolean'},channel:{type:'string'}}});
if(!values.url)throw new Error('Usage: en-engine-check --url https://DOMAIN.en.cx/admin/games/ID/levels/preview/NUMBER [--scenario scenario.json] [--storage-state private.json] [--allow-actions]');
const legacy=resolveEngineProfile(new URL(values.url).hostname).engine==='legacy';
const controller=legacy?legacyPreviewPageCommand:previewPageCommand;
const target=(legacy?parseLegacyPreviewUrl:parsePreviewUrl)(values.url),scenario=validatePreviewScenario(values.scenario?JSON.parse(await readFile(resolve(values.scenario),'utf8')):{steps:[]});
const out=resolve(values.out??'.local/engine-check');await mkdir(out,{recursive:true});
let browser,report;
try {
  browser=await chromium.launch({headless:!values.headed,...(values.channel?{channel:values.channel}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:800},...(values['storage-state']?{storageState:resolve(values['storage-state'])}:{})});
  const page=await context.newPage();
  await page.goto(target.url,{waitUntil:'domcontentloaded',timeout:30000});
  const session=crypto.randomUUID();let documentTime;
  const transport=async command=>{
    if(page.url()!==target.url)throw new Error('Preview navigation/login redirect; reconnect without retrying an action');
    const result=await page.evaluate(controller,{...command,expectedUrl:target.url,gameId:target.gameId,levelNumber:target.levelNumber,session,documentTime});
    documentTime??=result.documentTime;
    if(page.url()!==target.url)throw new Error('Preview navigated during action; outcome unknown');
    return result;
  };
  report=await (legacy?runLegacyPreviewScenario:runPreviewScenario)(transport,scenario,{allowActions:values['allow-actions']===true});
  await page.screenshot({path:join(out,'preview.png'),fullPage:true}).catch(()=>{});
} catch(error) {report={backend:'encounter-live-preview',runtimeDetected:false,runtimeVerified:false,passed:false,failure:String(error.message),steps:[]};}
finally {await browser?.close();}
await writeFile(join(out,'report.json'),JSON.stringify({...report,target,scenario},null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,runtimeVerified:report.runtimeVerified,report:join(out,'report.json'),failure:report.failure}));
if(!report.passed)process.exitCode=1;
