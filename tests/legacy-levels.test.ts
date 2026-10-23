import test from 'node:test';import assert from 'node:assert/strict';
import {validateLegacyRecipe} from '../src/legacy-recipe-guard.ts';
import {authoringBinding} from '../src/authoring-api.ts';
import {LegacyAuthoringAdapter,type LegacyRecipe,type LegacySessionPort} from '../src/legacy-authoring.ts';
function fixture(unknown=false){
 const binding=authoringBinding('tech.en.cx',42,'level-session'),rows=[{id:9,name:'One'},{id:17,name:'Two'},{id:23,name:'Three'}],requests:LegacyRecipe[]=[];let next=31;
 const session:LegacySessionPort={binding,currentBinding:async()=>binding,async dispatch(recipe){validateLegacyRecipe(recipe,binding);requests.push(recipe);const query=new URL(recipe.path,'https://tech.en.cx').searchParams;
  if(recipe.effect==='mutation'){
   assert.equal(recipe.method,recipe.kind==='level-names-update'?'POST':'GET');if(!unknown){if(recipe.kind==='level-names-update'){const fields=new URLSearchParams(recipe.body);for(const row of rows)row.name=fields.get('txtLevelName_'+row.id)!;}else if(recipe.kind==='level-create')for(let count=0;count<Number(query.get('ddlCreateLevelsNum'));count++)rows.push({id:next++,name:'New'});else if(recipe.kind==='level-copy'){const source=rows.find(row=>row.id===Number(query.get('ddlCopyFrom')))!;for(let count=0;count<Number(query.get('ddlCopyCount'));count++)rows.push({id:next++,name:source.name});}else if(recipe.kind==='level-delete')rows.splice(Number(query.get('ddlDeleteLevels'))-1,1);else if(recipe.kind==='level-move'){const index=rows.findIndex(row=>row.id===Number(query.get('ddlPutLevel'))),[row]=rows.splice(index,1);rows.splice(rows.findIndex(row=>row.id===Number(query.get('ddlPutLevelAfter')))+1,0,row);}}
   throw new Error('Opaque redirect');
  }
  return {status:200,url:'https://tech.en.cx'+recipe.path,html:`<form name="LevelsCreateForm"></form><table>${rows.map((row,index)=>`<tr><td><input name="txtLevelName_${row.id}" value="${row.name}"><a href="/Administration/Games/LevelEditor.aspx?gid=42&amp;level=${index+1}">edit</a></td></tr>`).join('')}</table>`};
 }};return {api:new LegacyAuthoringAdapter(session),rows,requests};
}
const path='/admin/games/42/levels';
test('legacy level creation identifies new stable IDs and confirms existing order without retrying GET mutation',async()=>{
 const f=fixture(),before=await(await f.api.request(path)).json();
 const response=await f.api.request(path,{method:'POST',headers:{'X-Authoring-Expected-Revision':before.version},body:JSON.stringify({count:2})}),after=await response.json();
 assert.deepEqual(after.created.map((row:any)=>row.level_id),[31,32]);assert.equal(after.levels.length,5);assert.notEqual(after.version,before.version);
 assert.equal(f.requests.filter(row=>row.effect==='mutation').length,1);assert.equal(f.requests.at(-1)?.kind,'level-index');
});
test('legacy deletion binds a stable ID to a fresh ordinal and move preserves every other ID',async()=>{
 const f=fixture();let before=await(await f.api.request(path)).json();
 await f.api.request(path+'/9/position',{method:'PUT',headers:{'X-Authoring-Expected-Revision':before.version},body:JSON.stringify({after_level_id:23})});assert.deepEqual(f.rows.map(row=>row.id),[17,23,9]);
 before=await(await f.api.request(path)).json();await f.api.request(path+'/9',{method:'DELETE',headers:{'X-Authoring-Expected-Revision':before.version}});assert.deepEqual(f.rows.map(row=>row.id),[17,23]);
 const deletion=f.requests.find(row=>row.kind==='level-delete')!;assert.equal(new URL(deletion.path,'https://tech.en.cx').searchParams.get('ddlDeleteLevels'),'3');
});
test('stale inventory and all-level deletion fail closed; uncertain GET mutations never repeat',async()=>{
 const f=fixture(),before=await(await f.api.request(path)).json();f.rows.reverse();
 assert.equal((await f.api.request(path+'/9',{method:'DELETE',headers:{'X-Authoring-Expected-Revision':before.version}})).status,409);assert.equal(f.requests.filter(row=>row.effect==='mutation').length,0);
 await assert.rejects(f.api.request(path+'/0',{method:'DELETE'}),{code:'unsupported'});
 const g=fixture(true),snapshot=await(await g.api.request(path)).json();await assert.rejects(g.api.request(path,{method:'POST',headers:{'X-Authoring-Expected-Revision':snapshot.version},body:JSON.stringify({count:1})}),{code:'unknown-after-dispatch'});assert.equal(g.requests.filter(row=>row.effect==='mutation').length,1);
});


test('legacy copy invokes native same-game recipe once and identifies new IDs without claiming content fidelity',async()=>{
 const f=fixture(),before=await(await f.api.request(path)).json(),response=await f.api.request(path+'/copy',{method:'POST',headers:{'X-Authoring-Expected-Revision':before.version},body:JSON.stringify({from_level_id:17,count:2})}),after=await response.json();
 assert.deepEqual(after.created.map((row:any)=>row.level_id),[31,32]);assert.equal(after.verification.inventory,true);assert.equal(after.verification.content,'native-copy-not-independently-verified');
 const writes=f.requests.filter(row=>row.effect==='mutation');assert.equal(writes.length,1);assert.equal(writes[0].kind,'level-copy');const q=new URL(writes[0].path,'https://tech.en.cx').searchParams;assert.equal(q.get('ddlCopyFrom'),'17');assert.equal(q.get('ddlCopyCount'),'2');assert.deepEqual(f.rows.map(row=>row.id),[9,17,23,31,32]);
});
test('legacy copy rejects foreign IDs and reconciles ambiguous dispatch without repeating the GET',async()=>{
 const f=fixture(),before=await(await f.api.request(path)).json();await assert.rejects(f.api.request(path+'/copy',{method:'POST',headers:{'X-Authoring-Expected-Revision':before.version},body:JSON.stringify({from_level_id:99,count:1})}),{code:'unsupported'});assert.equal(f.requests.filter(row=>row.effect==='mutation').length,0);
 const g=fixture(true),snapshot=await(await g.api.request(path)).json();await assert.rejects(g.api.request(path+'/copy',{method:'POST',headers:{'X-Authoring-Expected-Revision':snapshot.version},body:JSON.stringify({from_level_id:17,count:1})}),{code:'unknown-after-dispatch'});assert.equal(g.requests.filter(row=>row.effect==='mutation').length,1);
});

test('grouped level rename preserves IDs, order and unselected names in one POST',async()=>{const f=fixture(),before=await(await f.api.request(path)).json();const result=await(await f.api.request(path+'/names',{method:'PUT',headers:{'X-Authoring-Expected-Revision':before.version},body:JSON.stringify({names:[{level_id:9,level_name:'First'},{level_id:23,level_name:'Last'}]})})).json();assert.deepEqual(result.levels.map((r:any)=>r.level_name),['First','Two','Last']);assert.equal(f.requests.filter(r=>r.effect==='mutation').length,1);});
