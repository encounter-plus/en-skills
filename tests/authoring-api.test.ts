import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveEngineProfile} from '../src/engine-profile.ts';
import {ModernAuthoringAdapter, authoringBinding, authoringMetadata} from '../src/authoring-api.ts';
import {LegacyAuthoringAdapter, parseLegacyTaskForm, type LegacyRecipe, type LegacySessionPort} from '../src/legacy-authoring.ts';
import {createAuthoringApi} from '../src/authoring-factory.ts';

const binding = authoringBinding('tech.en.cx',42,'opaque-document-account-epoch');

test('modern capabilities explicitly exclude legacy-only protocols as the registry grows',()=>{
 const api=new ModernAuthoringAdapter({domain:'demo.en.cx',gameId:42,sessionEpoch:'test',token:()=> 'token'});
 for(const name of ['answers-read','answer-create','answer-update','answer-delete','sectors-read','sector-create','sector-update','sector-delete','bonuses-read','bonus-create','bonus-update','bonus-delete','hint-create','hint-delete','file-reference-read','scenario-export-read']as const)assert.equal(api.metadata.capabilities[name].available,false,name);
 for(const name of ['game-read','level-index','task-update','hint-update','editor-read','batch','transfer']as const)assert.equal(api.metadata.capabilities[name].available,true,name);
});
const taskPath = '/Administration/Games/TaskEdit.aspx?level=1&gid=42&action=TaskEdit&tid=77';
const escape = (value: string) => value.replaceAll('&','&amp;').replaceAll('<','&lt;');
function taskHtml(value: string, replace = false) { return `<form method="post"><input name="preserved" type="hidden" value="fresh"><select name="forMemberID"><option value="0" selected>all</option></select><textarea name="inputTask">${escape(value)}</textarea><input type="checkbox" name="chkReplaceNlToBr"${replace ? ' checked' : ''}><input type="image" name="btnUpdate"></form>`; }
const indexHtml = (ordinal = 1) => `<form name="LevelsCreateForm"></form><table><tr><td><input name="txtLevelName_9" value="Level"><a href="/Administration/Games/LevelEditor.aspx?gid=42&amp;level=${ordinal}">edit</a></td></tr></table>`;
const editorHtml = `<a href="javascript:GameEditor('./TaskEdit.aspx?gid=42&amp;level=1');">Add</a><a href="javascript:GameEditor('./TaskEdit.aspx?gid=42&amp;level=1&amp;tid=77','Task_42_1_77')">Task</a>`;
function fixture(options: {afterWriteError?: boolean; neverWrite?: boolean; replace?: boolean; taskHtml?: (value:string)=>string} = {}) {
  let text = 'Кириллица + & % <b>001</b>\nline', active = true,replace=options.replace??false;
  const requests: LegacyRecipe[] = [];
  const session: LegacySessionPort = {binding, currentBinding: async () => ({...binding,sessionEpoch:active ? binding.sessionEpoch : 'changed'}), async dispatch(recipe) {
    requests.push(recipe);
    if (recipe.kind === 'task-update') {
      const fields = new URLSearchParams(recipe.body); assert.equal(fields.get('preserved'),'fresh');
      assert.equal(fields.get('forMemberID'),'0');
      assert.equal(fields.get('btnUpdate.x'),'1'); assert.equal(fields.get('btnUpdate.y'),'1');
      if (!options.neverWrite) text = fields.get('inputTask')!.replaceAll('\r\n','\n');
      if(!options.neverWrite)replace=fields.has('chkReplaceNlToBr');
      if (options.afterWriteError) throw new Error('response unavailable after server update');
      return {status:0,url:'',html:''};
    }
    return {status:200,url:`https://tech.en.cx${recipe.path}`,html:recipe.kind === 'level-index' ? indexHtml() : recipe.kind === 'level-editor-read' ? editorHtml : recipe.kind === 'game-editor-read' ? '<form method="post" action="/Administration/Games/GameEditor.aspx"><input name="gid" value="42"><input name="action" value="update"><input name="GameTitle" value="Synthetic title"><textarea name="Descr">description</textarea><input type="image" name="btnUpdate"></form>' : recipe.kind === 'game-read' ? '<a id="lnkGameTitle">Synthetic title</a>' : options.taskHtml?.(text) ?? taskHtml(text,replace)};
  }};
  const api = new LegacyAuthoringAdapter(session);
  return {api,requests,expire:()=>{active=false;},setText:(value:string)=>{text=value;}};
}
const taskRoute = '/admin/games/42/levels/9/tasks/77';
const apply = (version: string, text: string) => ({method:'POST',body:JSON.stringify({base_version:version,ops:[{entity:'task',op:'update',id:77,fields:{task_text:text}}]})});

