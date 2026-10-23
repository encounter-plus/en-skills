import test from 'node:test';
import assert from 'node:assert/strict';
import {authoringBinding} from '../src/authoring-api.ts';
import {LegacyObservations,legacyMonitoringPath,parseLegacyMonitoring,parseLegacyCorrections,legacyDurationSeconds,parseLegacyCorrectionForm,legacyCorrectionBody} from '../src/legacy-observations.ts';
import {LegacyAuthoringAdapter,type LegacyRecipe,type LegacySessionPort} from '../src/legacy-authoring.ts';
const binding=authoringBinding('cp.en.cx',42,'session');
const page=(path:string,html:string)=>({status:200,url:'https://cp.en.cx'+path,html});
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const participant='<a href="/Teams/TeamDetails.aspx?tid=7">Team</a><a href="/UserDetails.aspx?uid=8">User</a>';
function monitor(tab:0|1,options:{answer?:string;pages?:number;number?:number;timeout?:boolean}={}){
  const row=tab===0?`<td>${options.number??2}</td><td>${participant}</td><td><span id="ActionsRepeater_ctl00_lblCorrectValue">в</span></td><td>${options.timeout?'Пройден по таймауту':options.answer??'00<span class="nonLatinChar">А</span>  + 1'}</td><td>19.12.2025&nbsp;00:14:58.053</td><td>(3/2/1)</td>`:`<td>2</td><td><a onclick="monitoring.ShowBonus(19);return false;">1</a></td><td>${participant}</td><td><span id="BonusActionsRepeater_ctl00_lblCorrectValue">в</span></td><td>${options.answer??'Бонус'}</td><td>19.12.2025&nbsp;00:14:58.053</td>`;
  return `<form name="MonitoringForm"></form><table><tr>${row}</tr></table>${Array.from({length:options.pages??1},(_,i)=>`<a href="/Administration/Games/ActionMonitor.aspx?gid=42&tab=${tab}&page=${i+1}">${i+1}</a>`).join('')}`;
}
function filters(){return '<select id="ddlPlayers" name="tid"></select><select id="ddlLevels" name="level"></select><select id="ddlCorrectionTypes" name="type"></select><input type="hidden" name="gid" value="42">';}
function correction(id:number,options:{bonus?:boolean;comment?:string;seconds?:number;emptyBonus?:boolean}={}){
  const bonus=options.bonus??true,link=`<a id="PlayersRepeater_ctl00_${bonus?'lnkBonus':'lnkPenalty'}" href="/GameBonusPenaltyTime.aspx?gid=42&amp;correct=${id}">${bonus?'бонус':'штраф'} ${options.seconds??37} секунд</a>`;
  return `<tr class="toWinnerItem" id="PlayersRepeater_ctl00_trItem"><td>19.12.2025 00:14:58</td><td>${participant}</td><td id="PlayersRepeater_ctl00_tdLevelColumnValue">2</td><td>добавлен администратором</td><td>${options.emptyBonus?'<a id="PlayersRepeater_ctl00_lnkBonus"></a>':''}${link}<a href="/GameBonusPenaltyTime.aspx?gid=42&amp;action=edit&amp;correct=${id}">edit</a></td><td>${escape(options.comment??'literal 001 + &')}</td></tr>`;
}
function correctionForm(id?:number,value={seconds:37,isBonus:true,comment:'literal 001 + &'}){
  const update=id!==undefined,options=(name:string,values:number[],selected:number)=>`<select name="${name}">${values.map(n=>`<option value="${n}"${n===selected?' selected':''}>${n}</option>`).join('')}</select>`;
  return `${update?`<a href="/GameBonusPenaltyTime.aspx?gid=42&amp;action=delete&amp;correct=${id}">delete</a>`:''}<form method="post" action="/GameBonusPenaltyTime.aspx?gid=42&amp;action=${update?'update&amp;correct='+id:'save'}"><input type="hidden" name="__VIEWSTATE" value="opaque"><input type="radio" name="radioCorrectionType" value="1"${value.isBonus?' checked':''}><input type="radio" name="radioCorrectionType" value="2"${!value.isBonus?' checked':''}>${options('ddlEditCorrectionPlayers',[7],7)}${options('ddlEditCorrectionLevels',[0,154],154)}${options('DaysList',Array.from({length:31},(_,n)=>n),Math.floor(value.seconds/86400))}${options('HoursList',Array.from({length:24},(_,n)=>n),Math.floor(value.seconds/3600)%24)}${options('MinutesList',Array.from({length:60},(_,n)=>n),Math.floor(value.seconds/60)%60)}${options('SecondsList',Array.from({length:60},(_,n)=>n),value.seconds%60)}<textarea name="txtEditCorrectionComment">${escape(value.comment)}</textarea><input type="image" name="ctl13_ctl00_btnEditCorrection${update?'Update':'Add'}"></form>`;
}

