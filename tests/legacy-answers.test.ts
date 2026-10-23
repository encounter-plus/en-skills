import test from 'node:test';import assert from 'node:assert/strict';
import {authoringBinding} from '../src/authoring-api.ts';
import {legacyAnswerOperation} from '../src/legacy-operation-preparation.ts';
import {LegacyAnswers} from '../src/legacy-answers.ts';
import type {LegacyRecipe,LegacySessionPort} from '../src/legacy-authoring.ts';
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const emptySector=()=>`<div id="divSectorEditorTemplate"></div><form method="post" action="/Administration/Games/LevelEditor.aspx?level=1&amp;gid=42"><div id="divSectorEdit_71"></div><div id="divSectorManage_71"><span id="ctl01_SectorsRepeater_ctl00_lblSectorName">Sector name</span><a href="/Administration/Games/LevelEditor.aspx?level=1&amp;gid=42&amp;swanswers=1&amp;renamesector=71">rename</a><a href="/Administration/Games/LevelEditor.aspx?level=1&amp;gid=42&amp;swanswers=1&amp;delsector=71">delete</a></div></form><div id="divSectorsAnswersAdd_71"><form method="post" action="/Administration/Games/LevelEditor.aspx?level=1&amp;gid=42"><div id="divSectorsAddAnswersRows_71"></div><input type="image" name="ctl01_SectorsRepeater_ctl00_pnlNewAnswers_btnSave"><input name="ddlSector" value="71"><input name="saveanswers" value="1"></form></div>`;
function fixture(unknown=false,startEmpty=false,member=0,userKnown=false){
 const binding=authoringBinding('tech.en.cx',42,'answer-session'),answers=[{id:31,text:'001 + & Кириллица',member},{id:32,text:'second',member:0}],requests:LegacyRecipe[]=[];
 if(startEmpty)answers.splice(0);
 const session:LegacySessionPort={binding,currentBinding:async()=>binding,async dispatch(recipe){requests.push(recipe);
  if(recipe.effect==='mutation'){
   const form=new URLSearchParams(recipe.body);assert.equal(form.get('parentHidden'),'preserved');
   if(recipe.kind==='answer-create'){assert.equal(form.get('saveanswers'),'1');assert.equal(form.get('ddlSector'),'71');assert.equal(form.get('ddlAnswerFor_0'),String(member));assert.equal(form.get('AnswersTable_ctl00_NewAnswerEditor_ctl00_btnSave.x'),'1');if(!unknown)answers.push({id:33,text:form.get('txtAnswer_0')!,member:Number(form.get('ddlAnswerFor_0'))});throw new Error('Opaque create redirect');}
   assert.equal(form.get('updateanswers'),'71');
   if(!unknown){if(form.has('btnDelete.x')){const id=Number([...form].find(([key])=>key.startsWith('chkDeleteAnswer_'))?.[1]);assert.ok(id);answers.splice(answers.findIndex(row=>row.id===id),1);}else{assert.equal(form.get('ctl01_ctl00_btnUpdate.x'),'1');for(const row of answers){row.text=form.get('txtAnswer_'+row.id)!;row.member=Number(form.get('ddlAnswerFor_'+row.id));}}}
   throw new Error('Opaque redirect');
  }
  if(recipe.kind==='game-read')return {status:200,url:'https://tech.en.cx'+recipe.path,html:userKnown?'<table><tr><td>\u0418\u0433\u0440\u0430\u0435\u043c:</td><td>\u0412 \u043e\u0434\u0438\u043d\u043e\u0447\u043a\u0443</td></tr></table>':''};
  const creation='<form method="post"><input name="parentHidden" value="preserved"><div id="AnswersTable_ctl00_divCreateAnswers"><select name="ddlSector"><option value="71">Sector</option></select><input type="hidden" name="saveanswers" value="1"><div id="AnswersTable_ctl00_NewAnswerEditor"></div><input type="image" name="AnswersTable_ctl00_NewAnswerEditor_ctl00_btnSave"></div></form><div id="divNewAnswersTemplateHolder" hidden>'+Array.from({length:10},(_,i)=>'<input name="txtAnswer_'+i+'" value=""><select name="ddlAnswerFor_'+i+'"><option value="0">All</option><option value="900077">Member</option></select>').join('')+'</div>';
  const html=recipe.kind==='level-editor-read'?creation:recipe.kind==='level-index'?'<form name="LevelsCreateForm"></form><table><tr><td><input name="txtLevelName_9" value="Level"><a href="/Administration/Games/LevelEditor.aspx?gid=42&amp;level=1">edit</a></td></tr></table>':recipe.kind==='answer-list-read'?'<div id="divSectorManage_71"><span id="ctl01_SectorsRepeater_ctl00_lblSectorName">Sector name</span></div><form method="post" action="/Administration/Games/LevelEditor.aspx?level=1&amp;gid=42"><input type="hidden" name="parentHidden" value="preserved"><div id="divAnswersEdit_71"></div></form><div hidden><input name="txtAnswer_31" value="unrelated template"></div>':`${answers.map(row=>`<input type="checkbox" name="chkDeleteAnswer_${row.id}" value="${row.id}"><input name="txtAnswer_${row.id}" value="${escape(row.text)}"><select name="ddlAnswerFor_${row.id}"><option value="0"${row.member===0?' selected':''}>All</option><option value="900077"${row.member===900077?' selected':''}>Member</option></select>`).join('')}<input type="image" name="ctl01_ctl00_btnUpdate"><input type="image" name="btnDelete"><input type="hidden" name="updateanswers" value="71">`;
  return {status:200,url:'https://tech.en.cx'+recipe.path,html:recipe.kind==='answer-list-read'&&!answers.length?emptySector():html};
 }};return {api:new LegacyAnswers(session),answers,requests};
}
const path='/admin/games/42/levels/9/answers';

