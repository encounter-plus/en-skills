import {AuthoringApiError,type AuthoringApiPort} from './authoring-api.ts';

type Row=Record<string,unknown>;
/** Native legacy names verified against GameEditor, never arbitrary model-controlled POST keys. */
export const legacyGameSettingNames={title:'GameTitle',authors:'GameAuthors',descr:'Descr',prize:'Prize',start_date_time:'StartDateTime',finish_date_time:'FinishDateTime',request_last_date:'RequestLastDate',is_moderated:'IsModerated',show_finish_place:'chkShowFinishPlace',stat_availability_type_id:'GameStatAvailabilityList',scenario_availability:'GameScenarioAvailabilityList',max_players:'MaxPlayers',max_team_members:'MaxTeamPlayers',show_fee:'ShowFeeList',certificate_access_mode:'CertificateMode',certificate_places:'FirstPlaces',not_first_places:'NotFirstPlaces',accept_rate_mode:'radioAcceptRateMode',accept_rate_from_date_time:'txtAcceptRateFrom',author_complexity:'ddlAuthorsCompexity',fee:'Fee',fee_currency_id:'FeeCurrency',hide_game_descr:'cbIsGameShortDescrHided',hide_players_list:'HidePlayersList',hide_game_from_calendar:'HideGameFromCalendar',hide_levels_names:'HideLevelsNames',is_available_after_finished:'GameAvailAfter'} as const;

