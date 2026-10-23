import test from 'node:test';
import assert from 'node:assert/strict';
import {LegacyBonuses} from '../src/legacy-bonuses.ts';
import {authoringBinding} from '../src/authoring-api.ts';
import type {LegacySessionPort,LegacyRecipe} from '../src/legacy-authoring.ts';
const binding=authoringBinding('tech.en.cx',42,'opaque'),scope='/admin/games/42/levels/154/bonuses';
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const field=(name:string,value:string)=>`<input name="${name}" value="${escape(value)}">`;
function fixture(){
 const calls:LegacyRecipe[]=[];let next=200,lost=false,siblingRace=false,ordinalRace=false,ordinal=2,changeTopology=false,disabledMapped=false,unknownEditor=false;
 const fresh=()=>new URLSearchParams({ddlBonusFor:'0',txtBonusName:'Before',txtTask:'Task',txtHelp:'Help',rbAllLevels:'1',level_154:'on',txtValidFrom:'10/24/2027 8:05:00 AM',txtValidTo:'10/25/2027 8:05:00 AM',txtHours:'0',txtMinutes:'1',txtSeconds:'5',txtDelayHours:'0',txtDelayMinutes:'2',txtDelaySeconds:'0',txtValidHours:'0',txtValidMinutes:'3',txtValidSeconds:'0',unknown:'retain',answer_71:'001 + &'});
 const state=new Map<number,URLSearchParams>([[10,fresh()]]);
 function form(id:number|undefined){const value=id===undefined?fresh():state.get(id)!;const action=`/Administration/Games/BonusEdit.aspx?gid=42&level=${ordinal}&bonus=${id??0}&action=${id===undefined?'save':'update'}`;
  let html=`<form method="post" action="${action}"><select name="ddlBonusFor"><option value="0" selected>All</option></select>`;
  for(const name of ['txtBonusName','txtTask','txtHelp','txtValidFrom','txtValidTo','txtHours','txtMinutes','txtSeconds','txtDelayHours','txtDelayMinutes','txtDelaySeconds','txtValidHours','txtValidMinutes','txtValidSeconds','unknown']){const input=field(name,value.get(name)??''),off=(['txtValidFrom','txtValidTo'].includes(name)&&!value.has('chkAbsoluteLimit')||name.startsWith('txtDelay')&&!value.has('chkDelay')||/^txtValid(?:Hours|Minutes|Seconds)$/.test(name)&&!value.has('chkRelativeLimit'))&&!(disabledMapped&&name==='txtDelayMinutes');html+=off?input.slice(0,-1)+' disabled>':input;}
  html+=field('tags','first')+field('tags','second');
  for(const option of ['0','1'])html+=`<input type="radio" name="rbAllLevels" value="${option}"${value.get('rbAllLevels')===option?' checked':''}>`;
  for(const name of ['level_154','level_155','negative','chkAbsoluteLimit','chkDelay','chkRelativeLimit'])html+=`<input type="checkbox" name="${name}" value="on"${value.has(name)?' checked':''}>`;
  if(id!==undefined)for(const [name,text]of value)if(/^answer_[1-9]\d*$/.test(name))html+=field(name,text);
  for(const slot of [-1,-2,-3])html+=field('answer_'+slot,'');
  html+=`<input type="image" name="${id===undefined?'btnAdd':'btnUpdate'}"></form>`;
  return html;
 }
 const session:LegacySessionPort={binding,currentBinding:async()=>binding,dispatch:async recipe=>{calls.push(recipe);const url=new URL(recipe.path,'https://tech.en.cx');let html='';
  if(recipe.kind==='level-index')html=`<form name="LevelsCreateForm"></form><table><tr><td><input name="txtLevelName_154" value="Level"><a href="/Administration/Games/LevelEditor.aspx?gid=42&level=${ordinal}">${ordinal}</a></td></tr><tr><td><input name="txtLevelName_155" value="Other"><a href="/Administration/Games/LevelEditor.aspx?gid=42&level=3">3</a></td></tr></table>`;
  else if(recipe.kind==='level-editor-read')html=unknownEditor?'<html><a href="TaskEdit.aspx">Task only</a></html>':`<a href="javascript:GameEditor('./BonusEdit.aspx?gid=42&level=${ordinal}&action=add','',700,790)">Add</a>`+[...state.keys()].map(id=>`<a href="javascript:GameEditor('./BonusEdit.aspx?gid=42&level=${ordinal}&bonus=${id}&action=view','',700,790)">Bonus</a>`).join('');
  else if(recipe.kind==='bonus-form-read'){html=url.searchParams.get('action')==='view'?`<a href="/Administration/Games/BonusEdit.aspx?level=${ordinal}&gid=42&bonus=${url.searchParams.get('bonus')}&action=delete" onclick="javascript:return ConfirmDelete();">Delete</a>`:form(url.searchParams.has('bonus')?Number(url.searchParams.get('bonus')):undefined);}
  else if(recipe.kind==='bonus-write'){
   const body=new URLSearchParams(recipe.body);assert.equal(body.get('unknown'),'retain');assert.deepEqual(body.getAll('tags'),['first','second']);const id=url.searchParams.get('action')==='save'?next++:Number(url.searchParams.get('bonus'));assert.equal(body.has((url.searchParams.get('action')==='save'?'btnAdd':'btnUpdate')+'.x'),true);
   for(const name of ['txtValidFrom','txtValidTo','txtDelayHours','txtDelayMinutes','txtDelaySeconds','txtValidHours','txtValidMinutes','txtValidSeconds'])if(!body.has(name))body.set(name,(state.get(id)??fresh()).get(name)!);
   for(const [name,value]of [...body])if(/^answer_-[1-9]\d*$/.test(name)){body.delete(name);if(value)body.set('answer_'+next++,value);}for(const [name,value]of [...body])if(/^answer_[1-9]\d*$/.test(name)&&!value)body.delete(name);
   if(siblingRace)body.set('unknown','concurrent');state.set(id,body);if(changeTopology)disabledMapped=true;if(ordinalRace)ordinal=4;if(lost)throw new Error('Lost acknowledgment');
  }else if(recipe.kind==='bonus-delete')state.delete(Number(url.searchParams.get('bonus')));else assert.fail(recipe.kind);
  return {status:200,url:url.href,html};}};
 return {api:new LegacyBonuses(session),calls,state,lost:()=>{lost=true;},race:()=>{siblingRace=true;},move:()=>{ordinalRace=true;},topology:()=>{changeTopology=true;},unknown:()=>{unknownEditor=true;}};
}
async function read(f:ReturnType<typeof fixture>){return (await f.api.request(scope,{method:'GET'}))!.json();}