test('observed empty sector is proved by manage links and its scoped empty add form without requesting object3',async()=>{
 const binding=authoringBinding('tech.en.cx',42,'empty-sector'),requests:LegacyRecipe[]=[],base='/Administration/Games/LevelEditor.aspx?level=1&amp;gid=42';
 const html=`<div id="divSectorEditorTemplate"><input name="txtSectorName"><input name="updatesector"></div><form method="post" action="${base}"><div id="divSectorEdit_71"></div><div id="divSectorManage_71"><span id="ctl01_SectorsRepeater_ctl00_lblSectorName">Empty literal</span><a href="${base}&amp;swanswers=1&amp;renamesector=71">rename</a><a href="${base}&amp;swanswers=1&amp;delsector=71">delete</a></div></form><div id=""><div id="divSectorsAnswersAdd_71"><form method="post" action="${base}"><div id="divSectorsAddAnswersRows_71"></div><input type="image" name="ctl01_SectorsRepeater_ctl00_pnlNewAnswers_btnSave"><input type="hidden" name="ddlSector" value="71"><input type="hidden" name="saveanswers" value="1"></form></div></div><form method="post" action="${base}"><div id="" style="display:none"></div></form>`;
 const session:LegacySessionPort={binding,currentBinding:async()=>binding,dispatch:async recipe=>{requests.push(recipe);return {status:200,url:'https://tech.en.cx'+recipe.path,html:recipe.kind==='level-index'?'<form name="LevelsCreateForm"></form><table><tr><td><input name="txtLevelName_9" value="Level"><a href="/Administration/Games/LevelEditor.aspx?gid=42&amp;level=1">edit</a></td></tr></table>':html};}};
 const api=new LegacyAnswers(session),result=await(await api.request(path))!.json();assert.deepEqual(result.sectors,[{sector_id:71,sector_name:'Empty literal'}]);assert.deepEqual(result.answers,[]);assert.equal(requests.some(row=>row.kind==='answer-edit-read'),false);
 session.dispatch=async recipe=>({status:200,url:'https://tech.en.cx'+recipe.path,html:recipe.kind==='level-index'?'<form name="LevelsCreateForm"></form><table><tr><td><input name="txtLevelName_9" value="Level"><a href="/Administration/Games/LevelEditor.aspx?gid=42&amp;level=1">edit</a></td></tr></table>':html.replace('value="71"','value="72"')});await assert.rejects(api.request(path),{code:'incomplete-read'});
});

