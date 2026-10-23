import test from 'node:test';import assert from 'node:assert/strict';
import {authoringBinding} from '../../src/authoring-api.ts';
import {LegacyAnswers} from '../../src/legacy-answers.ts';
import type {LegacyRecipe,LegacySessionPort} from '../../src/legacy-authoring.ts';
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const emptySector=()=>`<div id="divSectorEditorTemplate"></div><form method="post" action="/Administration/Games/LevelEditor.aspx?level=1&amp;gid=42"><div id="divSectorEdit_71"></div><div id="divSectorManage_71"><span id="ctl01_SectorsRepeater_ctl00_lblSectorName">Sector name</span><a href="/Administration/Games/LevelEditor.aspx?level=1&amp;gid=42&amp;swanswers=1&amp;renamesector=71">rename</a><a href="/Administration/Games/LevelEditor.aspx?level=1&amp;gid=42&amp;swanswers=1&amp;delsector=71">delete</a></div></form><div id="divSectorsAnswersAdd_71"><form method="post" action="/Administration/Games/LevelEditor.aspx?level=1&amp;gid=42"><div id="divSectorsAddAnswersRows_71"></div><input type="image" name="ctl01_SectorsRepeater_ctl00_pnlNewAnswers_btnSave"><input name="ddlSector" value="71"><input name="saveanswers" value="1"></form></div>`;
function fixture(unknown=false,startEmpty=false){
 const binding=authoringBinding('tech.en.cx',42,'answer-session'),answers=[{id:31,text:'001 + & Кириллица',member:0},{id:32,text:'second',member:0}],requests:LegacyRecipe[]=[];
 if(startEmpty)answers.splice(0);
 const session:LegacySessionPort={binding,currentBinding:async()=>binding,async dispatch(recipe){requests.push(recipe);
  if(recipe.effect==='mutation'){
   const form=new URLSearchParams(recipe.body);assert.equal(form.get('parentHidden'),'preserved');
   if(recipe.kind==='answer-create'){assert.equal(form.get('saveanswers'),'1');assert.equal(form.get('ddlSector'),'71');assert.ok(['0','77'].includes(form.get('ddlAnswerFor_0')!));assert.equal(form.get('AnswersTable_ctl00_NewAnswerEditor_ctl00_btnSave.x'),'1');if(!unknown)answers.push({id:33,text:form.get('txtAnswer_0')!,member:Number(form.get('ddlAnswerFor_0'))});throw new Error('Opaque create redirect');}
   assert.equal(form.get('updateanswers'),'71');assert.ok(['0','77'].includes(form.get('ddlAnswerFor_'+answers[0].id)!));
   if(!unknown){if(form.has('btnDelete.x')){const id=Number([...form].find(([key])=>key.startsWith('chkDeleteAnswer_'))?.[1]);assert.ok(id);answers.splice(answers.findIndex(row=>row.id===id),1);}else{assert.equal(form.get('ctl01_ctl00_btnUpdate.x'),'1');for(const row of answers){row.text=form.get('txtAnswer_'+row.id)!;row.member=Number(form.get('ddlAnswerFor_'+row.id));}}}
   throw new Error('Opaque redirect');
  }
  const creation='<form method="post"><input name="parentHidden" value="preserved"><div id="AnswersTable_ctl00_divCreateAnswers"><select name="ddlSector"><option value="71">Sector</option></select><input type="hidden" name="saveanswers" value="1"><div id="AnswersTable_ctl00_NewAnswerEditor"></div><input type="image" name="AnswersTable_ctl00_NewAnswerEditor_ctl00_btnSave"></div></form><div id="divNewAnswersTemplateHolder" hidden>'+Array.from({length:10},(_,i)=>'<input name="txtAnswer_'+i+'" value=""><select name="ddlAnswerFor_'+i+'"><option value="0">All</option><option value="77">Native player</option></select>').join('')+'</div>';
  const html=recipe.kind==='level-editor-read'?creation:recipe.kind==='level-index'?'<form name="LevelsCreateForm"></form><table><tr><td><input name="txtLevelName_9" value="Level"><a href="/Administration/Games/LevelEditor.aspx?gid=42&amp;level=1">edit</a></td></tr></table>':recipe.kind==='answer-list-read'?'<div id="divSectorManage_71"><span id="ctl01_SectorsRepeater_ctl00_lblSectorName">Sector name</span></div><form method="post" action="/Administration/Games/LevelEditor.aspx?level=1&amp;gid=42"><input type="hidden" name="parentHidden" value="preserved"><div id="divAnswersEdit_71"></div></form><div hidden><input name="txtAnswer_31" value="unrelated template"></div>':`${answers.map(row=>`<input type="checkbox" name="chkDeleteAnswer_${row.id}" value="${row.id}"><input name="txtAnswer_${row.id}" value="${escape(row.text)}"><select name="ddlAnswerFor_${row.id}"><option value="0"${row.member===0?' selected':''}>All</option><option value="77"${row.member===77?' selected':''}>Native player</option></select>`).join('')}<input type="image" name="ctl01_ctl00_btnUpdate"><input type="image" name="btnDelete"><input type="hidden" name="updateanswers" value="71">`;
  return {status:200,url:'https://tech.en.cx'+recipe.path,html:recipe.kind==='answer-list-read'&&!answers.length?emptySector():html};
 }};return {api:new LegacyAnswers(session),answers,requests};
}

