import test from 'node:test';import assert from 'node:assert/strict';
import {authoringBinding} from '../src/authoring-api.ts';
import {LegacyAuthoringAdapter,type LegacyRecipe,type LegacySessionPort} from '../src/legacy-authoring.ts';
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;');
function fixture(unknown=false,member=0,userKnown=false){
 const binding=authoringBinding('tech.en.cx',42,'task-crud-session'),tasks=[{id:77,text:'Before',replace:false,member}],requests:LegacyRecipe[]=[];
 const form=(value:string,submit:string,checked:boolean,selected=0)=>`<table><form method="post">\n<tr><td><select name="forMemberID"><option value="0"${selected===0?' selected':''}>All</option><option value="900077"${selected===900077?' selected':''}>Member</option></select><textarea name="inputTask">${value.startsWith('\n')?'\n':''}${escape(value)}</textarea><input type="checkbox" name="chkReplaceNlToBr" value="false"${checked?' checked':''}><input type="hidden" name="unknown" value="preserved"><input name="${submit}" type="image"></td></tr>\n</form></table>`;
 const session:LegacySessionPort={binding,currentBinding:async()=>binding,async dispatch(recipe){requests.push(recipe);const query=new URL(recipe.path,'https://tech.en.cx').searchParams;
  if(recipe.effect==='mutation'){
   if(!unknown){if(recipe.kind==='task-create'){const fields=new URLSearchParams(recipe.body);assert.equal(fields.get('btnAdd.x'),'1');assert.equal(fields.get('unknown'),'preserved');tasks.push({id:78,text:fields.get('inputTask')!.replaceAll('\r\n','\n'),replace:fields.has('chkReplaceNlToBr'),member:Number(fields.get('forMemberID'))});}else if(recipe.kind==='task-update'){const fields=new URLSearchParams(recipe.body),row=tasks.find(row=>row.id===Number(query.get('tid')))!;row.text=fields.get('inputTask')!.replaceAll('\r\n','\n');row.member=Number(fields.get('forMemberID'));row.replace=fields.has('chkReplaceNlToBr');}else if(recipe.kind==='task-delete')tasks.splice(tasks.findIndex(row=>row.id===Number(query.get('tid'))),1);}
   throw new Error('Opaque redirect');
  }
  if(recipe.kind==='game-read')return {status:200,url:'https://tech.en.cx'+recipe.path,html:userKnown?'<table><tr><td>\u0418\u0433\u0440\u0430\u0435\u043c:</td><td>\u0412 \u043e\u0434\u0438\u043d\u043e\u0447\u043a\u0443</td></tr></table>':''};
  const task=tasks.find(row=>row.id===Number(query.get('tid')));
  const html=recipe.kind==='level-index'?`<form name="LevelsCreateForm"></form><table><tr><td><input name="txtLevelName_9" value="Level"><a href="/Administration/Games/LevelEditor.aspx?gid=42&amp;level=1">Level</a></td></tr></table>`:recipe.kind==='level-editor-read'?`<a href="javascript:GameEditor('./TaskEdit.aspx?gid=42&amp;level=1')">Add</a>${tasks.map(row=>`<a href="javascript:GameEditor('./TaskEdit.aspx?gid=42&amp;level=1&amp;tid=${row.id}','Task_42_1_${row.id}')">Task</a>`).join('')}`:recipe.kind==='task-add-read'?form('','btnAdd',true):form(task!.text,'btnUpdate',task!.replace,task!.member);
  return {status:200,url:'https://tech.en.cx'+recipe.path,html};
 }};return {api:new LegacyAuthoringAdapter(session),tasks,requests};
}
const path='/admin/games/42/levels/9/tasks';
test('task creation explicitly chooses literal HTML, resolves a new stable ID and preserves sibling tasks',async()=>{
 const f=fixture(),before=await(await f.api.request(path)).json(),text='\n001 + & = <b>Кириллица</b>\r\nline';
 const after=await(await f.api.request(path,{method:'POST',headers:{'X-Authoring-Expected-Revision':before.version},body:JSON.stringify({task_text:text,replace_nl_to_br:false})})).json();
 assert.equal(after.created_task_id,78);assert.equal(after.tasks[1].task_text,text.replaceAll('\r\n','\n'));assert.equal(after.tasks[0].task_text,'Before');assert.equal(f.requests.filter(row=>row.effect==='mutation').length,1);
});
test('task deletion is one classified GET mutation and verifies exact remaining inventory',async()=>{
 const f=fixture(),before=await(await f.api.request(path)).json();
 const response=await f.api.request(path+'/77',{method:'DELETE',headers:{'X-Authoring-Expected-Revision':before.version}}),after=await response.json();assert.deepEqual(after.tasks,[]);assert.equal(after.deleted_task_id,77);
 const mutation=f.requests.filter(row=>row.effect==='mutation');assert.equal(mutation.length,1);assert.equal(mutation[0].kind,'task-delete');assert.equal(mutation[0].method,'GET');
});
test('task create/delete require the correct inventory scope and unknown operations never retry',async()=>{
 const f=fixture(),before=await(await f.api.request(path)).json();
 await assert.rejects(f.api.request(path,{method:'POST',headers:{'X-Authoring-Expected-Revision':before.version},body:JSON.stringify({task_text:'x'})}),{code:'unsupported'});
 assert.equal((await f.api.request(path+'/77',{method:'DELETE',headers:{'X-Authoring-Expected-Revision':'legacy-observed:task-v1:wrong-scope'}})).status,409);assert.equal(f.requests.filter(row=>row.effect==='mutation').length,0);
 const g=fixture(true),snapshot=await(await g.api.request(path)).json();await assert.rejects(g.api.request(path,{method:'POST',headers:{'X-Authoring-Expected-Revision':snapshot.version},body:JSON.stringify({task_text:'x',replace_nl_to_br:false})}),{code:'unknown-after-dispatch'});assert.equal(g.requests.filter(row=>row.effect==='mutation').length,1);
});