test('answer creation activates only the observed inert template and independently proves its exact new ID',async()=>{
 const f=fixture(),before=await(await f.api.request(path,{headers:{'X-Authoring-Answer-Create':'1'}}))!.json();
 const after=await(await f.api.request(path,{method:'POST',headers:{'If-Match':before.version},body:JSON.stringify({answer_text:' 001 + & Кириллица ',sector_id:71})}))!.json();
 assert.equal(after.created_answer_id,33);assert.equal(after.answers[2].answer_text,' 001 + & Кириллица ');assert.deepEqual(after.answers.slice(0,2),before.answers);assert.equal(f.requests.filter(row=>row.effect==='mutation').length,1);
 assert.equal(after.creation_preservation_version,before.creation_preservation_version);assert.equal(after.inventory_preservation_version,before.inventory_preservation_version);
});

test('first answer creates the edit fragment and deleting the last answer proves the exact empty-sector shape',async()=>{
 const f=fixture(false,true),before=await(await f.api.request(path,{headers:{'X-Authoring-Answer-Create':'1'}}))!.json();assert.equal(before.answers.length,0);assert.equal(before.sectors.length,1);
 const after=await(await f.api.request(path,{method:'POST',headers:{'If-Match':before.version},body:JSON.stringify({answer_text:'first001',sector_id:71})}))!.json();assert.equal(after.created_answer_id,33);
 const deleted=await(await f.api.request(path+'/33',{method:'DELETE',headers:{'If-Match':after.version}}))!.json();assert.equal(deleted.answers.length,0);assert.equal(deleted.sectors.length,1);assert.equal(f.requests.filter(row=>row.effect==='mutation').length,2);
});
test('answer fragment is bound to its observed parent form and exact literals keep sector identity',async()=>{
 const f=fixture(),before=await(await f.api.request(path))!.json();assert.equal(before.answers.length,2);assert.equal(before.answers[0].answer_text,'001 + & Кириллица');assert.equal(before.answers[0].sector_id,71);assert.equal(before.sectors[0].sector_name,'Sector name');
 const result=await f.api.request(path+'/31',{method:'PUT',headers:{'If-Match':before.version},body:JSON.stringify({answer_text:' 001new + % & '})});assert.equal(result!.status,200);assert.equal(f.answers[0].text,' 001new + % & ');assert.equal(f.answers[1].text,'second');assert.equal(f.requests.filter(row=>row.effect==='mutation').length,1);
});
test('answer checkbox deletion uses only its exact target and verifies every remaining code',async()=>{
 const f=fixture(),before=await(await f.api.request(path))!.json(),after=await(await f.api.request(path+'/32',{method:'DELETE',headers:{'If-Match':before.version}}))!.json();assert.equal(after.answers.length,1);assert.equal(after.answers[0].answer_id,31);assert.equal(f.requests.filter(row=>row.effect==='mutation').length,1);
});
test('stale answer inventory blocks writes; uncertain dispatch keeps unknown and never repeats',async()=>{
 const f=fixture(),before=await(await f.api.request(path))!.json();f.answers[0].text='another author';assert.equal((await f.api.request(path+'/31',{method:'PUT',headers:{'If-Match':before.version},body:JSON.stringify({answer_text:'x'})}))!.status,409);assert.equal(f.requests.filter(row=>row.effect==='mutation').length,0);
 const g=fixture(true),snapshot=await(await g.api.request(path))!.json();await assert.rejects(g.api.request(path+'/31',{method:'PUT',headers:{'If-Match':snapshot.version},body:JSON.stringify({answer_text:'x'})}),{code:'unknown-after-dispatch'});assert.equal(g.requests.filter(row=>row.effect==='mutation').length,1);
});