test('registry selects exact demo/Kotlin and admitted legacy/RN hosts; rejects arbitrary domains', () => {
  assert.equal(resolveEngineProfile(' DEMO.en.cx ').runtime,'modern-enplus-kotlin');
  assert.equal(resolveEngineProfile('tech.en.cx').runtime,'legacy-enplus-react-native');
  for (const domain of ['evil.test','demo.en.cx.evil.test','en.cx','https://demo.en.cx','x.demo.en.cx','demo.en.cx.','a_b.en.cx']) assert.throws(()=>resolveEngineProfile(domain));
  assert.throws(()=>authoringMetadata({...binding,engine:'modern'},[]),{code:'invalid-scope'});
  assert.throws(()=>createAuthoringApi({domain:'tech.en.cx',gameId:42,sessionEpoch:'x',token:()=> 'modern-token'}),{code:'session-changed'});
});
test('modern adapter preserves DTO/status, query encoding, one-attempt writes and denies scope traversal', async () => {
  const requests: string[]=[];
  const api = new ModernAuthoringAdapter({domain:'demo.en.cx',gameId:42,sessionEpoch:'epoch',token:()=> 'token',fetch:async (url) => {requests.push(String(url)); return Response.json({unchanged:'001'},{status:207});}});
  assert.deepEqual(await (await api.request('/admin/games/42/levels?name=%D0%90%20x')).json(),{unchanged:'001'});
  for (const path of ['/admin/games/42/../43/editor','/admin/games/42/%2e%2e/43','/admin/games/42%2f..%2f43','/admin/games/43','//evil.test/admin/games/42','/admin/games/42?gid=43']) await assert.rejects(api.request(path),{code:'invalid-scope'});
  assert.equal(requests.length,1); api.invalidate(); await assert.rejects(api.request('/admin/games/42'),{code:'session-changed'});
});
test('legacy reads task association and preserves exact text without invented collections/live state', async () => {
  const {api} = fixture();
  const body = await (await api.request(taskRoute)).json();
  assert.equal(body.tasks[0].task_text,'Кириллица + & % <b>001</b>\nline');
  assert.match(body.version,/^legacy-observed:task-v1:/);
  assert.equal(body.players_started,undefined); assert.equal(body.answers,undefined);
  assert.equal(api.metadata.revision.conditionalWrite,false);
  const editor = await (await api.request('/admin/games/42/levels/9/editor')).json();
  assert.equal(editor.tasks.length,1); assert.deepEqual(editor.helps,[]); assert.equal(api.metadata.capabilities.transfer.available,false);
  assert.equal(editor.answers,undefined);assert.equal(editor._authoring.complete,false);assert.equal(editor._authoring.collections.answers,'unavailable');
  assert.equal((await (await api.request('/admin/games/42')).json()).game.title,'Synthetic title');
});
test('legacy one update sends CRLF and fresh preserved controls, independently verifies LF readback', async () => {
  for (const afterWriteError of [false,true]) {
    const {api,requests} = fixture({afterWriteError}); const before = await (await api.request(taskRoute)).json();
    const after = '001 + & % <i>Новый</i>\nsecond';
    const result = await (await api.request('/admin/games/42/levels/9/apply',apply(before.version,after))).json();
    assert.equal(result.results[0].status,'ok'); assert.notEqual(result.version,before.version);
    const writes = requests.filter(recipe=>recipe.effect==='mutation'); assert.equal(writes.length,1);
    assert.equal(new URLSearchParams(writes[0].body).get('inputTask'),after.replaceAll('\n','\r\n'));
    assert.equal(requests.at(-1)?.kind,'task-edit-read');
  }
});
test('legacy rejects stale revision, unsupported scope/ops/newline transformation before dispatch', async () => {
  const {api,requests,setText} = fixture(); const before = await (await api.request(taskRoute)).json(); setText('changed by another author');
  assert.equal((await api.request('/admin/games/42/levels/9/apply',apply(before.version,'new'))).status,409);
  await assert.rejects(api.request('/admin/games/42/levels/9/settings',{method:'PUT',body:'{}'}),{code:'unsupported'});
  await assert.rejects(api.request('/admin/games/42/levels/9/apply',{method:'POST',body:JSON.stringify({base_version:before.version,ops:[]})}),{code:'unsupported'});
  assert.equal(requests.filter(recipe=>recipe.effect==='mutation').length,0);
  const checked = fixture({replace:true}); const current = await (await checked.api.request(taskRoute)).json();
  assert.equal((await checked.api.request('/admin/games/42/levels/9/apply',apply(current.version,'new'))).status,200);const preserved=await(await checked.api.request(taskRoute)).json();assert.equal(preserved._authoring_task_update.replace_nl_to_br,true);
});
test('unknown write remains unknown and is never repeated; session expiry fences reads', async () => {
  const {api,requests,expire} = fixture({afterWriteError:true,neverWrite:true}); const before = await (await api.request(taskRoute)).json();
  await assert.rejects(api.request('/admin/games/42/levels/9/apply',apply(before.version,'new')),{code:'unknown-after-dispatch'});
  assert.equal(requests.filter(recipe=>recipe.effect==='mutation').length,1);
  expire(); await assert.rejects(api.request(taskRoute),{code:'session-changed'});
});
test('task parser handles ordered external controls and explicit malformed-table single-form recipe', () => {
  const page=(html:string)=>({status:200,url:'https://tech.en.cx'+taskPath,html});
  const external = `<form id="task" method="post"><textarea name="inputTask">001</textarea><select name="forMemberID"><option value="0">all</option></select><input type="hidden" name="duplicate" value="a"><input type="hidden" name="duplicate" value="b"></form><input form="task" name="btnUpdate" type="image">`;
  assert.deepEqual(parseLegacyTaskForm(page(external),binding,taskPath).controls.filter(([name])=>name==='duplicate'),[['duplicate','a'],['duplicate','b']]);
  const malformed = `<input type="image" name="dlgBtnOK"><table><form method="post">\n<tr><td><select name="forMemberID"><option value="0">all</option></select><textarea name="inputTask">001</textarea><input type="image" name="btnUpdate"></td></tr>\n</form></table><input type="image" name="dlgBtnCancel">`;
  assert.equal(parseLegacyTaskForm(page(malformed),binding,taskPath).text,'001');
  for (const html of [taskHtml('x').replace('value="0"','value="-3"'),taskHtml('x')+'<textarea name="inputTask">duplicate</textarea>','<input name="Login"><input name="Password" type="password">',malformed.replace('forMemberID','unknown')]) assert.throws(()=>parseLegacyTaskForm(page(html),binding,taskPath),{code:'incomplete-read'});
});
test('legacy CRLF input is verified at the browser textarea LF boundary without whitespace changes', async () => {
  const {api} = fixture(); const before = await (await api.request(taskRoute)).json();
  const after = '  001 + & = Кириллица\r\n\rline  ';
  const response = await api.request('/admin/games/42/levels/9/apply',apply(before.version,after));
  assert.equal(response.status,200);
  const current = await (await api.request(taskRoute)).json();
  assert.equal(current.tasks[0].task_text,'  001 + & = Кириллица\n\nline  ');
});
test('task read exposes newline display mode and unrelated form changes prevent accepted acknowledgment',async()=>{
 const checked=fixture({replace:true});const current=await(await checked.api.request(taskRoute)).json();assert.equal(current._authoring_task_update.available,true);assert.equal(current._authoring_task_update.replace_nl_to_br,true);
 const f=fixture({taskHtml:value=>taskHtml(value).replace('value="fresh"',value==='new task'?'value="changed-sibling"':'value="fresh"')});const before=await(await f.api.request(taskRoute)).json();
 await assert.rejects(f.api.request('/admin/games/42/levels/9/apply',apply(before.version,'new task')),{code:'unknown-after-dispatch'});assert.equal(f.requests.filter(row=>row.effect==='mutation').length,1);
});
test('text form select codec uses first enabled option and excludes disabled optgroups',()=>{
 const page=(html:string)=>({status:200,url:'https://tech.en.cx'+taskPath,html});
 const html=taskHtml('text').replace('<option value="0" selected>all</option>','<optgroup disabled><option value="99">ignored</option></optgroup><option disabled value="88">ignored</option><option value="0">all</option>');
 assert.equal(parseLegacyTaskForm(page(html),binding,taskPath).recipient,0);
 assert.throws(()=>parseLegacyTaskForm(page(html.replace('value="99"','selected value="99"')),binding,taskPath),{code:'incomplete-read'});
});
test('checked newline mode changes only through explicit reviewed literal update, preserving every sibling',async()=>{
 const f=fixture({replace:true}),inventory='/admin/games/42/levels/9/tasks',before=await(await f.api.request(inventory)).json(),task=before.tasks[0];
 assert.equal(task._authoring_replace_newlines,true);
 const response=await f.api.request(taskRoute,{method:'PUT',headers:{'X-Authoring-Expected-Revision':task._authoring_revision},body:JSON.stringify({task_text:'<b>001</b>\nnew line',replace_nl_to_br:false})});assert.equal(response.status,200);
 const after=(await(await f.api.request(inventory)).json()).tasks[0];assert.equal(after._authoring_replace_newlines,false);assert.equal(after.task_text,'<b>001</b>\nnew line');assert.equal(after._authoring_literal_preservation,task._authoring_literal_preservation);assert.notEqual(after._authoring_preservation,task._authoring_preservation);assert.equal(f.requests.filter(recipe=>recipe.effect==='mutation').length,1);
});

test('missing task ID reports create-versus-update guidance without dispatching a write',async()=>{
 const session:LegacySessionPort={binding,currentBinding:async()=>binding,dispatch:async recipe=>{
  assert.equal(recipe.effect,'read');
  return {status:200,url:'https://tech.en.cx'+recipe.path,html:recipe.kind==='level-index'?indexHtml():''};
 }};
 const api=new LegacyAuthoringAdapter(session);
 await assert.rejects(api.request('/admin/games/42/levels/9/tasks/1'),(e:unknown)=>{
  const error=e as Error&{code:string};assert.equal(error.code,'task-not-found');assert.match(error.message,/write_level_content/);return true;
 });
});