test('monitoring parser preserves multiplicity, nested literal codes, timeout kind and local timestamp',()=>{
  const path=legacyMonitoringPath(42,{tab:0},1),html=monitor(0),result=parseLegacyMonitoring(page(path,html),binding,path,{tab:0},1);
  assert.equal(parseLegacyMonitoring(page(path,html.replace('00:14:58.053','0:14:58.053')),binding,path,{tab:0},1).events[0].answer_date_time,'19.12.2025 0:14:58.053');
  assert.equal(result.events[0].answer_text,'00А  + 1');assert.equal(result.events[0].timezone,null);assert.equal(result.events[0].server_action_id,null);
  assert.equal(result.events[0].team_id,7);assert.equal(result.events[0].user_id,8);assert.equal(result.events[0].level_num,2);assert.equal('level_id'in result.events[0],false);
  const duplicated=html.replace('</table>',html.slice(html.indexOf('<tr>'),html.indexOf('</table>'))+'</table>');assert.equal(parseLegacyMonitoring(page(path,duplicated),binding,path,{tab:0},1).events.length,2);
  assert.equal(parseLegacyMonitoring(page(path,monitor(0,{timeout:true})),binding,path,{tab:0},1).events[0].event_kind,'timeout');
  const bonusPath=legacyMonitoringPath(42,{tab:1},1),bonus=parseLegacyMonitoring(page(bonusPath,monitor(1)),binding,bonusPath,{tab:1},1);assert.equal(bonus.events[0].bonus_id,19);assert.equal(bonus.events[0].progress,null);
  assert.throws(()=>parseLegacyMonitoring(page(path,'<html>Not authorized</html>'),binding,path,{tab:0},1));
});

test('both tabs and every page retain all filters and boundary changes mark incomplete',async()=>{
  const calls:LegacyRecipe[]=[];let changing=false,firstReads=0;
  const session:LegacySessionPort={binding,currentBinding:async()=>binding,dispatch:async recipe=>{calls.push(recipe);const url=new URL(recipe.path,'https://cp.en.cx'),tab=Number(url.searchParams.get('item'))as 0|1;if(tab===0&&url.searchParams.get('page')==='1')firstReads++;return page(recipe.path,monitor(tab,{pages:2,answer:changing&&firstReads>1?'changed':'literal'}));}};
  const api=new LegacyObservations(session),ledger=await api.monitoringLedger({level:2,teamId:7,userId:8,search:'001 + &',typeAnswers:2});
  assert.equal(ledger.events.length,4);assert.equal(ledger.legacy_evidence.complete,true);assert.deepEqual(ledger.legacy_evidence.coverage,[{tab:0,pages:2,rows:2},{tab:1,pages:2,rows:2}]);
  for(const recipe of calls){const q=new URL(recipe.path,'https://cp.en.cx').searchParams;assert.equal(q.get('levels'),'2');assert.equal(q.get('teamname'),'7');assert.equal(q.get('tbSearchString'),'001 + &');assert.equal(q.get('typeanswers'),'2');assert.equal(q.has('uniquecb'),false);}
  changing=true;firstReads=0;assert.equal((await api.monitoringLedger()).legacy_evidence.complete,false);await assert.rejects(api.monitoringLedger({unique:true}));
});

