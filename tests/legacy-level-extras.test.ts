import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyLegacyMessageCreate} from '../src/legacy-operation-preparation.ts';
import {LegacyLevelExtras} from '../src/legacy-level-extras.ts';
import {authoringBinding} from '../src/authoring-api.ts';
import type {LegacySessionPort,LegacyRecipe} from '../src/legacy-authoring.ts';
const binding=authoringBinding('tech.en.cx',42,'opaque');
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const page=(path:string,html:string)=>({status:200,url:'https://tech.en.cx'+path,html});
const index='<form name="LevelsCreateForm"></form><table><tr><td><input name="txtLevelName_154" value="Level"><a href="/Administration/Games/LevelEditor.aspx?gid=42&level=2">2</a></td></tr><tr><td><input name="txtLevelName_155" value="Next"><a href="/Administration/Games/LevelEditor.aspx?gid=42&level=3">3</a></td></tr></table>';
test('absent native completion controls report unavailable without inventing flags; partial forms still fail closed',async()=>{
 for(const partial of [false,true]){
  const calls:LegacyRecipe[]=[];
  const session:LegacySessionPort={binding,currentBinding:async()=>binding,async dispatch(recipe){calls.push(recipe);return page(recipe.path,recipe.path.includes('LevelManager.aspx')?index:'<a id="AnswersTable_ctl00_lnkAnswersToggle">Answers</a>'+(partial?'<input name="rbSectorCompleteType" value="1">':''));}};
  const api=new LegacyLevelExtras(session),path='/admin/games/42/levels/154/settings?section=sectors';
  for(const method of ['GET','PUT'])await assert.rejects(api.request(path,{method,body:method==='PUT'?'{"all_sectors":true}':undefined}),error=>{
   assert.equal((error as any).code,'incomplete-read');
   assert.equal((error as any).details?.reason,partial?undefined:'native-form-not-rendered');return true;
  });
  assert.equal(calls.some(row=>row.effect==='mutation'),false);
 }
});
function fixture(){
 let name='Before',comment='literal 001 + &',timeout=900,penalty=false,penaltyDuration=187,attempts=4,allSectors=false,sectors=1,message:{id:number;text:string;targets:number[];allLevels:boolean;replace:boolean}|undefined;
 const calls:LegacyRecipe[]=[];let orderChanged=false,moveAfterForm=false,moveAfterWrite=false,messageRace=false,messageFormReads=0,messageDeleteHref:string|undefined;
 const field=(name:string,value:unknown,disabled=false)=>`<input name="${name}" value="${escape(String(value))}"${disabled?' disabled':''}>`;
 const meta=()=>`<input type="hidden" name="outside" value="foreign"><table><form method="post"><tr><td>${field('txtLevelName',name)}<textarea name="txtLevelComment">${escape(comment)}</textarea><input type="image" name="btnUpdate"></td></tr></form></table>`;
 const autopass=()=>`<form method="post">${field('txtApHours',Math.floor(timeout/3600))}${field('txtApMinutes',Math.floor(timeout/60)%60)}${field('txtApSeconds',timeout%60)}<input type="checkbox" name="chkTimeoutPenalty" value="false"${penalty?' checked':''}>${field('txtApPenaltyHours',Math.floor(penaltyDuration/3600),!penalty)}${field('txtApPenaltyMinutes',Math.floor(penaltyDuration/60)%60,!penalty)}${field('txtApPenaltySeconds',penaltyDuration%60,!penalty)}<input type="hidden" name="updateautopass" value=""><input type="image" name="ctl01_ctl00_ctl03"></form>`;
 const blocking=()=>`<form method="post">${field('txtAttemptsNumber',attempts)}${field('txtAttemptsPeriodHours',0)}${field('txtAttemptsPeriodMinutes',2)}${field('txtAttemptsPeriodSeconds',0)}<input type="radio" name="rbApplyForPlayer" value="1"><input type="radio" name="rbApplyForPlayer" value="2" checked><input type="hidden" name="action" value="upansblock"><input type="hidden" name="unknown" value="preserve"><input type="image" name="pnlSettings_AnswerBlockingSettings_ctl00_ctl08"></form>`;
 const sector=()=>`<form method="post"><input type="radio" name="rbSectorCompleteType" value="1"${allSectors?' checked':''}><input type="radio" name="rbSectorCompleteType" value="2"${!allSectors?' checked':''}>${field('txtRequiredSectorsCount',sectors,allSectors)}<input type="hidden" name="action" value="upsecsett"><input type="image" name="pnlSettings_SectorsCompletionSettings_ctl00_btnSave"></form>`;
 const links=()=>message?`<a href="javascript:GameEditor('/Administration/Games/MessageEdit.aspx?level=154&gid=42&mid=${message.id}','',700,700)">Message</a>`:'';
 const messageForm=(create:boolean)=>`<form method="post"><input type="hidden" name="unknownMessageControl" value="keep &amp; exact"><textarea name="txtMessage">${escape(message?.text??'')}</textarea><input type="checkbox" name="chkReplaceNlToBr" value="on"${message?.replace?' checked':''}><input type="radio" name="rbShowOnLevels" value="1"${message?.allLevels?' checked':''}><input type="radio" name="rbShowOnLevels" value="2"${!message?.allLevels?' checked':''}>${[154,155].map(id=>`<input type="checkbox" name="lvl_${id}"${(message?.targets??[154]).includes(id)?' checked':''}>`).join('')}<input type="hidden" name="action" value="${create?'save':'update'}"><input type="image" name="${create?'btnSave':'btnUpdate'}"></form>`;
 const session:LegacySessionPort={binding,currentBinding:async()=>binding,dispatch:async recipe=>{
  calls.push(recipe);const url=new URL(recipe.path,'https://tech.en.cx');
  if(recipe.effect==='mutation'){if(moveAfterWrite)orderChanged=true;
   if(recipe.kind==='message-delete')message=undefined;
   else {const body=new URLSearchParams(recipe.body);if(recipe.kind==='message-write'){assert.equal(body.get('unknownMessageControl'),'keep & exact');message={id:91,text:body.get('txtMessage')!.replaceAll('\r\n','\n'),targets:[154,155].filter(id=>body.has('lvl_'+id)),allLevels:body.get('rbShowOnLevels')==='1',replace:body.has('chkReplaceNlToBr')};}else if(url.pathname.endsWith('NameCommentEdit.aspx')){name=body.get('txtLevelName')!;comment=body.get('txtLevelComment')!.replaceAll('\r\n','\n');}else if(body.has('updateautopass')){timeout=Number(body.get('txtApHours'))*3600+Number(body.get('txtApMinutes'))*60+Number(body.get('txtApSeconds'));penalty=body.has('chkTimeoutPenalty');penaltyDuration=penalty?Number(body.get('txtApPenaltyHours'))*3600+Number(body.get('txtApPenaltyMinutes'))*60+Number(body.get('txtApPenaltySeconds')):0;}else if(body.get('action')==='upansblock'){assert.equal(body.get('unknown'),'preserve');attempts=Number(body.get('txtAttemptsNumber'));}else if(body.get('action')==='upsecsett'){allSectors=body.get('rbSectorCompleteType')==='1';if(!allSectors)sectors=Number(body.get('txtRequiredSectorsCount'));else assert.equal(body.has('txtRequiredSectorsCount'),false);}}
   return {status:0,url:'https://tech.en.cx'+recipe.path,html:''};
  }
  if(url.pathname.endsWith('LevelManager.aspx'))return page(recipe.path,orderChanged?index.replaceAll('level=2','level=swap').replaceAll('level=3','level=2').replaceAll('level=swap','level=3'):index);
  if(url.pathname.endsWith('NameCommentEdit.aspx')){const html=meta();if(moveAfterForm)orderChanged=true;return page(recipe.path,html);}
  if(url.pathname.endsWith('LevelInfo.aspx'))return page(recipe.path,autopass());
  if(recipe.kind==='message-view-read')return page(recipe.path,`<a href="${escape(messageDeleteHref??`/Administration/Games/MessageEdit.aspx?level=154&gid=42&action=delete&mid=${message!.id}`)}" onclick="return ConfirmDelete();">Delete</a>`);
  if(url.pathname.endsWith('MessageEdit.aspx')){if(messageRace&&++messageFormReads===2&&message)message.text='changed remotely';return page(recipe.path,messageForm(url.searchParams.get('action')==='add'));}
  return page(recipe.path,'<form name="MainForm" method="post"></form>'+blocking()+sector()+links());
 }};
 return {api:new LegacyLevelExtras(session),calls,message:()=>message,reorderAfterForm:()=>{moveAfterForm=true;},reorderAfterWrite:()=>{moveAfterWrite=true;},raceMessage:()=>{messageRace=true;messageFormReads=0;},badDeleteLink:(href:string)=>{messageDeleteHref=href;}};
}
test('meta/autopass/blocking/sectors exact section reads and fresh form updates preserve untouched controls',async()=>{
 const f=fixture(),base='/admin/games/42/levels/154',write=async(path:string,fields:unknown)=>{const before=await (await f.api.request(base+path))!.json();return f.api.request(base+path,{method:'PUT',headers:{'If-Match':before.version},body:JSON.stringify(fields)});};
 assert.equal((await (await write('/meta',{level_name:'New',comment:'001 + &\nline'}))!.json()).fields.comment,'001 + &\nline');
 const autopass=await write('/autopass',{timeout_minutes:16,penalty_enabled:true});assert.equal((await autopass!.json()).fields.penalty_enabled,true);const sent=f.calls.filter(row=>row.effect==='mutation').at(-1)!;assert.equal(new URLSearchParams(sent.body).get('chkTimeoutPenalty'),'false');
 assert.equal((await (await write('/settings?section=blocking',{attempts_number:5}))!.json()).fields.attempts_number,5);
 assert.equal((await (await write('/settings?section=sectors',{all_sectors:true}))!.json()).fields.required_sectors_count,null);
 assert.equal((await (await write('/settings?section=sectors',{required_sectors_count:3}))!.json()).fields.all_sectors,false);
 assert.equal(f.calls.filter(row=>row.effect==='mutation').length,5);
});
test('missing/stale section revision rejects before any mutation',async()=>{
 const f=fixture(),path='/admin/games/42/levels/154/meta';assert.equal((await f.api.request(path,{method:'PUT',body:JSON.stringify({comment:'new'})}))?.status,428);assert.equal((await f.api.request(path,{method:'PUT',headers:{'If-Match':'stale'},body:JSON.stringify({comment:'new'})}))?.status,409);assert.equal(f.calls.some(row=>row.effect==='mutation'),false);
});
test('native autopass disable resets the prior enabled penalty duration to zero without changing timeout',async()=>{
 const f=fixture(),path='/admin/games/42/levels/154/autopass',read=async()=>(await (await f.api.request(path))!.json());let before=await read();
 const enabled=await f.api.request(path,{method:'PUT',headers:{'If-Match':before.version},body:JSON.stringify({timeout_hours:0,timeout_minutes:1,timeout_seconds:7,penalty_enabled:true,penalty_hours:0,penalty_minutes:0,penalty_seconds:53})});assert.equal(enabled?.status,200);before=await read();assert.equal(before.fields.penalty_seconds,53);
 const disabled=await f.api.request(path,{method:'PUT',headers:{'If-Match':before.version},body:'{"penalty_enabled":false}'});assert.equal(disabled?.status,200);const after=await disabled!.json();assert.deepEqual(after.fields,{timeout_hours:0,timeout_minutes:1,timeout_seconds:7,penalty_enabled:false,penalty_hours:0,penalty_minutes:0,penalty_seconds:0});
 const sent=new URLSearchParams(f.calls.filter(row=>row.effect==='mutation').at(-1)!.body);for(const name of ['chkTimeoutPenalty','txtApPenaltyHours','txtApPenaltyMinutes','txtApPenaltySeconds'])assert.equal(sent.has(name),false);
 const writes=f.calls.filter(row=>row.effect==='mutation').length;for(const fields of [{penalty_enabled:false,penalty_seconds:53},{penalty_minutes:1}])await assert.rejects(f.api.request(path,{method:'PUT',headers:{'If-Match':after.version},body:JSON.stringify(fields)}),{code:'unsupported'});assert.equal(f.calls.filter(row=>row.effect==='mutation').length,writes);
});
test('messages use persistent target level IDs and exact create/update/delete submitters with whole target set',async()=>{
 const f=fixture(),base='/admin/games/42/levels/154/messages',version=async()=>(await (await f.api.request(base))!.json()).version;
 const create=await f.api.request(base,{method:'POST',headers:{'If-Match':await version()},body:JSON.stringify({message_text:'001 + &',all_levels:false,level_ids:[154,155]})});assert.equal(create?.status,201);assert.deepEqual(f.message()?.targets,[154,155]);
 const update=await f.api.request(base+'/91',{method:'PUT',headers:{'If-Match':await version()},body:JSON.stringify({message_text:'New\nline'})});assert.equal(update?.status,200);assert.deepEqual(f.message()?.targets,[154,155]);
 const bodies=f.calls.filter(row=>row.kind==='message-write').map(row=>new URLSearchParams(row.body));assert.equal(bodies[0].get('action'),'save');assert.equal(bodies[0].has('btnSave.x'),true);assert.equal(bodies[1].get('action'),'update');assert.equal(bodies[1].has('btnUpdate.x'),true);assert.equal(bodies[1].has('btnSave.x'),false);
 assert.equal((await f.api.request(base+'/91',{method:'DELETE',headers:{'If-Match':await version()}}))?.status,204);assert.equal(f.calls.filter(row=>row.kind==='message-delete').length,1);assert.equal(f.message(),undefined);
 assert.ok(f.calls.some(row=>row.kind==='message-view-read'&&!new URL(row.path,'https://tech.en.cx').searchParams.has('action')));
});
test('message deletion requires a fresh view link with exact persistent scope and query multiset',async()=>{
 const link='http://tech.en.cx/Administration/Games/MessageEdit.aspx?level=154&gid=42&action=delete&mid=91';
 for(const href of [link.replace('tech.en.cx','evil.en.cx'),link+'&gid=42',link+'&extra=1',link.replace('level=154','level=2'),link.replace('mid=91','mid=92'),link.replace('tech.en.cx','user@tech.en.cx'),link+'#frag']){
  const f=fixture(),base='/admin/games/42/levels/154/messages',version=async()=>(await (await f.api.request(base))!.json()).version;
  await f.api.request(base,{method:'POST',headers:{'If-Match':await version()},body:JSON.stringify({message_text:'Temporary',all_levels:false,level_ids:[154],replace_nl_to_br:false})});f.badDeleteLink(href);
  await assert.rejects(f.api.request(base+'/91',{method:'DELETE',headers:{'If-Match':await version()}}),{code:'unsupported'});assert.equal(f.calls.filter(row=>row.kind==='message-delete').length,0);
 }
});

