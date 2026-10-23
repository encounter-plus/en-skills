import test from 'node:test';import assert from 'node:assert/strict';
import {LegacyLevels} from '../../src/legacy-levels.ts';
import {authoringBinding,authoringMetadata} from '../../src/authoring-api.ts';
import type {LegacyRecipe,LegacySessionPort} from '../../src/legacy-authoring.ts';
import type {ApiLike,ApiRequestOptions} from '../src/types.ts';
import {EncounterOperations} from '../src/operations-core.ts';
import {executeRuntimeOperation,operationInputs} from '../src/operation-inputs.ts';
function fixture(unknown=false){
 const binding=authoringBinding('tech.en.cx',42,'native-level-state'),requests:LegacyRecipe[]=[],snapshots:unknown[]=[],dismissed=new Set<number>();
 const form=(action:'dismiss'|'restore',ids:number[])=>ids.length?`<form name="Levels${action==='dismiss'?'Dismiss':'Restore'}Form" method="get" action="./LevelManager.aspx"><input type="hidden" name="gid" value="42"><input type="hidden" name="levels" value="${action}"><select name="${action==='dismiss'?'ddlNotDismissedLevels':'ddlDismissedLevels'}">${ids.map(id=>`<option value="${id}">${id}</option>`).join('')}</select><input type="image" name="${action==='dismiss'?'btnDismissLevels':'btnRestoreLevels'}"></form>`:'';
 const session:LegacySessionPort={binding,currentBinding:async()=>binding,async dispatch(recipe){requests.push(recipe);const q=new URL(recipe.path,'https://tech.en.cx').searchParams;
  if(recipe.kind==='level-state-confirm-read'){const action=q.get('levels'),field=action==='dismiss'?'ddlnotdismissedlevels':'ddldismissedlevels';return {status:200,url:'https://tech.en.cx'+recipe.path,html:`<a href="/Administration/Games/LevelManager.aspx?gid=42&amp;levels=${action}&amp;confirm=1&amp;${field}=17">Confirm</a>`};}
  if(recipe.effect==='mutation'){if(!unknown){if(recipe.kind==='level-dismiss')dismissed.add(17);else dismissed.delete(17);}throw new Error('Opaque redirect');}
  return {status:200,url:'https://tech.en.cx'+recipe.path,html:'<form name="LevelsCreateForm"></form><table>'+[9,17].map((id,i)=>`<tr><td><input name="txtLevelName_${id}" value="Level ${id}"><a href="/Administration/Games/LevelEditor.aspx?gid=42&amp;level=${i+1}">edit</a></td></tr>`).join('')+'</table>'+form('dismiss',[9,17].filter(id=>!dismissed.has(id)))+form('restore',[...dismissed])};
 }};
 const adapter=new LegacyLevels(session),metadata=authoringMetadata(binding,['level-index','level-dismiss','level-restore']),api:ApiLike={authoringMetadata:async()=>metadata,async request<T>(method:string,path:string,options:ApiRequestOptions={}){if(path.includes('live-statistics'))throw new Error('Unsupported legacy current-player statistics');assert.ok(!path.endsWith('/editor'),'state operations use complete manager inventory');const response=await adapter.request(path,{method,headers:options.headers});if(!response?.ok)throw new Error('Rejected '+response?.status);return await response.json()as T;}};
 const operations=new EncounterOperations(api,{name:'fixture',apiBaseUrl:'https://tech.en.cx',webBaseUrl:'https://tech.en.cx',domain:'tech.en.cx'},{writesEnabled:()=>true,saveSnapshot:async value=>{snapshots.push(value);return 'private-snapshot';}});
 return {operations,requests,dismissed,snapshots};
}
test('CLI/MCP shared routes dismiss and restore through native confirmation, revisions and full manager snapshot',async()=>{
 const f=fixture();const dismiss=await executeRuntimeOperation(f.operations,'dismiss-level',{gameId:42,levelId:17,confirmed:true})as {live:{state:string};after:{dismissed_level_ids:number[]}};assert.equal(dismiss.live.state,'unknown');assert.deepEqual(dismiss.after.dismissed_level_ids,[17]);
 await executeRuntimeOperation(f.operations,'restore-level',{gameId:42,levelId:17,confirmed:true});assert.equal(f.dismissed.size,0);assert.equal(f.snapshots.length,2);assert.equal(f.requests.filter(row=>row.effect==='mutation').length,2);
});
test('native level state requires confirmation and uncertain dispatch never repeats',async()=>{
 const f=fixture();await assert.rejects(executeRuntimeOperation(f.operations,'dismiss-level',{gameId:42,levelId:17}),{code:'CONFIRMATION_REQUIRED'});assert.equal(f.requests.some(row=>row.effect==='mutation'),false);
 const g=fixture(true);await assert.rejects(executeRuntimeOperation(g.operations,'dismiss-level',{gameId:42,levelId:17,confirmed:true}),{code:'unknown-after-dispatch'});assert.equal(g.requests.filter(row=>row.effect==='mutation').length,1);
});
test('shared recipient schemas support native zero/nonzero and recipient-only answer changes without guessing identity',()=>{
 assert.equal(operationInputs['update-answer'].parse({gameId:42,levelId:9,answerId:31,forMemberId:77}).forMemberId,77);assert.equal(operationInputs['add-answer-alias'].parse({gameId:42,levelId:9,answerText:'literal',sectorId:71,forMemberId:0}).forMemberId,0);
 assert.throws(()=>operationInputs['update-answer'].parse({gameId:42,levelId:9,answerId:31}));assert.throws(()=>operationInputs['update-answer'].parse({gameId:42,levelId:9,answerId:31,forMemberId:-1}));assert.throws(()=>operationInputs['post-message'].parse({gameId:42,levelId:9,messageText:'x',levelIds:[0],allLevels:true}));
});