test('correction ledger chooses real bonus/penalty href and preserves duration, comment and unknown identity',()=>{
  const path='/GameBonusPenaltyTime.aspx?gid=42&lang=ru';const ledger=parseLegacyCorrections(page(path,filters()+'<table>'+correction(91,{bonus:false,emptyBonus:true})+'</table>'),binding,path);
  const noEdit=filters()+'<table>'+correction(91).replace(/<a href="[^"]+action=edit[^"]+">edit<\/a>/,'')+'</table>';
  assert.equal(parseLegacyCorrections(page(path,noEdit),binding,path).items[0].can_edit,null);
  assert.equal(ledger.items[0].correction_value,-37);assert.equal(ledger.items[0].can_edit,true);assert.equal(ledger.items[0].comment,'literal 001 + &');assert.equal('game_player_id'in ledger.items[0],false);
  assert.equal(parseLegacyCorrections(page(path,filters()),binding,path).items.length,0);assert.throws(()=>parseLegacyCorrections(page(path,'<html>error</html>'),binding,path));
  assert.equal(legacyDurationSeconds('бонус 6 дней'),518400);assert.equal(legacyDurationSeconds('штраф 1 день 2 часа 3 минуты 4 секунды'),93784);assert.equal(legacyDurationSeconds('bonus 37 seconds'),null);
});

test('correction form uses persistent level ID, duration components, exact comment and selected image submitter',()=>{
  const path='/GameBonusPenaltyTime.aspx?gid=42&action=add',form=parseLegacyCorrectionForm(page(path,correctionForm()),binding,path,false),body=new URLSearchParams(legacyCorrectionBody(form,{playerId:7,levelId:154,seconds:518437,isBonus:false,comment:'001 + &\nline'}));
  assert.equal(new URLSearchParams(legacyCorrectionBody(form,{playerId:7,levelId:0,seconds:37,isBonus:true,comment:'all levels'})).get('ddlEditCorrectionLevels'),'0');
  assert.equal(body.get('ddlEditCorrectionLevels'),'154');assert.equal(body.get('DaysList'),'6');assert.equal(body.get('SecondsList'),'37');assert.equal(body.get('radioCorrectionType'),'2');assert.equal(body.get('txtEditCorrectionComment'),'001 + &\r\nline');assert.equal(body.get('ctl13_ctl00_btnEditCorrectionAdd.x'),'1');assert.equal(body.get('__VIEWSTATE'),'opaque');
  for(const patch of [{levelId:2},{playerId:8},{seconds:31*86400},{seconds:0},{seconds:1.5}])assert.throws(()=>legacyCorrectionBody(form,{playerId:7,levelId:154,seconds:37,isBonus:true,comment:'why',...patch}));
  const full=correctionForm().replace('</form>','<input type="checkbox" name="unknownFlag" value="false" checked><input type="checkbox" name="unchecked" value="on"><input type="text" name="unknownField" value="001 + &amp;"><input type="text" name="disabledField" disabled value="secret"></form>')+'<form method="get"><input type="hidden" name="foreignHidden" value="foreign"></form>';
  const preserved=new URLSearchParams(legacyCorrectionBody(parseLegacyCorrectionForm(page(path,full),binding,path,false),{playerId:7,levelId:154,seconds:37,isBonus:true,comment:'why'}));
  assert.equal(preserved.get('unknownFlag'),'false');assert.equal(preserved.get('unknownField'),'001 + &');assert.equal(preserved.has('unchecked'),false);assert.equal(preserved.has('disabledField'),false);assert.equal(preserved.has('foreignHidden'),false);
  assert.throws(()=>parseLegacyCorrectionForm(page(path,correctionForm().replace('action=save','action=delete')),binding,path,false));
});

