import test from 'node:test';import assert from 'node:assert/strict';
import {LegacyAnswers} from '../../src/legacy-answers.ts';
import {authoringBinding,authoringMetadata} from '../../src/authoring-api.ts';
import type {LegacyRecipe,LegacySessionPort} from '../../src/legacy-authoring.ts';
import type {LegacyAnswerMoveJournal} from '../../src/legacy-answer-move.ts';
import {EncounterOperations} from '../src/operations-core.ts';
import {executeRuntimeOperation} from '../src/operation-inputs.ts';
import type {ApiLike,ApiRequestOptions} from '../src/types.ts';
const esc=(text:string)=>text.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const args={gameId:42,levelId:9,answerId:31,sourceSectorId:71,destinationSectorId:72};
function fixture(mode:'success'|'delete-unknown'|'create-unknown'|'create-rejected'|'policy-off-after-delete'|'binding-change-after-delete'='success',rejectionStatus=422){
 const binding=authoringBinding('tech.en.cx',42,'real-move-forms');let metadata=authoringMetadata(binding,['answer-create','answer-delete']),writesEnabled=true;const answers=[{id:31,sector:71,text:' exact 001 + & <br> ',member:77},{id:32,sector:72,text:'Sibling',member:0}],requests:LegacyRecipe[]=[],snapshots:unknown[]=[],journals:LegacyAnswerMoveJournal[]=[];
 let journal:LegacyAnswerMoveJournal|undefined;
 const recipient=(name:string,member:number)=>`<select name="${name}"><option value="0"${member===0?' selected':''}>All</option><option value="77"${member===77?' selected':''}>Member</option></select>`;
 const action='/Administration/Games/LevelEditor.aspx?level=1&amp;gid=42';
 const manage=(id:number)=>`<div id="divSectorManage_${id}"><span id="ctl01_SectorsRepeater_ctl00_lblSectorName">Sector ${id}</span><a href="${action}&amp;swanswers=1&amp;renamesector=${id}">rename</a><a href="${action}&amp;swanswers=1&amp;delsector=${id}">delete</a></div>`;
 const list=()=>[71,72].map(id=>answers.some(row=>row.sector===id)?manage(id)+`<form method="post" action="${action}"><input name="parentHidden" value="preserved-${id}"><div id="divAnswersEdit_${id}"></div></form>`:manage(id)+`<div id="divSectorsAnswersAdd_${id}"><form method="post" action="${action}"><div id="divSectorsAddAnswersRows_${id}"></div><input type="image" name="ctl01_SectorsRepeater_ctl00_pnlNewAnswers_btnSave"><input name="ddlSector" value="${id}"><input name="saveanswers" value="1"></form></div>`).join('');
 const creation=()=>`<form method="post"><input name="parentHidden" value="creation"><div id="AnswersTable_ctl00_divCreateAnswers"><select name="ddlSector"><option value="71">Source</option><option value="72">Destination</option></select><input name="saveanswers" value="1"><div id="AnswersTable_ctl00_NewAnswerEditor"></div><input type="image" name="AnswersTable_ctl00_NewAnswerEditor_ctl00_btnSave"></div></form><div id="divNewAnswersTemplateHolder" hidden>${Array.from({length:10},(_,i)=>`<input name="txtAnswer_${i}" value="">${recipient('ddlAnswerFor_'+i,0)}`).join('')}</div>`;
 const session:LegacySessionPort={binding,currentBinding:async()=>binding,async dispatch(recipe){requests.push(recipe);const q=new URL(recipe.path,'https://tech.en.cx').searchParams;
  if(recipe.effect==='mutation'){
   const body=new URLSearchParams(recipe.body);
   if(recipe.kind==='answer-create'){assert.equal(journal?.create.status,'dispatching');assert.equal(body.get('ddlSector'),'72');assert.equal(body.get('ddlAnswerFor_0'),'77');assert.equal(body.get('parentHidden'),'creation');if(mode!=='create-unknown')answers.push({id:99,sector:72,text:body.get('txtAnswer_0')!,member:Number(body.get('ddlAnswerFor_0'))});}
   else{assert.equal(journal?.delete.status,'dispatching');assert.equal(body.get('parentHidden'),'preserved-71');assert.equal(body.get('chkDeleteAnswer_31'),'31');if(mode!=='delete-unknown')answers.splice(answers.findIndex(row=>row.id===31),1);if(mode==='policy-off-after-delete')writesEnabled=false;if(mode==='binding-change-after-delete')metadata=authoringMetadata(authoringBinding('tech.en.cx',42,'different-session'),['answer-create','answer-delete']);}
   throw new Error('Opaque native response');
  }
  let html:string;
  if(recipe.kind==='game-read')html='';
  else if(recipe.kind==='level-index')html='<form name="LevelsCreateForm"></form><table><tr><td><input name="txtLevelName_9" value="Level"><a href="/Administration/Games/LevelEditor.aspx?gid=42&amp;level=1">Level</a></td></tr></table>';
  else if(recipe.kind==='level-editor-read')html=creation();
  else if(recipe.kind==='answer-list-read')html=list();
  else{const sector=Number(q.get('sector'));html=answers.filter(row=>row.sector===sector).map(row=>`<input type="checkbox" name="chkDeleteAnswer_${row.id}" value="${row.id}"><input name="txtAnswer_${row.id}" value="${esc(row.text)}">${recipient('ddlAnswerFor_'+row.id,row.member)}`).join('')+`<input type="image" name="ctl01_ctl00_btnUpdate"><input type="image" name="btnDelete"><input name="updateanswers" value="${sector}">`;}
  return {status:200,url:'https://tech.en.cx'+recipe.path,html};
 }};
 const adapter=new LegacyAnswers(session),api:ApiLike={authoringMetadata:async()=>metadata,async request<T>(method:string,path:string,options:ApiRequestOptions={}){if(path.endsWith('/editor'))return {level:{level_id:9,level_number:1}}as T;if(path.includes('live-statistics'))throw new Error('Native live statistics unknown');if(mode==='create-rejected'&&method==='POST')throw Object.assign(new Error('Rejected create'),{status:rejectionStatus});const response=await adapter.request(path,{method,headers:options.headers,...(options.body===undefined?{}:{body:JSON.stringify(options.body)})});if(!response?.ok)throw Object.assign(new Error('Rejected '+response?.status),{status:response?.status});return await response.json()as T;}};
 const operations=new EncounterOperations(api,{name:'fixture',apiBaseUrl:'https://tech.en.cx',webBaseUrl:'https://tech.en.cx',domain:'tech.en.cx'},{writesEnabled:()=>writesEnabled,saveSnapshot:async value=>{snapshots.push(value);return 'private-snapshot';},createAnswerMoveJournal:async()=>({reference:'private-journal',exclusive:async work=>work(),load:async()=>structuredClone(journal),save:async value=>{journal=structuredClone(value);journals.push(structuredClone(value));}})});
 return {operations,answers,requests,snapshots,journals,journal:()=>journal};
}
test('runtime/CLI move crosses real native delete+create forms in order and reports both persistent IDs',async()=>{
 const f=fixture(),result=await executeRuntimeOperation(f.operations,'move-answer',{...args,confirmed:true})as Record<string,unknown>;
 assert.equal(result.status,'complete');assert.equal(result.changed,true);assert.equal(result.oldAnswerId,31);assert.equal(result.newAnswerId,99);assert.equal(result.journalRef,'private-journal');assert.equal(result.sourceDeleted,true);assert.equal(result.destinationCreated,true);assert.deepEqual(f.answers,[{id:32,sector:72,text:'Sibling',member:0},{id:99,sector:72,text:' exact 001 + & <br> ',member:77}]);assert.deepEqual(f.requests.filter(row=>row.effect==='mutation').map(row=>row.kind),['answer-write','answer-create']);assert.equal(f.snapshots.length,1);
});
test('native delete uncertainty never adds, native create uncertainty preserves deletion facts without replay',async()=>{
 for(const mode of ['delete-unknown','create-unknown']as const){const f=fixture(mode),result=await executeRuntimeOperation(f.operations,'move-answer',{...args,confirmed:true})as Record<string,unknown>;assert.equal(result.status,'unknown');assert.equal(result.changed,mode==='delete-unknown'?null:true);assert.equal(result.sourceDeleted,mode==='create-unknown');assert.equal(result.destinationCreated,mode==='delete-unknown'?false:null);assert.equal(f.requests.filter(row=>row.effect==='mutation').length,mode==='delete-unknown'?1:2);assert.equal(f.journal()?.source.answer_text,' exact 001 + & <br> ');}
});
test('runtime requires explicit whole-plan approval and rejects same-sector move without native writes',async()=>{
 const f=fixture();await assert.rejects(executeRuntimeOperation(f.operations,'move-answer',args),{code:'CONFIRMATION_REQUIRED'});await assert.rejects(executeRuntimeOperation(f.operations,'move-answer',{...args,destinationSectorId:71,confirmed:true}));assert.equal(f.requests.some(row=>row.effect==='mutation'),false);
});

