import test from 'node:test';
import assert from 'node:assert/strict';
import {authoringBinding} from '../src/authoring-api.ts';
import {LegacyStatistics,parseLegacyStatistics,parseLegacyGameStat,parseLegacyCorrectionRecipients,parseLegacyRoster,parseLegacyTimezone,legacyLocalTime} from '../src/legacy-statistics.ts';
import type {LegacyRecipe,LegacySessionPort} from '../src/legacy-authoring.ts';

const binding=authoringBinding('cp.en.cx',42,'session');
const statistic=()=>({Game:{GameID:42,GameTypeID:1,Finished:true,StartDateTime:{Value:63901481400000,Timestamp:1765884600}},PagerVisible:false,Levels:[{LevelId:154,LevelNumber:2,Dismissed:false}],StatItems:[[{LevelId:154,LevelNum:2,TeamId:7,UserId:8,TeamName:'synthetic team',UserName:'synthetic player',SpentSeconds:2700,PassType:1,ActionTime:{Value:63900000000000,Timestamp:1800000000},Corrections:{TotalSeconds:0}}]],User:{Email:'private@example.invalid',Login:'private',Token:'never-project'}});
test('legacy JSON projection allowlists safe statistics and never claims final manual-correction totals',()=>{
  const result=parseLegacyStatistics(statistic(),42);
  assert.equal(result.mode,'team');assert.equal(result.finished,true);assert.equal(result.coverage.complete,true);
  assert.equal(result.finalTotalsAvailable,false);assert.equal(result.rows[0].spentSeconds,2700);assert.equal(result.rows[0].publishedCorrectionSeconds,0);
  assert.equal(JSON.stringify(result).includes('private'),false);assert.equal('User'in result,false);
  const paged=statistic();paged.PagerVisible=true;assert.equal(parseLegacyStatistics(paged,42).coverage.complete,false);
  assert.throws(()=>parseLegacyStatistics(statistic(),43));
  const duplicate=statistic();duplicate.StatItems[0].push(duplicate.StatItems[0][0]);assert.throws(()=>parseLegacyStatistics(duplicate,42));
  const unknown=statistic();unknown.Game.GameTypeID=9;assert.throws(()=>parseLegacyStatistics(unknown,42));
  const missing=statistic() as Record<string,unknown>;delete missing.PagerVisible;assert.throws(()=>parseLegacyStatistics(missing,42));
});
const team=(id:number)=>`<a href="/Teams/TeamDetails.aspx?tid=${id}">synthetic ${id}</a>`;
const total=(id:number,kind:string,seconds:number)=>`<td class="totalCell" data-team="${id}" data-total="${kind}" data-v="${seconds}"><div class="n">14 ${team(id)}</div></td>`;
const cell=(id:number)=>`<td data-team="${id}" data-lvl="2" data-v="2700" data-c="0"><div class="dataCell">${team(id)} 28.01.2026 15:25:10.633</div><div class="cb timeout"></div></td>`;
const html=()=>`<span id="ltrGameID">42</span><table class="DataTable" id="GameStatObject2_DataTable"><tr class="levelsRow"><th>level</th></tr><tr>${cell(7)}${cell(9)}${total(7,'raw',10000)}${total(9,'corr',11000)}</tr><tr>${total(9,'raw',11000)}${total(7,'corr',9963)}</tr></table>`;
const page=(source=html())=>({status:200,url:'https://cp.en.cx/GameStat.aspx?gid=42',html:source});
test('GameStat final columns sort independently; native IDs join raw and corrected totals',()=>{
  const result=parseLegacyGameStat(page(),binding);
  assert.deepEqual(result.totals.filter(row=>row.key==='team:7').map(row=>[row.kind,row.seconds]),[['raw',10000],['corr',9963]]);
  assert.equal(result.cells[0].timeout,true);assert.equal(result.cells[0].displayedAt,'28.01.2026 15:25:10.633');
  assert.throws(()=>parseLegacyGameStat(page(html().replace(total(7,'corr',9963),'')),binding));
  assert.throws(()=>parseLegacyGameStat(page(html().replace('data-v="9963"','data-v="unknown"')),binding));
  assert.throws(()=>parseLegacyGameStat(page(html().replace('</table>',total(7,'corr',9963)+'</table>')),binding));
  assert.throws(()=>parseLegacyGameStat(page(html()+'<a href="/GameStat.aspx?gid=42&page=2">2</a>'),binding));
});
test('native correction options remain native identities without invented modern IDs or full roster claims',()=>{
  const recipients=parseLegacyCorrectionRecipients({status:200,url:'https://cp.en.cx/GameBonusPenaltyTime.aspx?gid=42&action=add',html:'<select name="ddlEditCorrectionPlayers"><option value="7">Team seven</option></select>'},binding,'team');
  assert.equal(recipients.recipients[0].gamePlayerId,null);assert.equal(recipients.rosterComplete,false);assert.equal(recipients.eligibilityKnown,false);
});