test('correction create update delete dispatch once and independently verify ledger plus exact form',async()=>{
  let stored:{id:number;seconds:number;isBonus:boolean;comment:string}|undefined;const calls:LegacyRecipe[]=[];
  const session:LegacySessionPort={binding,currentBinding:async()=>binding,dispatch:async recipe=>{
    calls.push(recipe);const url=new URL(recipe.path,'https://cp.en.cx'),action=url.searchParams.get('action');
    if(recipe.effect==='mutation'){
      if(action==='delete')stored=undefined;
      else {const fields=new URLSearchParams(recipe.body);stored={id:91,seconds:Number(fields.get('DaysList'))*86400+Number(fields.get('HoursList'))*3600+Number(fields.get('MinutesList'))*60+Number(fields.get('SecondsList')),isBonus:fields.get('radioCorrectionType')==='1',comment:fields.get('txtEditCorrectionComment')!};}
      return {status:0,url:'https://cp.en.cx'+recipe.path,html:''};
    }
    if(action==='add'||action==='edit')return page(recipe.path,correctionForm(action==='edit'?91:undefined,stored??undefined));
    return page(recipe.path,filters()+'<table>'+correction(90)+(stored?correction(stored.id,{seconds:stored.seconds,bonus:stored.isBonus,comment:stored.comment}):'')+'</table>');
  }};
  const api=new LegacyObservations(session),base='/games/42/corrections',write={player_id:7,level_id:154,seconds:37,is_bonus:true,comment:'marker'};
  const version=async()=>({"If-Match":(await (await api.request(base))!.json()).version});
  assert.equal((await api.request(base,{method:'POST',body:JSON.stringify(write)}))?.status,428);
  assert.equal((await api.request(base,{method:'POST',headers:{'If-Match':'stale'},body:JSON.stringify(write)}))?.status,409);assert.equal(calls.filter(row=>row.effect==='mutation').length,0);
  assert.equal((await api.request(base,{method:'POST',headers:await version(),body:JSON.stringify(write)}))?.status,201);assert.equal(calls.filter(row=>row.effect==='mutation').length,1);
  assert.equal((await api.request(base+'/91',{method:'PUT',headers:await version(),body:JSON.stringify({...write,seconds:53,is_bonus:false,comment:'changed'})}))?.status,200);assert.equal(calls.filter(row=>row.effect==='mutation').length,2);
  assert.equal((await api.request(base+'/91',{method:'DELETE',headers:await version()}))?.status,204);assert.equal(calls.filter(row=>row.effect==='mutation').length,3);assert.equal(calls.find(row=>row.kind==='correction-delete')?.method,'GET');
});

test('lost create acknowledgment is read back without retry; unknown outcome stays unknown',async()=>{
  let mutations=0;
  const session:LegacySessionPort={binding,currentBinding:async()=>binding,dispatch:async recipe=>{if(recipe.effect==='mutation'){mutations++;throw new Error('network');}if(recipe.kind==='correction-form')return page(recipe.path,correctionForm());return page(recipe.path,filters()+'<table>'+correction(90)+'</table>');}};
  const api=new LegacyObservations(session),version=(await (await api.request('/games/42/corrections'))!.json()).version;
  await assert.rejects(api.request('/games/42/corrections',{method:'POST',headers:{'If-Match':version},body:JSON.stringify({player_id:7,level_id:154,seconds:37,is_bonus:true,comment:'marker'})}),/unknown-after-dispatch/);assert.equal(mutations,1);
});

test('empty ledger numeric options cannot establish team recipient identity',async()=>{
  let writes=0;const session:LegacySessionPort={binding,currentBinding:async()=>binding,dispatch:async recipe=>{if(recipe.effect==='mutation')writes++;return page(recipe.path,recipe.kind==='correction-form'?correctionForm():filters());}};
  const api=new LegacyObservations(session),before=await (await api.request('/games/42/corrections'))!.json();
  const response=await api.request('/games/42/corrections',{method:'POST',headers:{'If-Match':before.version},body:JSON.stringify({player_id:7,level_id:154,seconds:37,is_bonus:true,comment:'why'})});
  assert.equal(response?.status,422);assert.equal(writes,0);assert.match(before.legacy_evidence.recipient_write_policy,/empty ledger/);
});