/** Complete models.AdminUpdateGameRequest from the checked SDK swagger snapshot. */
export const modernGameSettingTypes={accept_rate_from_date_time:'string',additional_parameters:'string',afc:'number',authors:'authors',certificate_access_mode:'integer',certificate_places:'integer',competition_id:'integer',descr:'string',display_announcement:'integer',display_monitoring:'integer',earn_points_from:'integer',earn_points_to:'integer',fee_currency_id:'integer',fee_name:'string',finish_date_time:'string',for_user_id:'integer',for_user_login:'string',game_type_id:'integer',hide_game_descr:'boolean',hide_levels_names:'boolean',hide_players_list:'boolean',incomplete_task_penalty_sec:'integer',is_available_after_finished:'boolean',is_moderated:'boolean',level_complete_type_id:'integer',levels_sequence_id:'integer',max_distance:'integer',max_players:'integer',max_team_members:'integer',measure_type_id:'integer',price_cents:'integer',prize_cents:'integer',prize_type:'integer',public_access:'boolean',referee_type:'boolean',referees:'authors',remove_game_stakes_reason:'string',replace_nl_to_br:'boolean',request_last_date:'string',scenario_availability:'integer',show_fee:'integer',show_finish_place:'boolean',show_in_calendar:'boolean',start_date_time:'string',stat_availability_type_id:'integer',title:'string',zone_id:'integer'} as const;
const normalize=(value:unknown):unknown=>typeof value==='string'?value.replace(/\r\n|\r/g,'\n'):value;
const stable=(value:unknown):string=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stable(v)).join(',')+'}':String(JSON.stringify(value));
export function validateGameSettingsPatch(engine:'legacy'|'modern',input:unknown):Row {
 if(!input||typeof input!=='object'||Array.isArray(input)||!Object.keys(input).length)throw new AuthoringApiError('unsupported');
 const patch=input as Row;
 for(const [key,value]of Object.entries(patch)){
  if(engine==='legacy'){
   if(!Object.hasOwn(legacyGameSettingNames,key)||(['is_moderated','show_finish_place','hide_game_descr','hide_players_list','hide_game_from_calendar','hide_levels_names','is_available_after_finished'].includes(key)?typeof value!=='boolean':typeof value!=='string')||typeof value==='string'&&value.length>100000)throw new AuthoringApiError('unsupported');
  }else{
   if(!Object.hasOwn(modernGameSettingTypes,key))throw new AuthoringApiError('unsupported');
   const type=modernGameSettingTypes[key as keyof typeof modernGameSettingTypes];
   if(type==='authors'){
    if(!Array.isArray(value)||value.length>200||value.some(author=>!author||typeof author!=='object'||Array.isArray(author)||Object.keys(author).some(k=>!['user_id','login'].includes(k))||(Object.hasOwn(author,'user_id')?!(Number.isSafeInteger(author.user_id)&&author.user_id>0)||Object.hasOwn(author,'login'):typeof author.login!=='string'||!author.login.trim()||author.login.length>200)))throw new AuthoringApiError('unsupported');
    if(new Set(value.map(author=>author.user_id!==undefined?'id:'+author.user_id:'login:'+author.login)).size!==value.length)throw new AuthoringApiError('unsupported');
   }else if(type==='integer'?!Number.isSafeInteger(value):typeof value!==type||typeof value==='string'&&value.length>100000||typeof value==='number'&&!Number.isFinite(value))throw new AuthoringApiError('unsupported');
   if(key==='afc'&&(Number(value)<0||Number(value)>1||Math.abs(Number(value)*10-Math.round(Number(value)*10))>1e-8))throw new AuthoringApiError('unsupported');
   if(key.endsWith('_date_time')||key==='request_last_date')if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))throw new AuthoringApiError('unsupported');
  }
 }
 return structuredClone(patch);
}
const modernReadKey=(key:string)=>({price_cents:'price',prize_cents:'prize'} as Record<string,string>)[key]??key;
export async function readGameSettings(api:AuthoringApiPort,signal?:AbortSignal):Promise<Row>{
 const response=await api.request(`/admin/games/${api.metadata.binding.gameId}`,{signal});if(!response.ok)throw new AuthoringApiError('incomplete-read');
 const body=await response.json() as Row,game=body.game as Row;
 if(!game||game.id!==api.metadata.binding.gameId||api.metadata.binding.engine==='legacy'&&typeof body.version!=='string')throw new AuthoringApiError('incomplete-read');
 if(api.metadata.binding.engine==='legacy')return body;
 // The admin editor can grow calculated fields. Persist and compare actual
 // writable settings plus lifecycle/permissions, not a changing live counter.
 const keys=new Set(['id','started','finished','status_id',...Object.keys(modernGameSettingTypes).map(modernReadKey)]);
 const people=(rows:unknown)=>Array.isArray(rows)?rows.map(row=>({user_id:(row as Row).user_id,login:(row as Row).login})):rows;
 return {game:Object.fromEntries(Object.entries(game).filter(([key])=>keys.has(key)||key.startsWith('can_'))),authors:people(body.authors),referees:people(body.referees),...Object.fromEntries(Object.entries(body).filter(([key])=>key.startsWith('can_')||['permissions','is_admin','is_author'].includes(key)))};
}
/** Refuse fields whose persisted representation cannot be read; never claim a write verified from an ACK. */
export function checkGameSettingsBefore(engine:'legacy'|'modern',before:Row,patch:Row){
 const game=before.game as Row;if(!game)throw new AuthoringApiError('incomplete-read');
 for(const key of Object.keys(patch)){
  if(engine==='legacy'){if(!(before.editable_fields as string[]|undefined)?.includes(key))throw new AuthoringApiError('unsupported');}
  else if(['authors','referees'].includes(key)){if(!Array.isArray(before[key]))throw new AuthoringApiError('incomplete-read');}
  else if(!Object.hasOwn(game,modernReadKey(key)))throw new AuthoringApiError('unsupported');
 }
 if(Object.hasOwn(patch,'start_date_time')&&game.started===true)throw new AuthoringApiError('unsupported');
}
export function gameSettingsRequest(api:AuthoringApiPort,patch:Row,before:Row):Promise<Response>{
 validateGameSettingsPatch(api.metadata.binding.engine,patch);checkGameSettingsBefore(api.metadata.binding.engine,before,patch);
 return api.request(`/admin/games/${api.metadata.binding.gameId}`,{method:'PATCH',headers:{'Content-Type':'application/json',...(api.metadata.binding.engine==='legacy'?{'If-Match':String(before.version)}:{})},body:JSON.stringify(patch)});
}
export function verifyGameSettingsChange(engine:'legacy'|'modern',before:Row,after:Row,patch:Row):boolean{
 const previous=before.game as Row,current=after.game as Row;if(!previous||!current||previous.id!==current.id)return false;
 const expected={...previous};
 for(const [key,value]of Object.entries(patch)){
  if(engine==='modern'&&['authors','referees'].includes(key)){
   if(!Array.isArray(after[key]))return false;const wanted=value as Row[],actual=after[key]as Row[];
   if(wanted.length!==actual.length||wanted.some(w=>!actual.some(a=>w.user_id!==undefined?a.user_id===w.user_id:a.login===w.login)))return false;continue;
  }
  const readKey=engine==='modern'?modernReadKey(key):key;
  if((key.endsWith('_date_time')||key==='request_last_date')&&engine==='modern'){if(Date.parse(String(current[readKey]))!==Date.parse(String(value)))return false;expected[readKey]=current[readKey];}
  else expected[readKey]=normalize(value);
 }
 // Native game reads may expose derived HTML and lifecycle state. Compare every editable sibling.
 const keys=engine==='legacy'?Object.keys(legacyGameSettingNames):Object.keys(modernGameSettingTypes).filter(k=>!['authors','referees'].includes(k)).map(modernReadKey);
 if(keys.some(key=>Object.hasOwn(previous,key)&&stable(normalize(expected[key]))!==stable(normalize(current[key]))))return false;
 if(engine==='legacy'&&(stable(before.editable_fields)!==stable(after.editable_fields)||stable(before.setting_options)!==stable(after.setting_options)))return false;
 for(const key of ['authors','referees'])if(!Object.hasOwn(patch,key)&&stable(before[key])!==stable(after[key]))return false;
 return true;
}
