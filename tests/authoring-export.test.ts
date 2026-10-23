import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureAuthoringExport} from '../src/authoring-export.ts';
import {authoringMetadata,authoringBinding,AuthoringApiError,type AuthoringApiPort} from '../src/authoring-api.ts';
import {parseLegacyFileReferences,parseLegacyScenarioExport} from '../src/legacy-files.ts';
const binding=authoringBinding('fixture.en.cx',42,'opaque-test-session');

test('export keeps literal captured data and unsupported drafts without claiming a backup or migration',async()=>{
 const requests:string[]=[],literal=' 001 Конь6\n<script>window.x="&quot;";</script> ';
 const api:AuthoringApiPort={metadata:authoringMetadata(binding,['game-read','level-index','task-read']),invalidate(){},async request(path,init){assert.equal(init?.method,'GET');requests.push(path);if(path.endsWith('/files')||path.endsWith('/scenario-export'))throw new AuthoringApiError('unsupported');if(path.endsWith('/levels'))return Response.json({levels:[{level_id:1,level_number:1},{level_id:2,level_number:2}]});if(path.endsWith('/editor'))return Response.json({tasks:[{task_id:11,task_text:literal}],helps:[]});return Response.json({game:{id:42,descr:literal},presentation:{important:{state:'unknown'},poster:{state:'unsupported'}}});}};
 const drafts={important:{state:'unsupported',draft:'literal 001'},poster:{state:'unknown',draftUrl:'local-draft.png'},empty:'',zero:0,enabled:false};
 const result=await captureAuthoringExport(api,{maxLevels:1,draftPresentation:drafts});
 assert.equal(result.coverage.completeBackup,false);assert.equal(result.migration.ready,false);assert.equal(result.migration.writesPerformed,0);assert.equal(result.coverage.capturedEditors,1);
 assert.deepEqual(result.draftPresentation.value,drafts);assert.equal((result.reads[0].value as any).game.descr,literal);assert.match(result.reads[0].rawJson!,/\\n/);
 assert.ok(result.migration.blockers.some(text=>text.includes('cap reached')));assert.ok(!JSON.stringify(result).includes('opaque-test-session'));assert.ok(!requests.some(path=>path.includes('/levels/2/editor')));
});

test('collection reread detects observed change and failures never trigger hidden retry',async()=>{
 let gameReads=0;
 const api:AuthoringApiPort={metadata:authoringMetadata(binding,['game-read','level-index']),invalidate(){},async request(path){if(path.endsWith('/files')||path.endsWith('/scenario-export'))throw new AuthoringApiError('unsupported');if(path.endsWith('/levels'))return Response.json({levels:[]});gameReads++;return Response.json({game:{id:42,descr:String(gameReads)}});}};
 const result=await captureAuthoringExport(api);assert.equal(result.coverage.consistentObservedCollection,false);assert.equal(result.reads[0].verifiedUnchanged,false);
 let attempts=0;const failed={...api,async request(){attempts++;throw new Error('auth checkpoint');}};
 const stopped=await captureAuthoringExport(failed);assert.equal(attempts,1);assert.equal(stopped.migration.ready,false);
});

test('file reference inventory excludes other games/origins and never exposes admin hidden state',()=>{
 const path='/Administration/Games/FileUploader.aspx?gid=42';
 const result=parseLegacyFileReferences({status:200,url:'https://fixture.en.cx'+path,html:'<input type=hidden name=secret value="DO_NOT_EXPORT"><p>https://d1.endata.cx/data/games/42</p><a href="https://d1.endata.cx/data/games/42/poster.png">poster</a><a href="https://d1.endata.cx/data/games/43/other.png">other game</a><a href="https://evil.test/data/games/42/secret.png">foreign</a>'},binding);
 assert.equal(result.files.length,1);assert.equal(result.coverage.complete,false);assert.equal(result.files[0].bytes,null);assert.equal(result.upload.available,false);assert.ok(!JSON.stringify(result).includes('DO_NOT_EXPORT'));
});

test('scenario export retains exact block source but never treats empty/summary as complete',()=>{
 const literal='<div class="scenarioBlock">001 &amp; <script>var x="</html>";</script></div>';
 const result=parseLegacyScenarioExport({status:200,url:'https://fixture.en.cx/GameScenario.aspx?gid=42',html:'<input type=hidden name=secret value="DO_NOT_EXPORT">'+literal},binding);
 assert.equal(result.blocks[0].html,literal);assert.equal(result.coverage.complete,false);assert.ok(!JSON.stringify(result).includes('DO_NOT_EXPORT'));
});

test('wrong game or stable level declarations cannot be exported as the selected source',async()=>{
 const api:AuthoringApiPort={metadata:authoringMetadata(binding,['game-read','level-index']),invalidate(){},async request(){return Response.json({game_id:99,game:{id:99}});}};
 await assert.rejects(captureAuthoringExport(api),{code:'invalid-scope'});
 await assert.rejects(captureAuthoringExport({...api,async request(){return Response.json({game_id:42,game:{id:99}});}}),{code:'invalid-scope'});
 const levelApi={...api,async request(path:string){return Response.json(path.endsWith('/levels')?{levels:[{level_id:1}]}:path.endsWith('/editor')?{game_id:42,level_id:2}:{game_id:42});}};
 await assert.rejects(captureAuthoringExport(levelApi),{code:'invalid-scope'});
});