test('creation-scoped ledger scales independently of sibling bodies and preserves exact new code',async()=>{
 const f=fixture();for(let id=11;id<111;id++)f.state.set(id,new URLSearchParams(f.state.get(10)!));
 const path=scope+'/creation',before=await (await f.api.request(path,{method:'GET'}))!.json();assert.equal(before.bonus_ids.length,101);
 const result=await f.api.request(path,{method:'POST',headers:{'If-Match':before.version},body:JSON.stringify({bonus_name:'Cell',bonus_text:'',help_text:'<div>001 + &</div>',reward_seconds:15,is_negative:false,all_levels:false,level_ids:[154],new_answers:['001']})});
 assert.equal(result?.status,201);const row=await result!.json();assert.equal(row.help_text,'<div>001 + &</div>');assert.deepEqual(row.answers.map((r:any)=>r.answer_text),['001']);assert.equal(row.verification_scope,'created-bonus-and-membership');assert.equal(f.state.size,102);
 assert.ok(!f.calls.some(call=>call.kind==='bonus-form-read'&&/bonus=(?:10|[1-9]\d?)&/.test(call.path)));assert.equal(f.calls.filter(call=>call.effect==='mutation').length,1);
 const stale=await f.api.request(path,{method:'POST',headers:{'If-Match':before.version},body:'{}'});assert.equal(stale?.status,409);
});