test('ordinal movement before section dispatch conflicts; movement after dispatch is unknown without retry',async()=>{
 for(const after of [false,true]){const f=fixture(),path='/admin/games/42/levels/154/meta',before=await (await f.api.request(path))!.json();if(after)f.reorderAfterWrite();else f.reorderAfterForm();const promise=f.api.request(path,{method:'PUT',headers:{'If-Match':before.version},body:JSON.stringify({comment:'new'})});if(after)await assert.rejects(promise,/unknown-after-dispatch/);else assert.equal((await promise)?.status,409);assert.equal(f.calls.filter(row=>row.effect==='mutation').length,after?1:0);}
});
test('message changed between list snapshot and fresh edit form never dispatches stale update',async()=>{
 const f=fixture(),base='/admin/games/42/levels/154/messages',first=await (await f.api.request(base))!.json();await f.api.request(base,{method:'POST',headers:{'If-Match':first.version},body:JSON.stringify({message_text:'initial',all_levels:false,level_ids:[154]})});const before=await (await f.api.request(base))!.json();f.raceMessage();const response=await f.api.request(base+'/91',{method:'PUT',headers:{'If-Match':before.version},body:JSON.stringify({message_text:'stale replacement'})});assert.equal(response?.status,409);assert.equal(f.calls.filter(row=>row.effect==='mutation').length,1);
});


