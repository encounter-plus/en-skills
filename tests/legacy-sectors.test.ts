import test from 'node:test';import assert from 'node:assert/strict';
import {authoringBinding} from '../src/authoring-api.ts';
import {LegacySectors} from '../src/legacy-sectors.ts';
import {validateLegacyRecipe} from '../src/legacy-recipe-guard.ts';
import type {LegacyRecipe,LegacySessionPort} from '../src/legacy-authoring.ts';
const esc=(s:string)=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
function fixture(unknown=false){
 const binding=authoringBinding('fixture.en.cx',42,'sector-session'),rows=[{id:71,name:'First',code:'001 & code',codes:undefined as string[]|undefined},{id:72,name:'Second',code:'002',codes:undefined as string[]|undefined}],requests:LegacyRecipe[]=[];
 const session:LegacySessionPort={binding,currentBinding:async()=>binding,async dispatch(recipe){validateLegacyRecipe(recipe,binding);requests.push(recipe);const url=new URL(recipe.path,'https://fixture.en.cx');
  if(recipe.effect==='mutation'){
   if(!unknown){if(recipe.kind==='sector-delete')rows.splice(rows.findIndex(row=>row.id===Number(url.searchParams.get('delsector'))),1);else {const body=new URLSearchParams(recipe.body);assert.equal(body.get('opaqueSibling'),'literal');if(body.has('updatesector'))rows.find(row=>row.id===Number(body.get('updatesector')))!.name=body.get('txtSectorName')!;else rows.push({id:73,name:body.get('txtSectorName')!,code:'',codes:Array.from({length:10},(_,i)=>body.get('txtAnswer_'+i)??'').filter(Boolean)});}}
   throw new Error('Opaque network result');
  }
  let html='';
  if(recipe.kind==='level-index')html='<form name="LevelsCreateForm"></form><table><tr><td><input name="txtLevelName_9" value="Level"><a href="/Administration/Games/LevelEditor.aspx?gid=42&amp;level=1">edit</a></td></tr></table>';
  else if(recipe.kind==='answer-list-read')html=rows.map(row=>`<div id="divSectorManage_${row.id}"><span id="ctl01_SectorsRepeater_ctl00_lblSectorName">${esc(row.name)}</span></div><form method="post" action="/Administration/Games/LevelEditor.aspx?level=1&amp;gid=42"><input name="opaqueSibling" value="literal"><div id="divSectorEdit_${row.id}"></div><div id="divAnswersEdit_${row.id}"></div></form>`).join('')+'<div id="divSectorEditorTemplate"><input name="txtSectorName"><input name="updatesector" value=""><input type="image" name="btnSaveSector"></div>';
  else if(recipe.kind==='answer-edit-read'){const row=rows.find(row=>row.id===Number(url.searchParams.get('sector')))!;html=(row.codes??(row.code?[row.code]:[])).map((code,i)=>`<input name="txtAnswer_${row.id+100+i}" value="${esc(code)}"><select name="ddlAnswerFor_${row.id+100+i}"><option value="0" selected>All</option></select>`).join('')+`<input type="image" name="ctl01_ctl00_btnUpdate"><input name="updateanswers" value="${row.id}">`;}
  else {const id=url.searchParams.get('renamesector');html=`<form method="post" action="/Administration/Games/LevelEditor.aspx?level=1&amp;gid=42"><input name="opaqueSibling" value="literal"><input name="txtSectorName" value="${esc(rows.find(row=>row.id===Number(id))?.name??'')}"><input name="${id?'updatesector':'savesector'}" value="${id??''}"><input type="image" name="btnSaveSector"><div id="AnswersTable_ctl00_ctl05_divNewSectorAnswersHolder"></div></form><div id="divNewAnswersTemplateHolder">${Array.from({length:10},(_,slot)=>`<input name="txtAnswer_${slot}" value=""><select name="ddlAnswerFor_${slot}"><option value="0">All</option></select>`).join('')}</div>`;}
  return {status:200,url:'https://fixture.en.cx'+recipe.path,html};
 }};return {api:new LegacySectors(session),rows,requests,binding};
}
const path='/admin/games/42/levels/9/sectors';
test('rename preserves literal names, stable IDs, every answer and form siblings',async()=>{
 const f=fixture(),before=await(await f.api.request(path))!.json();const after=await(await f.api.request(path+'/71',{method:'PUT',headers:{'If-Match':before.version},body:JSON.stringify({sector_name:' 001 & new '})}))!.json();assert.equal(after.sectors[0].sector_name,' 001 & new ');assert.equal(f.rows[0].code,'001 & code');assert.equal(f.rows[1].name,'Second');assert.equal(f.requests.filter(row=>row.effect==='mutation').length,1);
});
test('creation returns readback ID mapping; deletion removes only target and its codes',async()=>{
 const f=fixture(),before=await(await f.api.request(path))!.json(),created=await(await f.api.request(path,{method:'POST',headers:{'If-Match':before.version},body:JSON.stringify({sector_name:'New'})}))!.json();assert.equal(created.created_sector_id,73);assert.equal(f.rows.length,3);
 const after=await(await f.api.request(path+'/71',{method:'DELETE',headers:{'If-Match':created.version}}))!.json();assert.deepEqual(after.sectors.map((row:any)=>row.sector_id),[72,73]);assert.equal(f.rows[0].code,'002');
});
test('stale, unsupported and uncertain changes never replay',async()=>{
 const f=fixture(),before=await(await f.api.request(path))!.json();f.rows[1].name='Changed';assert.equal((await f.api.request(path+'/71',{method:'PUT',headers:{'If-Match':before.version},body:JSON.stringify({sector_name:'x'})}))!.status,409);assert.equal(f.requests.filter(row=>row.effect==='mutation').length,0);
 await assert.rejects(f.api.request(path,{method:'POST',body:JSON.stringify({sector_name:'x',answers:['guessed']})}),{code:'unsupported'});
 const g=fixture(true),snapshot=await(await g.api.request(path))!.json();await assert.rejects(g.api.request(path+'/71',{method:'PUT',headers:{'If-Match':snapshot.version},body:JSON.stringify({sector_name:'x'})}),{code:'unknown-after-dispatch'});assert.equal(g.requests.filter(row=>row.effect==='mutation').length,1);
 assert.throws(()=>validateLegacyRecipe({kind:'sector-delete',effect:'read',method:'GET',path:'/Administration/Games/LevelEditor.aspx?level=1&gid=42&swanswers=1&delsector=71'},g.binding));
});

test('create sector and several literal answers in one verified mutation',async()=>{const f=fixture(),before=await(await f.api.request(path))!.json();const result=await(await f.api.request(path,{method:'POST',headers:{'If-Match':before.version},body:JSON.stringify({sector_name:'Batch',new_answers:['001 & literal','002','туалет']})}))!.json();assert.deepEqual(result.answers.filter((a:any)=>a.sector_id===73).map((a:any)=>a.answer_text),['001 & literal','002','туалет']);assert.equal(f.requests.filter(r=>r.effect==='mutation').length,1);});
