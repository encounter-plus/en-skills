#!/usr/bin/env node
import { build, transform } from 'esbuild';
import { packWebview } from './pack-webview.mjs';
import { readFile, writeFile, mkdir, cp, readdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const {values}=parseArgs({options:{framework:{type:'string'},'enplus-root':{type:'string'},'out':{type:'string'},'engine-assets':{type:'string'},'engine-css':{type:'string',multiple:true}}});
if(!values['enplus-root']) throw new Error('Usage: --enplus-root PATH [--out PATH] [--engine-assets DIR --engine-css relative.css]');
const root=resolve(values['enplus-root']);
const framework=values.framework??'kotlin';
if(!['kotlin','react-native'].includes(framework))throw new Error('--framework must be kotlin or react-native');
const rn=framework==='react-native';
const base=rn?'src/components/game/unified-webview':'webview-runtime/src/unified-webview';
const tsconfig=join(root,rn?'tsconfig.json':'webview-runtime/tsconfig.json');
const out=resolve(values.out??fileURLToPath(new URL(rn?'../harness/snapshot-react-native':'../harness/snapshot',import.meta.url)));
await mkdir(out,{recursive:true});
await rm(join(out,'engine-api.js'),{force:true}); // Remove the obsolete EN+ adapter from refreshed snapshots.
const entry=`
export { buildInjectedJs } from './${base}/injected/index.ts';
export { buildGameHtml } from './${base}/build-html.ts';
${rn?`export * as commands from './${base}/command-builders.ts'; export * as serializers from './${base}/serializers.ts'; export { buildLevelTaskHtml } from './${base}/build-level-task-html.ts';`:`export { STATIC_CSS } from './${base}/styles.ts';`}
export { mockColors as colors, mockTranslations as translations } from './${base}/__fixtures__/webview-test-data.ts';
`;
const result=await build({stdin:{contents:entry,resolveDir:root,sourcefile:'snapshot-entry.ts',loader:'ts'},
  absWorkingDir:root,bundle:true,platform:'node',format:'esm',write:false,
  tsconfig,legalComments:'none',metafile:true,plugins:rn?[{name:'synthetic-translation-host',setup(build){build.onResolve({filter:/^@\/i18n$/},()=>({path:'harness-i18n',namespace:'synthetic'}));build.onLoad({filter:/.*/,namespace:'synthetic'},()=>({contents:"export default {language:'ru',t:(key)=>key};",loader:'js'}));}}]:[]});
// No absolute machine paths or source maps are embedded in the portable snapshot.
const moduleText=result.outputFiles[0].text;
const module=await import('data:text/javascript;base64,'+Buffer.from(moduleText).toString('base64'));
const injected=rn?module.buildInjectedJs():(await build({entryPoints:['webview-runtime/src/index.ts'],absWorkingDir:root,bundle:true,platform:'browser',format:'iife',globalName:'EnPlusInjectedRuntime',write:false,tsconfig,legalComments:'none'})).outputFiles[0].text;
const packed=await packWebview(moduleText,injected,Object.keys(module),module.buildInjectedJs());
await writeFile(join(out,'renderer.mjs'),packed.renderer);
await writeFile(join(out,'enplus-injected.js'),packed.injected);
await writeFile(join(out,'enplus.css'),rn?'/* RN CSS is supplied by its real buildGameHtml. */\n':(module.STATIC_CSS+'\n'+await readFile(join(root,'androidApp/src/main/assets/webview-author-controls.css'),'utf8')).replace(/\r\n/g,'\n').replace(/[ \t]+$/gm,''));
let engineStyles=[];
if(values['engine-assets']){
  const source=resolve(values['engine-assets']);
  engineStyles=values['engine-css']??[];
  if(!engineStyles.length) throw new Error('--engine-css required with --engine-assets (supply all styles in page order)');
  for(const name of engineStyles){
    if(!/^[a-zA-Z0-9_./-]+\.css$/.test(name)||name.split('/').includes('..')||name.startsWith('/')) throw new Error('Stylesheet paths must stay inside engine-assets');
    await readFile(join(source,name));
  }
  async function rejectLinks(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink())throw new Error('Symlinks are not supported in engine assets');if(e.isDirectory())await rejectLinks(join(dir,e.name));}}
  await rejectLinks(source);
  await cp(source,join(out,'engine'),{recursive:true});
}
await writeFile(join(out,'enplus.css'),(await transform(await readFile(join(out,'enplus.css'),'utf8'),{loader:'css',minify:true,legalComments:'none'})).code);
const outputs=['renderer.mjs','enplus-injected.js','enplus.css'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const hashes=Object.fromEntries(await Promise.all(outputs.map(async name=>[name,hash(await readFile(join(out,name)))])));
const inputs=Object.fromEntries(await Promise.all(Object.keys(result.metafile.inputs).filter(name=>name!=='snapshot-entry.ts'&&!name.startsWith('synthetic:')).map(async name=>[name.replaceAll('\\','/'),hash(await readFile(resolve(root,name)))])));
await writeFile(join(out,'manifest.json'),JSON.stringify({schemaVersion:1,distribution:'obfuscated',framework,engine:rn?'legacy':'modern',runtimeProfile:rn?'legacy-enplus-react-native':'modern-enplus-kotlin',source:{repository:rn?'en-plus':'en-plus-kotlin',revision:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['-C',root,'status','--porcelain'],{encoding:'utf8'}).trim(),inputs},hashes,jqueryVersion:rn?'1.6.2':null,bridgeSchema:rn?'ReactNativeWebView/__enplus':'enAction/window.EN',coverage:'synthetic host; device unverified',
  syntheticDependencies:rn?['i18n language=ru; translation labels return resource keys']:[],
  engineStyles,engineStyleCoverage:engineStyles.length?'provided-local-snapshot':'missing',
  theme:'synthetic dark palette from upstream fixture',outputs},null,2)+'\n');
console.log(JSON.stringify({out,engineStyles}));
