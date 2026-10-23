import test from 'node:test';
import assert from 'node:assert/strict';
import {LegacyHints} from '../src/legacy-hints.ts';
import {authoringBinding} from '../src/authoring-api.ts';
import type {LegacyRecipe} from '../src/legacy-authoring.ts';
const binding=authoringBinding('tech.en.cx',42,'opaque');
const level={level_id:154,level_number:2,level_name:'Level'};
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function fixture(){
 let deleteOverride:string|undefined;
 const records=new Map<number,{penalty:boolean;controls:Record<string,string>}>([[11,{penalty:false,controls:{NewPrompt:'existing',NewPromptTimeoutDays:'0',NewPromptTimeoutHours:'0',NewPromptTimeoutMinutes:'1',NewPromptTimeoutSeconds:'0'}}]]),calls:LegacyRecipe[]=[];
 const defaults=(penalty:boolean)=>({NewPrompt:'',NewPromptTimeoutDays:'0',NewPromptTimeoutHours:'0',NewPromptTimeoutMinutes:'0',NewPromptTimeoutSeconds:'0',...(penalty?{txtPenaltyComment:'',PenaltyPromptHours:'0',PenaltyPromptMinutes:'0',PenaltyPromptSeconds:'0'}:{})});
 const editor=()=>Array.from(records,([id,record])=>`<a href="javascript:GameEditor('./PromptEdit.aspx?gid=42&amp;level=2&amp;prid=${id}${record.penalty?'&amp;penalty=1':''}','Prompt_42_2_${id}')">Hint</a>`).join('');
 const page=(path:string,html:string)=>({status:200,url:'https://tech.en.cx'+path,html});
 const hints=new LegacyHints({binding,level:async()=>level,editor:async()=>page('/Administration/Games/LevelEditor.aspx?gid=42&level=2',editor()),dispatch:async recipe=>{
  calls.push(recipe);const url=new URL(recipe.path,'https://tech.en.cx'),id=Number(url.searchParams.get('prid')),penalty=url.searchParams.get('penalty')==='1';
  if(recipe.kind==='hint-view-read')return page(recipe.path,`<a href="${deleteOverride??`http://tech.en.cx/Administration/Games/PromptEdit.aspx?action=PromptDelete${penalty?'&amp;penalty=1':''}&amp;level=2&amp;prid=${id}&amp;gid=42`}" onclick="return ConfirmPromptDelete();">delete</a>`);
  if(recipe.effect==='mutation'){
   if(recipe.kind==='hint-delete')records.delete(id);
   else {const body=new URLSearchParams(recipe.body);assert.equal(body.get('ForMemberID'),'0');assert.equal(body.has('btnAdd.x'),true);assert.equal(body.has('btnUpdate.x'),false);assert.deepEqual(body.getAll('multi'),['a','b']);const controls:Record<string,string>={};for(const [name,value]of body)if(!['ForMemberID','multi','btnAdd.x','btnAdd.y'].includes(name))controls[name]=value.replaceAll('\r\n','\n');records.set(13,{penalty,controls});}
   return {status:0,url:'https://tech.en.cx'+recipe.path,html:''};
  }
  const controls:Record<string,string>=id?records.get(id)!.controls:defaults(penalty),body=Object.entries(controls).filter(([name])=>name!=='chkRequestPenaltyConfirm').map(([name,value])=>['NewPrompt','txtPenaltyComment'].includes(name)?`<textarea name="${name}">${escape(value)}</textarea>`:`<input name="${name}" value="${escape(value)}">`).join('');
  return page(recipe.path,`<form method="post"><select name="ForMemberID"><option value="0" selected>All</option></select>${body}${penalty?`<input type="checkbox" name="chkRequestPenaltyConfirm" value="false"${controls.chkRequestPenaltyConfirm!==undefined?' checked':''}>`:''}<input type="hidden" name="multi" value="a"><input type="hidden" name="multi" value="b"><input type="image" name="${id?'btnUpdate':'btnAdd'}"></form>`);
 }});
 return {hints,calls,records,badLink:(value:string)=>{deleteOverride=value;}};
}
test('ordinary and penalty hint create preserve exact time/recipient/checkbox and delete exact ID once',async()=>{
 for(const penalty of [false,true]){
  const f=fixture(),base='/admin/games/42/levels/154/helps',before=await (await f.hints.request(base))!.json(),fields={help_text:'001 + &\n<b>Новая</b>',timeout:93784,is_penalty:penalty,...(penalty?{penalty_comment:'why',penalty_time:187,request_penalty_confirm:true}:{})};
  const response=await f.hints.request(base,{method:'POST',headers:{'If-Match':before.version},body:JSON.stringify(fields)});assert.equal(response?.status,201);const actual=await response!.json();assert.equal(actual.help_id,13);assert.equal(actual.timeout,93784);assert.equal(actual.for_user_id,0);if(penalty){assert.equal(actual.penalty_time,187);assert.equal(actual.request_penalty_confirm,true);assert.equal(new URLSearchParams(f.calls.find(row=>row.kind==='hint-create')!.body).get('chkRequestPenaltyConfirm'),'false');}
  const updated=await (await f.hints.request(base))!.json();assert.equal((await f.hints.request(base+'/13',{method:'DELETE',headers:{'If-Match':updated.version}}))?.status,204);assert.equal(f.records.has(13),false);assert.equal(f.records.has(11),true);assert.equal(f.calls.filter(row=>row.effect==='mutation').length,2);
  const view=f.calls.find(row=>row.kind==='hint-view-read')!,deletion=f.calls.find(row=>row.kind==='hint-delete')!;assert.equal(new URL(view.path,'https://tech.en.cx').searchParams.has('action'),false);assert.ok(deletion.path.startsWith('/'));assert.equal(deletion.path.includes('http:'),false);assert.equal(new URL(deletion.path,'https://tech.en.cx').searchParams.has('penalty'),penalty);
 }
});
test('HTTP view deletion links compile to HTTPS-session paths only with exact scope and hint kind',async()=>{
 const valid='http://tech.en.cx/Administration/Games/PromptEdit.aspx?gid=42&level=2&prid=11&action=PromptDelete';
 for(const link of [valid.replace('tech.en.cx','evil.en.cx'),valid.replace('tech.en.cx','tech.en.cx:8080'),valid.replace('tech.en.cx','user@tech.en.cx'),valid+'&penalty=1',valid+'&gid=43',valid.replace('prid=11','prid=12'),valid+'#fragment']){const f=fixture(),base='/admin/games/42/levels/154/helps',before=await (await f.hints.request(base))!.json();f.badLink(link);await assert.rejects(f.hints.request(base+'/11',{method:'DELETE',headers:{'If-Match':before.version}}),{code:'unsupported'});assert.equal(f.calls.filter(row=>row.effect==='mutation').length,0);}
});
test('missing/stale creation revision never sends mutation',async()=>{
 const f=fixture(),path='/admin/games/42/levels/154/helps';for(const headers of [{},{'If-Match':'stale'}]as Record<string,string>[]){const response=await f.hints.request(path,{method:'POST',headers,body:JSON.stringify({help_text:'text',timeout:1,is_penalty:false})});assert.equal(response?.status,headers['If-Match']?409:428);}assert.equal(f.calls.some(row=>row.effect==='mutation'),false);
});