test('message display newline flag preserves literal source, native checkbox value and complete all-level scope',async()=>{
 const f=fixture(),base='/admin/games/42/levels/154/messages',version=async()=>(await (await f.api.request(base))!.json()).version;
 const write=async(fields:unknown,create=false)=>f.api.request(base+(create?'':'/91'),{method:create?'POST':'PUT',headers:{'If-Match':await version()},body:JSON.stringify(fields)});
 const source='001 + &\r\n<br>literal\r\n<script>const x="a";\n</script>\n<pre>line\nnext</pre>';
 const created=await write({message_text:source,all_levels:true,level_ids:[154,155],replace_nl_to_br:true},true);assert.equal(created?.status,201);
 const row=await created!.json();assert.equal(row.message_text,source.replaceAll('\r\n','\n'));assert.equal(row.replace_nl_to_br,true);assert.equal(row.all_levels,true);assert.deepEqual(row.level_ids,[154,155]);
 let body=new URLSearchParams(f.calls.filter(row=>row.kind==='message-write').at(-1)!.body);assert.equal(body.get('chkReplaceNlToBr'),'on');assert.equal(body.get('rbShowOnLevels'),'1');assert.equal(body.has('lvl_154'),false);assert.equal(body.get('txtMessage'),source.replace(/\r\n|\r|\n/g,'\r\n'));
 const updated=await write({message_text:'Changed\n<br>literal'});assert.equal(updated?.status,200);const after=await updated!.json();assert.equal(after.message_text,'Changed\n<br>literal');assert.equal(after.replace_nl_to_br,true);assert.equal(after.all_levels,true);assert.deepEqual(after.level_ids,[154,155]);
 const disabled=await write({replace_nl_to_br:false,all_levels:false,level_ids:[155]});assert.equal(disabled?.status,200);body=new URLSearchParams(f.calls.filter(row=>row.kind==='message-write').at(-1)!.body);assert.equal(body.has('chkReplaceNlToBr'),false);assert.equal(body.get('rbShowOnLevels'),'2');assert.equal(body.has('lvl_154'),false);assert.equal(body.get('lvl_155'),'on');
 const enabled=await write({replace_nl_to_br:true});assert.equal(enabled?.status,200);assert.deepEqual((await enabled!.json()).level_ids,[155]);assert.equal(f.calls.filter(row=>row.kind==='message-write').length,4);
});