test('participant answer edits preserve exact codes and sibling recipients; native creation and invalid recipients are checked',async()=>{
 const f=fixture(false,false,900077),before=await(await f.api.request(path))!.json();assert.equal(before.answers[0].for_member_id,900077);assert.equal(before.answers[0].for_user_id,undefined);
 const after=await(await f.api.request(path+'/31',{method:'PUT',headers:{'If-Match':before.version},body:JSON.stringify({for_member_id:0})}))!.json();assert.equal(after.answers[0].answer_text,before.answers[0].answer_text);assert.equal(after.answers[0].for_member_id,0);assert.equal(after.answers[1].for_member_id,0);
 await assert.rejects(f.api.request(path+'/31',{method:'PUT',headers:{'If-Match':after.version},body:JSON.stringify({answer_text:'bad',for_member_id:999})}),{code:'unsupported'});
 const creation=await(await f.api.request(path,{headers:{'X-Authoring-Answer-Create':'1'}}))!.json();const result=await(await f.api.request(path,{method:'POST',headers:{'If-Match':creation.version},body:JSON.stringify({answer_text:'001 native',sector_id:71,for_member_id:900077})}))!.json();assert.equal(result.answers[2].for_member_id,900077);
});

test('answer typed user alias is proven by game mode rather than inferred from numeric ID',async()=>{
 const f=fixture(false,false,0,true),before=await(await f.api.request(path))!.json();
 const result=await(await f.api.request(path+'/31',{method:'PUT',headers:{'If-Match':before.version},body:JSON.stringify({answer_text:before.answers[0].answer_text,for_user_id:900077})}))!.json();assert.equal(result.answers[0].for_user_id,900077);assert.equal(result.answers[0].recipient.kind,'user');assert.equal(result.answers[0].for_team_id,undefined);
});

test('shared answer preparation verifies recipient-only changes against original literal and siblings',async()=>{
 const f=fixture(false,false,900077),api={...f.api,metadata:{binding:authoringBinding('tech.en.cx',42,'answer-session'),capabilities:{'answer-update':{available:true}}},request:f.api.request.bind(f.api)},args={action:'update' as const,levelId:9,answerId:31,forMemberId:0};
 const before=await legacyAnswerOperation.read(api as never,args),receipt=await legacyAnswerOperation.request(api as never,args,before);assert.equal(receipt?.status,200);
 const after=await legacyAnswerOperation.read(api as never,args);assert.equal(legacyAnswerOperation.verify(before,after,args),true);
 const changedSibling=structuredClone(after);(changedSibling.answers as {answer_text:string}[])[1].answer_text='changed sibling';assert.equal(legacyAnswerOperation.verify(before,changedSibling,args),false);
 const changedCode=structuredClone(after);(changedCode.answers as {answer_text:string}[])[0].answer_text='changed target code';assert.equal(legacyAnswerOperation.verify(before,changedCode,args),false);
});

test('shared verification replaces all recipient aliases in both directions for unknown and proven users',async()=>{
 for(const userKnown of [false,true])for(const [from,to]of [[0,900077],[900077,0]]){const f=fixture(false,false,from,userKnown),api={...f.api,metadata:{binding:authoringBinding('tech.en.cx',42,'answer-session'),capabilities:{'answer-update':{available:true}}},request:f.api.request.bind(f.api)},args={action:'update' as const,levelId:9,answerId:31,forMemberId:to};
 const before=await legacyAnswerOperation.read(api as never,args);await legacyAnswerOperation.request(api as never,args,before);const after=await legacyAnswerOperation.read(api as never,args);assert.equal(legacyAnswerOperation.verify(before,after,args),true);const row=(after.answers as Record<string,unknown>[])[0];assert.equal(row.for_member_id,to);if(to!==0){assert.equal(row.for_team_id,undefined);assert.equal(row.for_user_id,userKnown?to:undefined);}}
});