import {EncounterOperations} from '../src/operations-core.ts';
import {authoringMetadata} from '../../src/authoring-api.ts';
import type {ApiLike,ApiRequestOptions} from '../src/types.ts';
function operationsFor(adapter:{request(path:string,init?:RequestInit):Promise<Response|undefined>},levelId:number,capabilities:Parameters<typeof authoringMetadata>[1],beforeWrite?:()=>void){
 const metadata=authoringMetadata(authoringBinding('tech.en.cx',42,'integration'),capabilities);
 const api:ApiLike={authoringMetadata:async()=>metadata,async request<T>(method:string,path:string,options:ApiRequestOptions={}){
  if(path.endsWith('/levels'))return {levels:[{level_id:levelId,level_number:1}]} as T;
  if(path.endsWith('/editor'))return {level:{level_id:levelId,level_number:1}} as T;
  if(path.includes('live-statistics'))throw new Error('Legacy live unavailable');
  if(method!=='GET')beforeWrite?.();
  const response=await adapter.request(path,{method,headers:options.headers,body:options.body===undefined?undefined:JSON.stringify(options.body)});
  if(!response?.ok)throw new Error('Rejected '+response?.status);return await response.json() as T;
 }};
 return new EncounterOperations(api,{name:'fixture',apiBaseUrl:'https://tech.en.cx',webBaseUrl:'https://tech.en.cx',domain:'tech.en.cx'},{writesEnabled:()=>true,saveSnapshot:async()=>{throw new Error('No snapshots');}});
}

test('runtime answer create/update traverse actual forms with revisions and preserve siblings',async()=>{
 const f=fixture(),operations=operationsFor(f.api,9,['answer-create','answer-update']);
 await operations.addAnswerAlias({gameId:42,levelId:9,sectorId:71,answerText:'new + & 001'});
 await operations.updateAnswer({gameId:42,levelId:9,answerId:31,answerText:' exact + % & ',confirmed:true});
 assert.deepEqual(f.answers.map(row=>row.text),[' exact + % & ','second','new + & 001']);
 assert.equal(f.requests.filter(row=>row.effect==='mutation').length,2);
 const second=await operations.addAnswerAlias({gameId:42,levelId:9,sectorId:71,answerText:'new + & 001'}) as Record<string,unknown>;
 assert.equal(second.changed,false);assert.equal(f.requests.filter(row=>row.effect==='mutation').length,2);
});

test('runtime rejects unsupported answer scope and unavailable capabilities before dispatch',async()=>{
 const f=fixture(),operations=operationsFor(f.api,9,['answer-create','answer-update']);
 await assert.rejects(operations.addAnswerAlias({gameId:42,levelId:9,sectorId:71,answerText:'x',forTeamId:3}),/native forMemberId/);
 await assert.rejects(operations.updateAnswer({gameId:42,levelId:9,answerId:31,answerText:'x',sectorId:72,confirmed:true}),/sector changes/);
 await assert.rejects(operationsFor(f.api,9,[]).addAnswerAlias({gameId:42,levelId:9,sectorId:71,answerText:'x'}),/unavailable/);
 await assert.rejects(operations.dismissLevel({gameId:42,levelId:9,confirmed:true}),/unavailable/);
 assert.equal(f.requests.some(row=>row.effect==='mutation'),false);
});

test('runtime unknown answer dispatch is never replayed',async()=>{
 const f=fixture(true),operations=operationsFor(f.api,9,['answer-update']);
 await assert.rejects(operations.updateAnswer({gameId:42,levelId:9,answerId:31,answerText:'x',confirmed:true}),/unknown-after-dispatch/);
 assert.equal(f.requests.filter(row=>row.effect==='mutation').length,1);
});

test('runtime forwards stale inventory rejection without dispatch or retry',async()=>{
 const f=fixture(),operations=operationsFor(f.api,9,['answer-update'],()=>{f.answers[1].text='another author';});
 await assert.rejects(operations.updateAnswer({gameId:42,levelId:9,answerId:31,answerText:'x',confirmed:true}),/Rejected 409/);
 assert.equal(f.requests.some(row=>row.effect==='mutation'),false);
});

test('runtime native recipient create and recipient-only update traverse forms preserving literal code',async()=>{
 const f=fixture(),operations=operationsFor(f.api,9,['answer-create','answer-update']);
 await operations.addAnswerAlias({gameId:42,levelId:9,sectorId:71,answerText:'same code',forMemberId:77});
 assert.equal(f.answers.at(-1)?.member,77);assert.equal(f.answers.at(-1)?.text,'same code');
 await operations.updateAnswer({gameId:42,levelId:9,answerId:31,forMemberId:77,confirmed:true});
 assert.equal(f.answers[0].member,77);assert.equal(f.answers[0].text,'001 + & Кириллица');assert.equal(f.answers[1].member,0);assert.equal(f.answers[1].text,'second');
 const duplicate=await operations.addAnswerAlias({gameId:42,levelId:9,sectorId:71,answerText:'same code',forMemberId:77})as {changed:boolean};assert.equal(duplicate.changed,false);
});