test('all-level message creation rejects an incomplete explicit target set before dispatch',async()=>{
 const f=fixture(),base='/admin/games/42/levels/154/messages',before=await (await f.api.request(base))!.json();
 await assert.rejects(f.api.request(base,{method:'POST',headers:{'If-Match':before.version},body:JSON.stringify({message_text:'x',all_levels:true,level_ids:[154],replace_nl_to_br:true})}));assert.equal(f.calls.some(row=>row.effect==='mutation'),false);
});

test('message creation and update normalize lone CR at the textarea boundary without changing literals or targets',async()=>{
 const f=fixture(),base='/admin/games/42/levels/154/messages',read=async()=>(await (await f.api.request(base))!.json()),before=await read(),source='001\r<br>literal\r\n& tail\nlast';
 const created=await f.api.request(base,{method:'POST',headers:{'If-Match':before.version},body:JSON.stringify({message_text:source,all_levels:false,level_ids:[154],replace_nl_to_br:false})});assert.equal(created?.status,201);const after=await read();
 assert.equal(verifyLegacyMessageCreate(before,after,{messageText:source,levelId:154}),true);assert.equal(after.messages[0].message_text,'001\n<br>literal\n& tail\nlast');
 let body=new URLSearchParams(f.calls.filter(row=>row.kind==='message-write').at(-1)!.body);assert.equal(body.get('txtMessage'),'001\r\n<br>literal\r\n& tail\r\nlast');
 const updated=await f.api.request(base+'/91',{method:'PUT',headers:{'If-Match':after.version},body:JSON.stringify({message_text:'new\r001',replace_nl_to_br:true})});assert.equal(updated?.status,200);const current=await read();assert.equal(current.messages[0].message_text,'new\n001');assert.deepEqual(current.messages[0].level_ids,[154]);assert.equal(current.messages[0].replace_nl_to_br,true);body=new URLSearchParams(f.calls.filter(row=>row.kind==='message-write').at(-1)!.body);assert.equal(body.get('txtMessage'),'new\r\n001');
});
