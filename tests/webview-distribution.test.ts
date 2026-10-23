import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
// @ts-ignore JavaScript tooling module has no public declaration.
import {packWebview} from '../tooling/pack-webview.mjs';

test('packed renderer retains literal code strings and minified runtime behavior', async()=>{
 const literal='001 конь6 кон66 </script> \\n';
 const runtime=`globalThis.result=${JSON.stringify(literal)};`;
 const source=`export const buildGameHtml=html=>html;export const buildInjectedJs=()=>${JSON.stringify(runtime)};`;
 const packed=await packWebview(source,runtime,['buildGameHtml','buildInjectedJs'],runtime);
 const renderer=await import('data:text/javascript;base64,'+Buffer.from(packed.renderer).toString('base64'));
 assert.equal(renderer.buildGameHtml(literal),literal);
 const context: Record<string,unknown>={TextDecoder,atob};
 new Script(renderer.buildInjectedJs()).runInNewContext(context);
 assert.equal(context.result,literal);
 assert.equal(renderer.buildInjectedJs(),packed.injected);
});

test('both distributed WebViews contain only packed renderers and no source maps', async()=>{
 for(const directory of ['snapshot','snapshot-react-native']){
  const base='harness/'+directory+'/';
  const manifest=JSON.parse(await readFile(base+'manifest.json','utf8'));
  assert.equal(manifest.distribution,'obfuscated');
  const renderer=await readFile(base+'renderer.mjs','utf8');
  assert.match(renderer,/gunzipSync/);
  assert.doesNotMatch(renderer,/\/\/ (?:webview-runtime\/src|src\/components)\//);
  const injected=await readFile(base+'enplus-injected.js','utf8');
  assert.doesNotMatch(injected,/Late-loaded script support|Capture native function|const origDocAdd/);
  assert.ok(injected.trim().split('\n').length===1);
  for(const file of manifest.outputs){
   assert.ok(!file.endsWith('.map'));
   assert.doesNotMatch(await readFile(base+file,'utf8'),/sourceMappingURL=/);
  }
 }
});

test('renderer builder keeps its inner runtime distinct from the browser installer',async()=>{
 const inner='globalThis.innerReady=true;',outer='globalThis.outerReady=true;';
 const source=`export const buildInjectedJs=()=>${JSON.stringify(inner)};`;
 const packed=await packWebview(source,outer,['buildInjectedJs'],inner);
 const renderer=await import('data:text/javascript;base64,'+Buffer.from(packed.renderer).toString('base64'));
 const innerContext:Record<string,unknown>={TextDecoder,atob};
 new Script(renderer.buildInjectedJs()).runInNewContext(innerContext);
 assert.equal(innerContext.innerReady,true);
 assert.equal(innerContext.outerReady,undefined);
 const outerContext:Record<string,unknown>={TextDecoder,atob};
 new Script(packed.injected).runInNewContext(outerContext);
 assert.equal(outerContext.outerReady,true);
 assert.equal(outerContext.innerReady,undefined);
});
