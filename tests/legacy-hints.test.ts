import test from 'node:test';
import assert from 'node:assert/strict';
import {authoringBinding} from '../src/authoring-api.ts';
import {LegacyAuthoringAdapter, type LegacyRecipe, type LegacySessionPort} from '../src/legacy-authoring.ts';

const binding=authoringBinding('tech.en.cx',42,'hint-session');
const index=`<form name="LevelsCreateForm"></form><table><tr><td><input name="txtLevelName_9" value="Level"><a href="/Administration/Games/LevelEditor.aspx?gid=42&amp;level=1">Level</a></td></tr></table>`;
const editor=`<a href="javascript:GameEditor('./PromptEdit.aspx?gid=42&amp;level=1','Prompt_42_1')">Add</a><a href="javascript:GameEditor('./PromptEdit.aspx?gid=42&amp;level=1&amp;prid=11','Prompt_42_1_11')">Hint</a><a href="javascript:GameEditor('./PromptEdit.aspx?gid=42&amp;level=1&amp;prid=12&amp;penalty=1','Prompt_42_1_12',700,590)">Penalty</a>`;
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;');
function fixture(neverWrite=false,changeSibling=false) {
  const forms=new Map<number,Record<string,string>>([[11,{NewPrompt:'Hint + & 001',NewPromptTimeoutDays:'0',NewPromptTimeoutHours:'0',NewPromptTimeoutMinutes:'5',NewPromptTimeoutSeconds:'9'}],[12,{NewPrompt:'Penalty',NewPromptTimeoutDays:'0',NewPromptTimeoutHours:'0',NewPromptTimeoutMinutes:'7',NewPromptTimeoutSeconds:'9',txtPenaltyComment:'Warning',PenaltyPromptHours:'0',PenaltyPromptMinutes:'4',PenaltyPromptSeconds:'11',chkRequestPenaltyConfirm:'on'}]]);
  const requests:LegacyRecipe[]=[];
  let unknown='preserved';
  const session:LegacySessionPort={binding,currentBinding:async()=>binding,async dispatch(recipe){
    requests.push(recipe);const id=Number(new URL(recipe.path,'https://tech.en.cx').searchParams.get('prid'));
    if(recipe.effect==='mutation') {
      if(!neverWrite){const fields=new URLSearchParams(recipe.body),form=forms.get(id)!;for(const key of Object.keys(form))if(!fields.has(key))delete form[key];for(const [key,value] of fields)if(!['btnUpdate.x','btnUpdate.y','ForMemberID','unknown','multi'].includes(key))form[key]=value.replaceAll('\r\n','\n');assert.deepEqual(fields.getAll('multi'),['a','b']);assert.equal(fields.get('unknown'),'preserved');if(fields.has('chkRequestPenaltyConfirm'))assert.equal(fields.get('chkRequestPenaltyConfirm'),'false');if(changeSibling)unknown='changed';}
      throw new Error('redirect response unavailable');
    }
    const form=forms.get(id);
    const html=recipe.kind==='level-index'?index:recipe.kind==='level-editor-read'?editor:`<input name="dlgBtnOK" type="image"><table><form method="post">\n<tr><td><select name="ForMemberID"><option value="0" selected>All</option></select>${Object.entries(form!).filter(([key])=>key!=='chkRequestPenaltyConfirm').map(([key,value])=>['NewPrompt','txtPenaltyComment'].includes(key)?`<textarea name="${key}">${escape(value)}</textarea>`:`<input name="${key}" value="${value}">`).join('')}${id===12?`<input type="checkbox" name="chkRequestPenaltyConfirm" value="false"${form!.chkRequestPenaltyConfirm?' checked':''}>`:''}<input type="hidden" name="unknown" value="${unknown}"><input type="hidden" name="multi" value="a"><input type="hidden" name="multi" value="b"><input type="image" name="btnUpdate"></td></tr>\n</form></table>`;
    return {status:200,url:'https://tech.en.cx'+recipe.path,html};
  }};
  return {api:new LegacyAuthoringAdapter(session),requests,forms};
}
test('partial legacy editor reads both hint kinds with exact seconds and explicit checkbox false',async()=>{
  const f=fixture(),body=await(await f.api.request('/admin/games/42/levels/9/editor')).json();
  assert.equal(body.helps[0].help_text,'Hint + & 001');assert.equal(body.helps[0].timeout,309);
  assert.equal(body.penalty_helps[0].timeout,429);assert.equal(body.penalty_helps[0].penalty_time,251);assert.equal(body.penalty_helps[0].request_penalty_confirm,true);
  assert.equal(body.answers,undefined);assert.equal(body.players_started,undefined);
});
test('ordinary and penalty hint updates preserve all form fields and verify independent readback',async()=>{
  const f=fixture();
  for(const [id,patch] of [[11,{help_text:'<b>Новый + & 001</b>\r\nline',timeout:369}],[12,{help_text:'Penalty updated',timeout:489,penalty_time:311,request_penalty_confirm:false,penalty_comment:'New warning'}]] as const) {
    const route=`/admin/games/42/levels/9/helps/${id}`,before=await(await f.api.request(route)).json();
    const response=await f.api.request(route,{method:'PUT',headers:{'X-Authoring-Expected-Revision':before._authoring_revision},body:JSON.stringify(patch)});assert.equal(response.status,200);
    const after=await response.json();for(const [key,value] of Object.entries(patch))assert.equal(after[key],typeof value==='string'?value.replaceAll('\r\n','\n'):value);
    assert.notEqual(after._authoring_revision,before._authoring_revision);
  }
  assert.equal(f.requests.filter(row=>row.effect==='mutation').length,2);
  assert.equal(f.requests.at(-1)?.kind,'hint-edit-read');
});
test('missing/stale observed revisions and unsupported changes fail before a write; unresolved write never retries',async()=>{
  const f=fixture(),route='/admin/games/42/levels/9/helps/11',before=await(await f.api.request(route)).json();
  assert.equal((await f.api.request(route,{method:'PUT',body:JSON.stringify({timeout:60})})).status,409);
  f.forms.get(11)!.NewPrompt='Another author';
  assert.equal((await f.api.request(route,{method:'PUT',headers:{'X-Authoring-Expected-Revision':before._authoring_revision},body:JSON.stringify({timeout:60})})).status,409);
  assert.equal(f.requests.filter(row=>row.effect==='mutation').length,0);
  const g=fixture(true),current=await(await g.api.request(route)).json();
  await assert.rejects(g.api.request(route,{method:'PUT',headers:{'X-Authoring-Expected-Revision':current._authoring_revision},body:JSON.stringify({timeout:60})}),{code:'unknown-after-dispatch'});
  assert.equal(g.requests.filter(row=>row.effect==='mutation').length,1);
});
test('unchecked hint checkbox retains its observed source value when enabled; sibling changes remain unknown',async()=>{
 const f=fixture(),route='/admin/games/42/levels/9/helps/12';delete f.forms.get(12)!.chkRequestPenaltyConfirm;
 const before=await(await f.api.request(route)).json(),response=await f.api.request(route,{method:'PUT',headers:{'X-Authoring-Expected-Revision':before._authoring_revision},body:JSON.stringify({request_penalty_confirm:true})});assert.equal((await response.json()).request_penalty_confirm,true);
 assert.equal(new URLSearchParams(f.requests.find(row=>row.effect==='mutation')!.body).get('chkRequestPenaltyConfirm'),'false');
 const g=fixture(false,true),ordinary='/admin/games/42/levels/9/helps/11',snapshot=await(await g.api.request(ordinary)).json();
 await assert.rejects(g.api.request(ordinary,{method:'PUT',headers:{'X-Authoring-Expected-Revision':snapshot._authoring_revision},body:JSON.stringify({help_text:'New text'})}),{code:'unknown-after-dispatch'});
});