test('empty correction ledger accepts an independently verified native team roster and dispatches exactly once',async()=>{
 let writes=0,created=false;
 const roster='<table class="players"><tr id="trPlayer"><td><a id="lnkPlayer" href="/Teams/TeamDetails.aspx?tid=7">Team</a></td><td><a id="lnkAction1" href="/GamePlayers.aspx?action=disqualify&page=1&sort=1&status=1&player=700&gid=42">action</a></td></tr></table>';
 const session:LegacySessionPort={binding,currentBinding:async()=>binding,dispatch:async recipe=>{
   if(recipe.effect==='mutation'){assert.equal(recipe.kind,'correction-write');writes++;created=true;return page(recipe.path,'');}
   if(recipe.kind==='players-read')return page(recipe.path,roster);
   if(recipe.kind==='correction-form')return page(recipe.path,correctionForm(recipe.path.includes('action=edit')?91:undefined,{seconds:37,isBonus:true,comment:'why'}));
   return page(recipe.path,filters()+(created?'<table>'+correction(91,{comment:'why'})+'</table>':''));
 }};
 const api=new LegacyObservations(session),before=await (await api.request('/games/42/corrections'))!.json();
 const result=await api.request('/games/42/corrections',{method:'POST',headers:{'If-Match':before.version},body:JSON.stringify({player_id:7,level_id:154,seconds:37,is_bonus:true,comment:'why'})});
 assert.equal(result?.status,201);assert.equal((await result!.json()).correct_id,91);assert.equal(writes,1);
});

test('adapter invalidation fences a correction form before mutation and preserves uncertainty after dispatch',async()=>{
  for(const invalidateAt of ['form','mutation']as const){
    let writes=0,formReads=0;
    const api=new LegacyAuthoringAdapter({binding,currentBinding:async()=>binding,dispatch:async recipe=>{
      if(recipe.effect==='mutation'){writes++;api.invalidate();return page(recipe.path,'');}
      if(recipe.kind==='correction-form'){formReads++;if(invalidateAt==='form')api.invalidate();return page(recipe.path,correctionForm());}
      return page(recipe.path,filters()+'<table>'+correction(90)+'</table>');
    }});
    const base='/games/42/corrections',before=await(await api.request(base)).json();
    await assert.rejects(api.request(base,{method:'POST',headers:{'If-Match':before.version},body:JSON.stringify({player_id:7,level_id:154,seconds:37,is_bonus:true,comment:'marker'})}),{code:invalidateAt==='form'?'session-changed':'unknown-after-dispatch'});
    assert.equal(formReads,1);assert.equal(writes,invalidateAt==='form'?0:1);
    await assert.rejects(api.request(base),{code:'session-changed'});
  }
});

test('adapter invalidation during a deferred binding check prevents dispatch',async()=>{
  let checks=0,dispatches=0,resolveBinding!:(value:typeof binding)=>void,reached!:()=>void;
  const waiting=new Promise<void>(resolve=>{reached=resolve;});
  const api=new LegacyAuthoringAdapter({binding,currentBinding:async()=>{
    if(++checks!==2)return binding;
    reached();return new Promise(resolve=>{resolveBinding=resolve;});
  },dispatch:async recipe=>{dispatches++;return page(recipe.path,'');}});
  const pending=api.request('/admin/games/42/levels/9/editor');
  await waiting;api.invalidate();resolveBinding(binding);
  await assert.rejects(pending,{code:'session-changed'});assert.equal(dispatches,0);
});

test('adapter invalidation between binding validation and dispatch prevents dispatch',async()=>{
  let checks=0,dispatches=0;
  const api=new LegacyAuthoringAdapter({binding,currentBinding:async()=>{
    if(++checks===2)queueMicrotask(()=>queueMicrotask(()=>api.invalidate()));
    return binding;
  },dispatch:async recipe=>{dispatches++;return page(recipe.path,'');}});
  await assert.rejects(api.request('/admin/games/42/levels/9/editor'),{code:'session-changed'});
  assert.equal(dispatches,0);
});
