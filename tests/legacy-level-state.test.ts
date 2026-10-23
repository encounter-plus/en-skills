import test from 'node:test';import assert from 'node:assert/strict';
import {authoringBinding} from '../src/authoring-api.ts';
import {LegacyAuthoringAdapter,type LegacyRecipe,type LegacySessionPort} from '../src/legacy-authoring.ts';
import {validateLegacyRecipe} from '../src/legacy-recipe-guard.ts';
const root='/admin/games/42/levels';
function fixture(){
 const binding=authoringBinding('tech.en.cx',42,'state'),requests:LegacyRecipe[]=[],dismissed=new Set<number>();let bad='',uncertain=false,stale=false;
 const rows=[9,17,23];
 const form=(action:string,ids:number[])=>`<table><tr><form name="Levels${action==='dismiss'?'Dismiss':'Restore'}Form" method="get" action="./LevelManager.aspx"><td><input type="hidden" name="gid" value="42"><input type="hidden" name="levels" value="${action}"><select name="${action==='dismiss'?'ddlNotDismissedLevels':'ddlDismissedLevels'}">${ids.map(id=>`<option value="${id}">Level ${id}</option>`).join('')}</select><input type="image" name="${action==='dismiss'?'btnDismissLevels':'btnRestoreLevels'}"></td></form></tr></table>`;
 const manager=()=>`<form name="LevelsCreateForm"></form><table>${rows.map((id,i)=>`<tr><td><input name="txtLevelName_${id}" value="L${id}"><a href="/Administration/Games/LevelEditor.aspx?gid=42&amp;level=${i+1}">edit</a></td></tr>`).join('')}</table>`+(dismissed.size<rows.length?form('dismiss',rows.filter(id=>!dismissed.has(id))):'')+(dismissed.size?form('restore',[...dismissed]):'');
 const session:LegacySessionPort={binding,currentBinding:async()=>binding,async dispatch(recipe){validateLegacyRecipe(recipe,binding);requests.push(recipe);const q=new URL(recipe.path,'https://tech.en.cx').searchParams;
  if(recipe.kind==='level-state-confirm-read'){if(stale)dismissed.add(23);const action=q.get('levels'),field=action==='dismiss'?'ddlnotdismissedlevels':'ddldismissedlevels';return {status:200,url:'https://tech.en.cx'+recipe.path,html:`<a href="/Administration/Games/LevelManager.aspx?levels=${action}&amp;gid=42&amp;confirm=1&amp;${field}=17${bad}">Confirm</a>`};}
  if(recipe.effect==='mutation'){if(!uncertain){if(recipe.kind==='level-dismiss')dismissed.add(17);else dismissed.delete(17);}throw new Error('Opaque response');}
  return {status:200,url:'https://tech.en.cx'+recipe.path,html:manager()};
 }};
 return {api:new LegacyAuthoringAdapter(session),requests,dismissed,setBad:(value:string)=>bad=value,setUncertain:()=>uncertain=true,setStale:()=>stale=true,session,manager};
}
async function act(f:ReturnType<typeof fixture>,action:string){const before=await(await f.api.request(root)).json();return f.api.request(root+'/17/'+action,{method:'POST',headers:{'X-Authoring-Expected-Revision':before.version}});}
test('dismiss and restore preserve all persistent identities; confirmation GET is read, final GET occurs once',async()=>{
 const f=fixture(),before=await(await f.api.request(root)).json();assert.equal(before.level_state_complete,true);assert.deepEqual(before.dismissed_level_ids,[]);
 const dismissed=await(await act(f,'dismiss')).json();assert.deepEqual(dismissed.dismissed_level_ids,[17]);assert.deepEqual(dismissed.levels,before.levels);assert.notEqual(dismissed.version,before.version);
 const restored=await(await act(f,'restore')).json();assert.deepEqual(restored.dismissed_level_ids,[]);assert.deepEqual(restored.levels,before.levels);
 assert.equal(f.requests.filter(row=>row.effect==='mutation').length,2);assert.ok(f.requests.filter(row=>row.kind==='level-state-confirm-read').every(row=>row.effect==='read'&&!row.path.includes('confirm=')));
});
test('confirmation rejects duplicate/unknown/scope-changing parameters before mutation',async()=>{
 for(const bad of ['&amp;confirm=1','&amp;unknown=1','&amp;gid=43']){const f=fixture();f.setBad(bad);await assert.rejects(act(f,'dismiss'),{code:'incomplete-read'});assert.equal(f.requests.filter(row=>row.effect==='mutation').length,0);}
});
test('manager race prevents dispatch; unknown result performs one confirmation mutation and independent read only',async()=>{
 const f=fixture();f.setStale();assert.equal((await act(f,'dismiss')).status,409);assert.equal(f.requests.filter(row=>row.effect==='mutation').length,0);
 const g=fixture();g.setUncertain();await assert.rejects(act(g,'dismiss'),{code:'unknown-after-dispatch'});assert.equal(g.requests.filter(row=>row.effect==='mutation').length,1);assert.equal(g.requests.at(-1)?.kind,'level-index');
});
test('malformed-table form ownership is source bounded and foreign controls fail closed',async()=>{
 const f=fixture(),original=f.session.dispatch;f.session.dispatch=async(recipe,signal)=>{const page=await original(recipe,signal);if(recipe.kind==='level-index')page.html=page.html.replace('name="ddlNotDismissedLevels"','name="ddlNotDismissedLevels" form="other"');return page;};
 await assert.rejects(f.api.request(root),{code:'incomplete-read'});assert.equal(f.requests.filter(row=>row.effect==='mutation').length,0);
});
test('guard permits only read without confirmation and only mutation with exact lower-case persistent-ID field',()=>{
 const binding=authoringBinding('tech.en.cx',42,'guard'),read:LegacyRecipe={kind:'level-state-confirm-read',effect:'read',method:'GET',path:'/Administration/Games/LevelManager.aspx?gid=42&levels=dismiss&ddlNotDismissedLevels=17&btnDismissLevels.x=1&btnDismissLevels.y=1'};
 validateLegacyRecipe(read,binding);assert.throws(()=>validateLegacyRecipe({...read,path:read.path+'&confirm=1'},binding));assert.throws(()=>validateLegacyRecipe({...read,effect:'mutation'},binding));
 validateLegacyRecipe({kind:'level-dismiss',effect:'mutation',method:'GET',path:'/Administration/Games/LevelManager.aspx?gid=42&levels=dismiss&confirm=1&ddlnotdismissedlevels=17'},binding);
});

test('complete dismissed-only manager partition supports the first restore without fabricated controls',async()=>{
 const f=fixture();for(const id of [9,17,23])f.dismissed.add(id);const before=await(await f.api.request(root)).json();assert.equal(before.level_state_complete,true);assert.deepEqual(before.not_dismissed_level_ids,[]);assert.deepEqual(before.dismissed_level_ids,[9,17,23]);const after=await(await act(f,'restore')).json();assert.deepEqual(after.not_dismissed_level_ids,[17]);assert.deepEqual(after.dismissed_level_ids,[9,23]);
});
