import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const temp=await mkdtemp(join(tmpdir(),'announcement-regression-'));
const runner=resolve('harness/announcement/run.mjs');
const channel=process.env.EN_SCRIPT_TEST_CHANNEL??'chrome';
const cases=[
 {name:'sample',html:null,exit:0},
 {name:'js-error',html:'<script>throw new Error("SYNTHETIC_JS_FAILURE")</script>',exit:1,reason:/SYNTHETIC_JS_FAILURE/},
 {name:'overflow',html:'<div style="width:2200px">Synthetic oversized content</div>',exit:1,reason:/overflow/i},
 {name:'local-assets',html:'<img alt="Synthetic" src="/author-assets/sample.svg"><script src="/author-assets/sample.js"></script>',exit:0},
 {name:'network',html:'<script>fetch("https://example.invalid/synthetic-test")</script>',exit:1,reason:/CSP|fetch|Content Security/i}
];
await writeFile(join(temp,'sample.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="green"/></svg>');
await writeFile(join(temp,'sample.js'),'document.body.dataset.syntheticLoaded="yes";');
for(const item of cases){
 const out=join(temp,item.name);
 const args=[runner,'--channel',channel,'--out',out];
 if(item.html!==null){const file=join(temp,item.name+'.html');await writeFile(file,item.html);args.push('--html',file);}
 if(item.name==='local-assets')args.push('--assets',temp);
 const result=spawnSync(process.execPath,args,{encoding:'utf8'});
 assert.equal(result.status,item.exit,result.stdout+result.stderr);
 const report=JSON.parse(await readFile(join(out,'report.json'),'utf8'));
 assert.equal(report.runs.length,2);
 if(item.reason)assert.match(JSON.stringify(report.runs),item.reason);
 else assert.ok(report.runs.every(r=>r.passed));
 console.log(item.name+': expected exit '+item.exit+' verified on desktop/mobile');
}
console.log('Evidence: '+temp);