test('native accepted roster extracts real game-player ID without invoking action href',()=>{
 const source='<table class="players"><tr id="trPlayer"><td><a id="lnkPlayer" href="/Teams/TeamDetails.aspx?tid=7">Synthetic</a></td><td><a id="lnkAction1" href="/GamePlayers.aspx?action=disqualify&page=1&sort=1&status=1&player=700&gid=42">action</a></td></tr></table>';
 const page={status:200,url:'https://cp.en.cx/GamePlayers.aspx?gid=42&status=1',html:source};
 const result=parseLegacyRoster(page,binding,'team');assert.equal(result.rows[0].gamePlayerId,700);assert.equal(result.rows[0].id,7);assert.equal(result.entryTimesKnown,false);
 assert.throws(()=>parseLegacyRoster({...page,html:source.replace('player=700','player=0')},binding,'team'));
 assert.throws(()=>parseLegacyRoster({...page,html:source.replace('gid=42','gid=43')},binding,'team'));
});
test('timezone uses exact game start row, ignores script and personal timezone, validates native epoch',()=>{
 const start={value:63901481400000,timestamp:1765884600};
 const source='<table><tr><td><span class="title"><span>Начало игры</span>:</span><span class="white">16.12.2025 14:30:00 (<a href="/HowTo.aspx?about=UTC">UTC</a><script>unrelated clock code</script>&nbsp;+3)</span></td></tr><tr><td><span class="title">Начало игры в вашей временной зоне:</span><span class="white">16.12.2025 07:30:00 (UTC -4)</span></td></tr></table>';
 const page={status:200,url:'https://cp.en.cx/GameDetails.aspx?gid=42',html:source};
 assert.equal(parseLegacyTimezone(page,binding,start),180);
 assert.equal(legacyLocalTime('16.12.2025 14:30:00.983',180),1765884600983);
 assert.throws(()=>parseLegacyTimezone(page,binding,{...start,timestamp:start.timestamp+1}));
 assert.throws(()=>legacyLocalTime('31.02.2025 14:30:00',180));
});

test('native source context reads only fixed GET recipes, sanitizes profile and rejects changed final evidence',async()=>{
 const options=(name:string,values:number[])=>`<select name="${name}">${values.map(value=>`<option value="${value}">${value}</option>`).join('')}</select>`;
 const form=`<form method="post" action="/GameBonusPenaltyTime.aspx?gid=42&action=save"><input type="radio" name="radioCorrectionType" value="1" checked><input type="radio" name="radioCorrectionType" value="2">${options('ddlEditCorrectionPlayers',[7,9])}${options('ddlEditCorrectionLevels',[0,154])}${options('DaysList',[0])}${options('HoursList',[0])}${options('MinutesList',[0])}${options('SecondsList',[0])}<textarea name="txtEditCorrectionComment"></textarea><input type="image" name="ctl13_ctl00_btnEditCorrectionAdd"></form>`;
 const game='<table><tr><td><span class="title">Начало игры:</span><span class="white">16.12.2025 14:30:00 (UTC +3)</span></td></tr></table>';
 const roster='<table class="players">'+[7,9].map(id=>`<tr id="trPlayer"><td><a id="lnkPlayer" href="/Teams/TeamDetails.aspx?tid=${id}">Synthetic ${id}</a></td><td><a id="lnkAction1" href="/GamePlayers.aspx?action=disqualify&page=1&sort=1&status=1&player=${id*100}&gid=42">action</a></td></tr>`).join('')+'</table>';
 const calls:LegacyRecipe[]=[];let finalReads=0,change=false;
 const session:LegacySessionPort={binding,currentBinding:async()=>binding,dispatch:async recipe=>{
   calls.push(recipe);assert.equal(recipe.effect,'read');assert.equal(recipe.method,'GET');
   let source:string;
   if(recipe.kind==='statistics-json')source=JSON.stringify(statistic());
   else if(recipe.kind==='statistics-final'){finalReads++;source=change&&finalReads>1?html().replace('data-v="9963"','data-v="9962"'):html();}
   else if(recipe.kind==='game-read')source=game;
   else if(recipe.kind==='players-read')source=roster;
   else if(recipe.kind==='correction-form')source=form;
   else throw new Error('Unexpected recipe '+recipe.kind);
   return {status:200,url:'https://cp.en.cx'+recipe.path,html:source};
 }};
 const context=await new LegacyStatistics(session).read();assert.equal(context.complete,true);assert.equal(context.canWrite,true);assert.equal(context.roster[0].gamePlayerId,700);assert.equal(context.timezone,180);assert.equal(JSON.stringify(context).includes('private'),false);
 assert.equal(calls.filter(recipe=>recipe.kind==='statistics-json').length,2);assert.equal(calls.filter(recipe=>recipe.kind==='statistics-final').length,2);
 change=true;finalReads=0;await assert.rejects(new LegacyStatistics(session).read(),/incomplete-read/);
});
