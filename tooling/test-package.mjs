import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const temp=await mkdtemp(join(tmpdir(),'en-skills-consumer-'));
const npmCli=process.env.npm_execpath;
if (!npmCli) throw new Error('Run through npm run test:package');
function run(args,cwd=root) {
  const result=spawnSync(process.execPath,args,{cwd,encoding:'utf8'});
  if (result.status!==0) throw new Error(result.stderr || result.stdout || 'Command failed');
  return result.stdout;
}
const packed=JSON.parse(run([npmCli,'pack','--ignore-scripts','--json','--pack-destination',temp]));
const item=Array.isArray(packed) ? packed[0] : packed["@encounter-author/tools"];
const paths=new Set(item.files.map(file=>file.path));
for(const name of ['google','google-auth','sheets-client'])for(const ext of ['js','d.ts'])assert.ok(!paths.has('dist/'+name+'.'+ext),'Retired Google adapter leaked into package');
for(const file of ['dist/skills/google-documents/SKILL.md','dist/skills/google-documents/references/google-documents.md'])assert.ok(paths.has(file),'Missing browser workflow: '+file);
for(const match of (await readFile(join(root,'README.md'),'utf8')).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
  const target=match[1].split('#')[0];
  if(!target || /^[a-z][a-z0-9+.-]*:/i.test(target))continue;
  assert.ok(paths.has(decodeURIComponent(target).replace(/^\.\//,'')),'README link missing from npm package: '+target);
}
if (!paths.has('dist/knowledge/authoring-rules.json') || paths.has('knowledge/authoring-rules.json')) throw new Error('Expected generated catalog only');
if (paths.has('harness/engine/shell.html') || paths.has('harness/engine/shell-mobile.html') || paths.has('harness/browser-runner.mjs') || !paths.has('tooling/pack-webview.mjs') || !paths.has('harness/engine/manifest.json') || !paths.has('knowledge/engine-task-contract.md')) throw new Error('Engine fixture/contract missing from package');
if(!paths.has('harness/engine-preview/run.mjs')||!paths.has('harness/engine-preview/contract.mjs')||!paths.has('harness/engine-preview/page.mjs')||paths.has('harness/snapshot/engine-api.js'))throw new Error('Native preview harness missing or obsolete engine adapter distributed');
if(!paths.has('harness/announcement/run.mjs') || !paths.has('harness/announcement/fixture.json') || !paths.has('dist/skills/game-announcement/SKILL.md')) throw new Error('Announcement package missing');
if(!paths.has('dist/recalculation-cli.js') || !paths.has('dist/skills/game-recalculation/scripts/math_check.py') || !paths.has('node_modules/@encounter-api/sdk/dist/index.js')) throw new Error('Recalculation/standalone bundled SDK missing');
const runtimeFiles=[
  'dist/authoring-contracts.js','dist/authoring-contracts.d.ts',
  'dist/engine-profile.js','dist/authoring-api.js','dist/authoring-factory.js',
  'dist/node-legacy-session.js','dist/legacy-recipe-guard.js','dist/legacy-authoring.js',
  'dist/legacy-answer-move.js','dist/legacy-answer-move.d.ts','dist/legacy-files.js','dist/legacy-answers.js','dist/legacy-sectors.js','dist/legacy-bonuses.js','dist/authoring-export.js','dist/legacy-command-batch.js','dist/node-batch-journal.js',
  'harness/profiles.mjs','harness/page.mjs','harness/rn-host.js','harness/runtime-update.mjs',
  'harness/engine-preview/legacy-page.mjs','harness/engine-preview/legacy-page.d.mts',
  'harness/snapshot-react-native/manifest.json','harness/snapshot-react-native/renderer.mjs',
  'harness/snapshot-react-native/enplus-injected.js','harness/snapshot-react-native/enplus.css',
  'harness/example-react-native.html','harness/scenario-react-native.json',
  'knowledge/scripting/common.md','knowledge/scripting/legacy-enplus-react-native.md',
];
for(const file of runtimeFiles)if(!paths.has(file))throw new Error('Dual-engine runtime package file missing: '+file);
const tarball=join(temp,item.filename);
await writeFile(join(temp,'package.json'),JSON.stringify({private:true,type:'module'}));
run([npmCli,'install','--ignore-scripts','--offline','--no-audit','--no-fund',tarball],temp);
run(['--input-type=module','-e',`
import assert from 'node:assert/strict';
import * as api from '@encounter-author/tools';
for(const name of ['GoogleOAuth','GoogleSources','SheetsClient'])assert.equal(name in api,false);
import { EncounterClient, GoogleVisionOcr, loadSkill, loadSkillReference, skillNames, suggestCodeVariants, meanSeconds, resolveEngineProfile, captureAuthoringExport, prepareLegacyCommandBatch, createFileLegacyBatchJournal } from '@encounter-author/tools';
import {legacyBonusOperationSpecs,compileTransfer,verifyAdminBatch,compareCodes,dimensions} from '@encounter-author/tools/authoring-contracts';
assert.deepEqual(compareCodes(['001'],[]),[{code:'001',matches:[]}]);assert.equal(typeof dimensions,'function');
assert.equal(legacyBonusOperationSpecs.length,3);assert.equal(typeof compileTransfer,'function');assert.equal(typeof verifyAdminBatch,'function');
assert.equal(typeof EncounterClient,'function');
assert.equal(resolveEngineProfile('demo.en.cx').runtime,'modern-enplus-kotlin');
assert.equal(resolveEngineProfile('fixture.en.cx').runtime,'legacy-enplus-react-native');
for(const fn of [captureAuthoringExport,prepareLegacyCommandBatch,createFileLegacyBatchJournal])assert.equal(typeof fn,'function');
assert.equal(meanSeconds([60,120,180]).value,120);
assert.equal(typeof GoogleVisionOcr,'function');
await loadSkill('google-documents');
await loadSkillReference('google-documents','google-documents.md');
for (const name of skillNames) assert.match((await loadSkill(name)).instructions,/name:/);
assert.match(await loadSkillReference('check-code-photos','code-marking.md'),/кон66/);
assert.match(await loadSkillReference('game-announcement','announcement-workflow.md'),/poster.png/);
assert.ok((await loadSkillReference('level-script','scripting/common.md')).length>0);
assert.ok(suggestCodeVariants('конь6').variants.some(v=>v.code==='кон66'));
`],temp);
const output=JSON.parse(run([join(temp,'node_modules/@encounter-author/tools/dist/cli.js'),'checklist'],temp));
const canonicalCatalog=JSON.parse(await readFile(join(root,'dist/knowledge/authoring-rules.json'),'utf8'));
assert.deepEqual(output.rules,canonicalCatalog.rules.map(rule=>({...rule,status:'not-checked',evidence:null})),'Installed checklist must preserve the complete canonical catalog');
await writeFile(join(temp,'consumer.ts'), "import { EncounterClient, PublicGoogleSources, loadSkill, type OcrProvider } from '@encounter-author/tools';\nconst c: EncounterClient = new EncounterClient({domain:'demo.en.cx',token:()=> 'synthetic-token'});\nvoid c; void PublicGoogleSources; void loadSkill;\n");
run([join(root,'node_modules/typescript/bin/tsc'),'--ignoreConfig','--noEmit','--strict','--target','ES2024','--module','NodeNext','consumer.ts'],temp);
if(process.env.EN_SCRIPT_TEST_CHANNEL) run([join(temp,'node_modules/@encounter-author/tools/harness/run.mjs'),'--channel',process.env.EN_SCRIPT_TEST_CHANNEL,'--out',join(temp,'script-results')],temp);
if(process.env.EN_SCRIPT_TEST_CHANNEL) run([join(temp,'node_modules/@encounter-author/tools/harness/run.mjs'),'--profile','legacy-enplus-react-native','--channel',process.env.EN_SCRIPT_TEST_CHANNEL,'--out',join(temp,'script-results-react-native')],temp);
if(process.env.EN_SCRIPT_TEST_CHANNEL) run([join(temp,'node_modules/@encounter-author/tools/harness/announcement/run.mjs'),'--channel',process.env.EN_SCRIPT_TEST_CHANNEL,'--out',join(temp,'announcement-results')],temp);
console.log(JSON.stringify({installed:true,skills:(await readdir(join(root,'dist/skills'))).length,checklistRules:canonicalCatalog.rules.length,tarball,consumer:temp},null,2));
