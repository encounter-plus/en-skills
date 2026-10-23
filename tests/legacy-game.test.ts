import test from 'node:test';
import assert from 'node:assert/strict';
import {authoringBinding} from '../src/authoring-api.ts';
import {LegacyGame,parseLegacyGameForm} from '../src/legacy-game.ts';
import type {LegacySessionPort,LegacyRecipe} from '../src/legacy-authoring.ts';
const binding=authoringBinding('tech.en.cx',42,'opaque');
const path='/Administration/Games/GameEditor.aspx?gid=42&action=edit';
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function html(description:string,fee='001',hidden='state'){
  return `<form id="main" method="post" action="/Administration/Games/GameEditor.aspx"><input type="hidden" name="gid" value="42"><input type="hidden" name="action" value="update"><input type="hidden" name="__VIEWSTATE" value="${hidden}"><input name="GameTitle" value="Test"><textarea name="Descr">${escape(description)}</textarea><input name="Fee" value="${fee}"><select name="FeeCurrency"><option value="101" selected>руб.</option><option value="105">eur</option></select><input name="FeeName" value="literal + &amp;"><input type="checkbox" name="flag" value="false" checked><input type="checkbox" name="off" value="yes"><input disabled name="startDate" value="old"><input type="hidden" name="unknown" value="one"><input type="hidden" name="unknown" value="two"><fieldset disabled><input name="disabledField" value="secret"></fieldset><input type="image" name="dlgBtnOK"><input type="image" name="btnUpdate"></form><form method="get"><input type="hidden" name="foreign" value="do-not-copy"></form>`;
}
const page=(value:string)=>({status:200,url:'https://tech.en.cx'+path,html:value});
test('game full-form codec preserves literal/multivalue/unknown controls and successful checkbox semantics',()=>{
  const form=parseLegacyGameForm(page(html('<b>001 + &</b>')),binding),values=new URLSearchParams(form.controls);
  assert.equal(form.description,'<b>001 + &</b>');assert.equal(values.get('Fee'),'001');assert.equal(values.get('FeeCurrency'),'101');assert.equal(values.get('flag'),'false');assert.deepEqual(values.getAll('unknown'),['one','two']);
  for(const name of ['foreign','off','startDate','disabledField','dlgBtnOK.x'])assert.equal(values.has(name),false,name);assert.equal(values.get('btnUpdate.x'),'1');
  assert.throws(()=>parseLegacyGameForm(page(html('x').replace('value="42"','value="43"')),binding));
  assert.throws(()=>parseLegacyGameForm(page(html('x').replace('name="Descr"','disabled name="Descr"')),binding));
  assert.throws(()=>parseLegacyGameForm(page(html('x').replace('action="/Administration/Games/GameEditor.aspx"','action="https://evil.test/"')),binding));
});
test('description-only patch retains full fresh form and requires immutable observed revision',async()=>{
  let description='before',fee='001',hidden=0,writes=0;const calls:LegacyRecipe[]=[];
  const session:LegacySessionPort={binding,currentBinding:async()=>binding,dispatch:async recipe=>{calls.push(recipe);if(recipe.effect==='mutation'){writes++;const body=new URLSearchParams(recipe.body);assert.equal(body.get('gid'),'42');assert.equal(body.get('action'),'update');assert.equal(body.get('Fee'),fee);assert.equal(body.get('flag'),'false');assert.deepEqual(body.getAll('unknown'),['one','two']);description=body.get('Descr')!.replaceAll('\r\n','\n');return {status:0,url:'https://tech.en.cx'+recipe.path,html:''};}return page(html(description,fee,String(hidden++)));}};
  const api=new LegacyGame(session),base='/admin/games/42';const read=await api.request(base),before=await read!.json();
  assert.equal(before.game.descr,'before');assert.equal(before.presentation.important.state,'unknown');assert.equal(JSON.stringify(before).includes('__VIEWSTATE'),false);assert.equal(JSON.stringify(before).includes('\"unknown\":'),false);
  assert.equal((await api.request(base,{method:'PUT',body:JSON.stringify({descr:'next'})}))?.status,428);
  fee='999';assert.equal((await api.request(base,{method:'PUT',headers:{'If-Match':before.version},body:JSON.stringify({descr:'next'})}))?.status,409);assert.equal(writes,0);
  fee='001';const result=await api.request(base,{method:'PUT',headers:{'If-Match':before.version},body:JSON.stringify({descr:'001 + &\n<b>Кириллица</b>'})});assert.equal(result?.status,200);assert.equal(writes,1);assert.equal(description,'001 + &\n<b>Кириллица</b>');
  assert.equal(calls.filter(row=>row.effect==='mutation').length,1);
  await assert.rejects(api.request(base,{method:'PUT',headers:{'If-Match':before.version},body:JSON.stringify({poster_url:'image.png'})}),/unsupported/);
});
test('lost game write response is verified once and altered sibling values stay unknown',async()=>{
  let description='before',fee='001',writes=0;
  const session:LegacySessionPort={binding,currentBinding:async()=>binding,dispatch:async recipe=>{if(recipe.effect==='mutation'){writes++;description=new URLSearchParams(recipe.body).get('Descr')!;fee='changed concurrently';throw new Error('lost');}return page(html(description,fee));}};
  const api=new LegacyGame(session),before=await (await api.request('/admin/games/42'))!.json();
  await assert.rejects(api.request('/admin/games/42',{method:'PUT',headers:{'If-Match':before.version},body:JSON.stringify({descr:'after'})}),/unknown-after-dispatch/);assert.equal(writes,1);
});
