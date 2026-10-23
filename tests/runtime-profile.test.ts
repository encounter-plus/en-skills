import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,cp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateSnapshotManifest} from '../harness/profiles.mjs';
import {makePage} from '../harness/page.mjs';
import {parseLegacyPreviewUrl,runLegacyPreviewScenario} from '../harness/engine-preview/contract.mjs';
import {validateHarnessRequest} from '../harness/render.mjs';

test('snapshot identities reject cross-framework use, missing outputs and unsupported schema versions',async()=>{
 for(const [directory,profile,other] of [['snapshot','modern-enplus-kotlin','legacy-enplus-react-native'],['snapshot-react-native','legacy-enplus-react-native','modern-enplus-kotlin']]){
  const manifest=JSON.parse(await readFile('harness/'+directory+'/manifest.json','utf8'));
  assert.equal(manifest.schemaVersion,1);
  assert.equal(validateSnapshotManifest(manifest,profile),manifest);
  assert.throws(()=>validateSnapshotManifest(manifest,other),/mismatch/);
  assert.throws(()=>validateSnapshotManifest({...manifest,outputs:[]},profile),/mismatch/);
  for(const schemaVersion of [undefined,0,2,"1"])
   assert.throws(()=>validateSnapshotManifest({...manifest,schemaVersion},profile),/mismatch/);
  assert.throws(()=>validateSnapshotManifest({...manifest,distribution:undefined},profile),/mismatch/);
 }
});

test('RN shell uses real vendored jQuery/runtime with literal author HTML and no modern bootstrap',async()=>{
 const html=await makePage('legacy-enplus-react-native','<div id="literal">конь6 &amp; 001</div>',{authorStorageSeed:{key:'value'}},'harness/snapshot-react-native');
 assert.match(html,/1\.6\.2/);assert.ok(!html.includes('__initialEnState'));assert.ok(html.includes('literal'));assert.ok(html.includes('/rn-host.js'));
 await assert.rejects(makePage('legacy-enplus-react-native','',{},'harness/snapshot'),/mismatch/);
});

test('asset tampering is rejected before importing snapshot renderer',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'en-harness-hash-'));
 await cp('harness/snapshot-react-native',directory,{recursive:true});
 await writeFile(join(directory,'renderer.mjs'),'throw new Error("renderer must never execute");');
 await assert.rejects(makePage('legacy-enplus-react-native','',{},directory),/asset hash mismatch/);
});

test('RN document commands are data-only, profile-bound and shape checked',()=>{
 const base={kind:'script',profile:'legacy-enplus-react-native',html:'',scenario:{responses:[],steps:[]}};
 for(const step of [{update:{section:'task',data:'<div>literal</div>'}},{update:{section:'hints',data:{hints:[],penaltyHints:[]}}},{rebuild:{taskHtml:'<div>new document</div>',fixture:{messages:[]},preserveStorage:true}}]){
  assert.equal(validateHarnessRequest({...base,scenario:{responses:[],steps:[step]}}).profile,base.profile);
  assert.throws(()=>validateHarnessRequest({...base,profile:'modern-enplus-kotlin',scenario:{state:{game:{},level:{},levels:[]},responses:[],steps:[step]}}),/RN/);
 }
 for(const step of [{update:{section:'eval',data:'alert(1)'}},{update:{section:'hints',data:[]}},{rebuild:{fixture:{arbitraryCode:'alert(1)'}}},{rebuild:{preserveStorage:'yes'}},{update:{section:'task',data:''},rebuild:{}}])assert.throws(()=>validateHarnessRequest({...base,scenario:{responses:[],steps:[step]}}));
});

test('legacy preview URL is strict and scenarios reject invented API verdicts',async()=>{
 assert.equal(parseLegacyPreviewUrl('https://chelyabinsk.en.cx/admin/games/levels/preview/42?level=1').gameId,42);
 for(const url of ['https://demo.en.cx/admin/games/levels/preview/42?level=1','https://evil.test/admin/games/levels/preview/42?level=1','https://chelyabinsk.en.cx/admin/games/levels/preview/42?level=1&level=2'])assert.throws(()=>parseLegacyPreviewUrl(url));
 assert.throws(()=>runLegacyPreviewScenario(async()=>({}),{steps:[{answer:'001',expectOk:true}]}),/unverified/);
 let calls=0;
 const report=await runLegacyPreviewScenario(async command=>{if(command.kind==='answer'){calls++;throw new Error('outcome unknown');}return {runtimeDetected:true,errors:[]};},{steps:[{answer:'001',expectText:{selector:'#result',text:'done'}}]},{allowActions:true});
 assert.equal(calls,1);assert.equal(report.passed,false);assert.match(report.failure,/unknown/);
});
