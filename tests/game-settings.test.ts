import test from 'node:test';
import assert from 'node:assert/strict';
import {authoringBinding,type AuthoringApiPort} from '../src/authoring-api.ts';
import {LegacyGame,parseLegacyGameForm} from '../src/legacy-game.ts';
import type {LegacySessionPort,LegacyRecipe} from '../src/legacy-authoring.ts';
import {legacyGameSettingNames,modernGameSettingTypes,validateGameSettingsPatch,checkGameSettingsBefore,verifyGameSettingsChange,gameSettingsRequest} from '../src/game-settings.ts';
const binding=authoringBinding('tech.en.cx',42,'game-settings-test');
const editor='/Administration/Games/GameEditor.aspx?gid=42&action=edit';
const booleans=['show_finish_place','hide_game_descr','hide_players_list','hide_game_from_calendar','hide_levels_names','is_available_after_finished'];
const selects=['stat_availability_type_id','scenario_availability','show_fee','certificate_access_mode','accept_rate_mode','author_complexity','fee_currency_id'];
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function form(values:Record<string,unknown>={},disabledStart=false,option='1'){
 return '<form id="game" action="/Administration/Games/GameEditor.aspx" method="post"><input type="hidden" name="gid" value="42"><input type="hidden" name="action" value="update"><input type="hidden" name="__VIEWSTATE" value="opaque"><input type="hidden" name="vp1" value="untouched"><input name="unknown" value="a"><input name="unknown" value="b"><input type="checkbox" name="unknownUnchecked" value="yes"><input type="image" name="btnUpdate">'+Object.entries(legacyGameSettingNames).map(([key,name])=>{
  const value=values[key]??(booleans.includes(key)?false:key==='is_moderated'?true:selects.includes(key)?'0':'old');
  if(booleans.includes(key))return `<input type="checkbox" name="${name}" value="native-yes" ${value?'checked':''}>`;
  if(key==='is_moderated')return `<input type="radio" name="${name}" value="true" ${value?'checked':''}><input type="radio" name="${name}" value="false" ${value?'':'checked'}>`;
  if(selects.includes(key))return `<select name="${name}"><option value="0" ${value==='0'?'selected':''}>zero</option><option value="${option}" ${value===option?'selected':''}>one</option><option value="9" disabled>disabled</option></select>`;
  if(key==='descr')return `<textarea name="${name}">${escape(String(value))}</textarea>`;
  return `<input name="${name}" value="${escape(String(value))}" ${key==='start_date_time'&&disabledStart?'disabled':''}>`;
 }).join('')+'</form>';
}
const page=(html:string)=>({status:200,url:'https://tech.en.cx'+editor,html});
test('every native mapped game field round-trips in one full form dispatch preserving literal siblings',async()=>{
 let values:Record<string,unknown>={},writes=0;const session:LegacySessionPort={binding,currentBinding:async()=>binding,dispatch:async(recipe:LegacyRecipe)=>{
  if(recipe.effect==='read')return page(form(values));writes++;const body=new URLSearchParams(recipe.body);
  assert.deepEqual(body.getAll('unknown'),['a','b']);assert.equal(body.get('vp1'),'untouched');assert.equal(body.has('unknownUnchecked'),false);assert.equal(body.get('__VIEWSTATE'),'opaque');
  for(const [key,name]of Object.entries(legacyGameSettingNames))values[key]=booleans.includes(key)?body.has(name):key==='is_moderated'?body.get(name)==='true':body.get(name)?.replace(/\r\n/g,'\n');
  return {status:302,url:'https://tech.en.cx/Administration/GamesManager.aspx',html:''};
 }};
 const api=new LegacyGame(session),before=await(await api.request('/admin/games/42'))!.json();
 assert.deepEqual(new Set(before.editable_fields),new Set(Object.keys(legacyGameSettingNames)));
 const fields=Object.fromEntries(Object.keys(legacyGameSettingNames).map(key=>[key,booleans.includes(key)?true:key==='is_moderated'?false:selects.includes(key)?'1':'001 + <literal>\nnext']));
 const result=await api.request('/admin/games/42',{method:'PATCH',headers:{'If-Match':before.version},body:JSON.stringify(fields)});
 assert.equal(result?.status,200);const after=await result!.json();assert.equal(writes,1);assert.equal(verifyGameSettingsChange('legacy',before,after,fields),true);
 assert.equal(JSON.stringify(after).includes('__VIEWSTATE'),false);assert.equal(JSON.stringify(after).includes('opaque'),false);
});
test('disabled date, absent fields, invalid native options and forged POST controls are rejected before dispatch',async()=>{
 let writes=0;const api=new LegacyGame({binding,currentBinding:async()=>binding,dispatch:async recipe=>{if(recipe.effect==='mutation')writes++;return page(form({},true));}});
 const before=await(await api.request('/admin/games/42'))!.json();assert.equal(before.editable_fields.includes('start_date_time'),false);
 for(const patch of [{start_date_time:'changed'},{show_fee:'9'},{vp1:'overwrite'},{hide_players_list:'true'},{poster_url:'fake.png'}])await assert.rejects(api.request('/admin/games/42',{method:'PATCH',headers:{'If-Match':before.version},body:JSON.stringify(patch)}));
 assert.equal(writes,0);
});
test('native option topology changes invalidate the observed revision even when selected values are identical',async()=>{
 let option='1',writes=0;const api=new LegacyGame({binding,currentBinding:async()=>binding,dispatch:async recipe=>{if(recipe.effect==='mutation')writes++;return page(form({},false,option));}});
 const before=await(await api.request('/admin/games/42'))!.json();option='2';assert.equal((await api.request('/admin/games/42',{method:'PATCH',headers:{'If-Match':before.version},body:JSON.stringify({descr:'new'})}))?.status,409);assert.equal(writes,0);
});
test('modern full request schema preserves false, zero, empty strings, explicit authors and native money units',async()=>{
 const fields:Record<string,unknown>={};for(const [key,type]of Object.entries(modernGameSettingTypes))fields[key]=type==='integer'?0:type==='boolean'?false:type==='number'?0:type==='authors'?[]:key.endsWith('_date_time')||key==='request_last_date'?'2030-01-01T12:00:00+03:00':'';
 assert.deepEqual(validateGameSettingsPatch('modern',fields),fields);
 const before={game:{id:42,price:100,prize:200,title:'old',is_moderated:true,descr:'old',afc:1},authors:[{user_id:1,login:'old'}],referees:[]};
 const patch={price_cents:0,prize_cents:0,title:'',is_moderated:false,descr:'',afc:0,authors:[]};checkGameSettingsBefore('modern',before,patch);
 const after={game:{...before.game,price:0,prize:0,title:'',is_moderated:false,descr:'',afc:0},authors:[],referees:[]};assert.equal(verifyGameSettingsChange('modern',before,after,patch),true);
 assert.equal(verifyGameSettingsChange('modern',before,{...after,game:{...after.game,afc:0.1}},patch),false);
 const requests:RequestInit[]=[];const api={metadata:{binding:{engine:'modern',gameId:42}},request:async(_path:string,init:RequestInit)=>{requests.push(init);return Response.json({});}} as unknown as AuthoringApiPort;
 await gameSettingsRequest(api,patch,before);assert.equal(requests.length,1);assert.deepEqual(JSON.parse(String(requests[0].body)),patch);assert.equal(new Headers(requests[0].headers).has('If-Match'),false);
});
test('modern validation and readback guard refuse unknown/wrong fields, fractional AFC, timezone guesses and unreadable write-only settings',()=>{
 for(const patch of [{anything:true},{max_players:'3'},{afc:0.25},{start_date_time:'01.01.2030 12:00'},{start_date_time:'2030-01-01T12:00:00'},{authors:[{login:'x',user_id:1}]},{referees:[{login:''}]}])assert.throws(()=>validateGameSettingsPatch('modern',patch));
 assert.throws(()=>checkGameSettingsBefore('modern',{game:{id:42,started:true,start_date_time:'old'}},{start_date_time:'2030-01-01T12:00:00Z'}));
 assert.throws(()=>checkGameSettingsBefore('modern',{game:{id:42}},{remove_game_stakes_reason:'reason'}));
 const original={game:{id:42,descr:'old',replace_nl_to_br:true,hide_game_descr:true,display_announcement:0,title:'same'},authors:[],referees:[]};
 const patch={descr:'new',replace_nl_to_br:false,hide_game_descr:false,display_announcement:1};
 assert.equal(verifyGameSettingsChange('modern',original,{...original,game:{...original.game,...patch}},patch),true);
 assert.equal(verifyGameSettingsChange('modern',original,{...original,game:{...original.game,...patch,title:'lost sibling'}},patch),false);
});