test('creation-scoped writes retain preservation and ordinal checks',async()=>{for(const mode of ['race','move'] as const){const f=fixture(),path=scope+'/creation',before=await (await f.api.request(path,{method:'GET'}))!.json();f[mode]();await assert.rejects(f.api.request(path,{method:'POST',headers:{'If-Match':before.version},body:JSON.stringify({bonus_name:'Cell',bonus_text:'',help_text:'H',reward_seconds:15,is_negative:false,all_levels:false,level_ids:[154],new_answers:['001']})}),{code:'unknown-after-dispatch'});assert.equal(f.calls.filter(call=>call.effect==='mutation').length,1);}});
test('full bonus ledger and CRUD preserve inactive timing, recipients, targets, repeat controls and exact answer identities',async()=>{
 const f=fixture(),before=await read(f);assert.equal(before.bonuses[0].all_levels,false);assert.equal(before.bonuses[0].delay_seconds,120);assert.equal(before.bonuses[0].absolute_from,'10/24/2027 8:05:00 AM');
 const changed=await f.api.request(scope+'/10',{method:'PUT',headers:{'If-Match':before.version},body:JSON.stringify({bonus_text:'Literal\n001 + &',reward_seconds:0,is_negative:false,answers:[{answer_id:71,answer_text:'002'}],new_answers:['003']})});assert.equal(changed?.status,200);
 const updated=await changed!.json();assert.deepEqual(updated.answers.map((row:any)=>row.answer_text),['002','003']);assert.equal(updated.delay_enabled,false);assert.equal(updated.delay_seconds,120);assert.deepEqual(updated.level_ids,[154]);
 const after=await read(f),created=await f.api.request(scope,{method:'POST',headers:{'If-Match':after.version},body:JSON.stringify({bonus_name:'Created',bonus_text:'T',help_text:'H',reward_seconds:53,is_negative:true,all_levels:false,level_ids:[154],new_answers:['001 + &']})});assert.equal(created?.status,201);
 const row=await created!.json(),final=await read(f);assert.equal(row.is_negative,true);assert.equal(row.recipient_member_id,0);assert.equal((await f.api.request(scope+'/'+row.bonus_id,{method:'DELETE',headers:{'If-Match':final.version}}))?.status,204);
 assert.equal(f.calls.filter(row=>row.effect==='mutation').length,3);
});
test('stale revisions, unknown answer IDs and implicit answer deletion do not dispatch',async()=>{
 const f=fixture(),before=await read(f);assert.equal((await f.api.request(scope+'/10',{method:'PUT',body:'{"bonus_name":"X"}'}))?.status,428);
 for(const fields of [{answers:[{answer_id:999,answer_text:'X'}]},{answers:[{answer_id:71,answer_text:''}]},{new_answers:['']},{all_levels:true}])await assert.rejects(f.api.request(scope+'/10',{method:'PUT',headers:{'If-Match':before.version},body:JSON.stringify(fields)}));
 assert.equal(f.calls.filter(row=>row.effect==='mutation').length,0);
});
test('lost acknowledgment reconciles without retry and changed siblings or ordinal remain unknown',async()=>{
 for(const conflict of [false,true]){const f=fixture(),before=await read(f);f.lost();if(conflict)f.race();const promise=f.api.request(scope+'/10',{method:'PUT',headers:{'If-Match':before.version},body:'{"bonus_name":"Changed"}'});if(conflict)await assert.rejects(promise,{code:'unknown-after-dispatch'});else assert.equal((await promise)?.status,200);assert.equal(f.calls.filter(row=>row.effect==='mutation').length,1);}
 const f=fixture(),before=await read(f);f.move();await assert.rejects(f.api.request(scope+'/10',{method:'PUT',headers:{'If-Match':before.version},body:'{"bonus_name":"Changed"}'}),{code:'unknown-after-dispatch'});
});
test('equal mapped values with changed enabled topology retain an opaque reconciliation mismatch',async()=>{
 const f=fixture(),before=await read(f);f.topology();await assert.rejects(f.api.request(scope+'/10',{method:'PUT',headers:{'If-Match':before.version},body:'{"bonus_name":"Changed"}'}),{code:'unknown-after-dispatch'});
 const after=await read(f);assert.equal(after.bonuses[0].delay_seconds,before.bonuses[0].delay_seconds);assert.notDeepEqual(after.bonuses[0]._authoring_timing_disabled,before.bonuses[0]._authoring_timing_disabled);assert.equal(f.calls.filter(row=>row.effect==='mutation').length,1);
});
test('unknown bonus surface cannot fabricate a complete empty inventory',async()=>{const f=fixture();f.unknown();await assert.rejects(read(f),{code:'incomplete-read'});assert.equal(f.calls.filter(row=>row.effect==='mutation').length,0);});
test('explicit native flags enable only proven timing controls and retain inactive values when disabled again',async()=>{
 const f=fixture(),before=await read(f),enabled=await f.api.request(scope+'/10',{method:'PUT',headers:{'If-Match':before.version},body:JSON.stringify({delay_enabled:true,delay_seconds:53,relative_enabled:true,relative_seconds:61,absolute_enabled:true,absolute_from:'10/24/2027 8:05:00 AM',absolute_to:'10/25/2027 8:05:00 AM'})});assert.equal(enabled?.status,200);const row=await enabled!.json();assert.equal(row.delay_seconds,53);assert.equal(row._authoring_timing_disabled.txtDelayMinutes,false);
 const next=await read(f),disabled=await f.api.request(scope+'/10',{method:'PUT',headers:{'If-Match':next.version},body:'{"delay_enabled":false,"relative_enabled":false,"absolute_enabled":false}'});assert.equal(disabled?.status,200);const inactive=await disabled!.json();assert.equal(inactive.delay_seconds,53);assert.equal(inactive.relative_seconds,61);assert.equal(inactive._authoring_timing_disabled.txtDelayMinutes,true);
 const write=f.calls.find(row=>row.kind==='bonus-write')!;assert.equal(new URLSearchParams(write.body).get('txtDelaySeconds'),'53');
 assert.ok(f.calls.some(row=>row.kind==='bonus-form-read'&&row.path.includes('action=edit')));
});