test('native participant tasks expose options, preserve recipients on text edits and change them explicitly',async()=>{
 const f=fixture(false,900077),before=await(await f.api.request(path+'/77')).json();assert.equal(before.tasks[0].for_member_id,900077);assert.equal(before.tasks[0].for_user_id,undefined);assert.equal(before.tasks[0].recipient.options[1].label,'Member');
 await f.api.request(path+'/77',{method:'PUT',headers:{'X-Authoring-Expected-Revision':before.version},body:JSON.stringify({task_text:'literal <b>001</b>'})});assert.equal(f.tasks[0].member,900077);
 const fresh=await(await f.api.request(path+'/77')).json();await f.api.request(path+'/77',{method:'PUT',headers:{'X-Authoring-Expected-Revision':fresh.version},body:JSON.stringify({task_text:f.tasks[0].text,for_member_id:0})});assert.equal(f.tasks[0].member,0);
 const catalog=await(await f.api.request(path)).json();await f.api.request(path,{method:'POST',headers:{'X-Authoring-Expected-Revision':catalog.version},body:JSON.stringify({task_text:'recipient create',for_member_id:900077,replace_nl_to_br:false})});assert.equal(f.tasks[1].member,900077);
});

test('task typed user alias requires scoped individual game evidence and reads back as user',async()=>{
 const f=fixture(false,0,true),before=await(await f.api.request(path+'/77')).json();
 await f.api.request(path+'/77',{method:'PUT',headers:{'X-Authoring-Expected-Revision':before.version},body:JSON.stringify({task_text:'user scoped',for_user_id:900077})});
 const result=await(await f.api.request(path+'/77')).json();assert.equal(result.tasks[0].for_user_id,900077);assert.equal(result.tasks[0].recipient.kind,'user');assert.equal(result.tasks[0].for_team_id,undefined);
});

test('recipient-only task assignment preserves literal text and the existing newline setting',async()=>{
 for(const replace of [false,true]){const f=fixture(false,900077);f.tasks[0].replace=replace;f.tasks[0].text='literal <br> 001';const before=await(await f.api.request(path+'/77')).json();
 await f.api.request(path+'/77',{method:'PUT',headers:{'X-Authoring-Expected-Revision':before.version},body:JSON.stringify({for_member_id:0})});assert.equal(f.tasks[0].text,'literal <br> 001');assert.equal(f.tasks[0].replace,replace);assert.equal(f.tasks[0].member,0);assert.equal(f.requests.filter(row=>row.effect==='mutation').length,1);}
});

test('task creation and explicit display-flag transitions retain exact multiline literal text and siblings',async()=>{
 for(const flag of [false,true]){const f=fixture(),before=await(await f.api.request(path)).json(),source='001\r<br>literal\r\n& tail\nlast';
 const created=await(await f.api.request(path,{method:'POST',headers:{'X-Authoring-Expected-Revision':before.version},body:JSON.stringify({task_text:source,replace_nl_to_br:flag})})).json();assert.equal(created.tasks[1]._authoring_replace_newlines,flag);assert.equal(created.tasks[1].task_text,source.replace(/\r\n|\r/g,'\n'));assert.deepEqual(created.tasks[0],before.tasks[0]);
 for(const next of [!flag,flag]){const exact=await(await f.api.request(path+'/78')).json();await f.api.request(path+'/78',{method:'PUT',headers:{'X-Authoring-Expected-Revision':exact.version},body:JSON.stringify({replace_nl_to_br:next})});assert.equal(f.tasks[1].replace,next);assert.equal(f.tasks[1].text,created.tasks[1].task_text);}
 const exact=await(await f.api.request(path+'/78')).json();await f.api.request(path+'/78',{method:'PUT',headers:{'X-Authoring-Expected-Revision':exact.version},body:JSON.stringify({task_text:'updated\n<br>literal'})});assert.equal(f.tasks[1].replace,flag);assert.equal(f.tasks[1].text,'updated\n<br>literal');assert.equal(f.tasks[0].text,'Before');}
});