test('runtime policy and binding checkpoints stop destination dispatch while persisting confirmed source deletion',async()=>{
 for(const mode of ['policy-off-after-delete','binding-change-after-delete']as const){const f=fixture(mode),result=await executeRuntimeOperation(f.operations,'move-answer',{...args,confirmed:true})as Record<string,unknown>;assert.equal(result.status,'partial');assert.equal(result.changed,true);assert.equal(result.sourceDeleted,true);assert.equal(result.destinationCreated,false);assert.equal(f.journal()?.delete.status,'verified');assert.equal(f.journal()?.create.status,'not-dispatched');assert.deepEqual(f.requests.filter(row=>row.effect==='mutation').map(row=>row.kind),['answer-write']);}
});
test('known HTTP creation rejection is truthful partial success after deletion, with no uncertain creation claim',async()=>{
 for(const status of [409,422]){const f=fixture('create-rejected',status),result=await executeRuntimeOperation(f.operations,'move-answer',{...args,confirmed:true})as Record<string,unknown>;assert.equal(result.status,'partial');assert.equal(result.changed,true);assert.equal(result.sourceDeleted,true);assert.equal(result.destinationCreated,false);assert.equal(f.journal()?.create.status,'rejected');assert.equal(f.journal()?.create.httpStatus,status);assert.deepEqual(f.requests.filter(row=>row.effect==='mutation').map(row=>row.kind),['answer-write']);}
});
