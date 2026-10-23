import {legacyGameSettingNames,modernGameSettingTypes,readGameSettings,validateGameSettingsPatch,checkGameSettingsBefore,gameSettingsRequest,verifyGameSettingsChange} from './authoring-browser.ts';
import type {LegacyOperationSpec} from './operation-contract.ts';

const booleanLegacy=new Set(['is_moderated','show_finish_place','hide_game_descr','hide_players_list','hide_game_from_calendar','hide_levels_names','is_available_after_finished']);
const fieldsSchema=(engine:'legacy'|'modern')=>({type:'object',minProperties:1,additionalProperties:false,properties:Object.fromEntries(engine==='legacy'?Object.keys(legacyGameSettingNames).map(key=>[key,{type:booleanLegacy.has(key)?'boolean':'string',...(booleanLegacy.has(key)?{}:{maxLength:100000})}]):Object.entries(modernGameSettingTypes).map(([key,type])=>[key,type==='authors'?{type:'array',maxItems:200,items:{type:'object',additionalProperties:false,properties:{login:{type:'string',minLength:1,maxLength:200},user_id:{type:'integer',minimum:1}},oneOf:[{required:['login']},{required:['user_id']}]}}:{type,...(type==='string'?{maxLength:100000}:{}),...(key==='afc'?{minimum:0,maximum:1,multipleOf:0.1}:{})}]))});
/** The executor re-reads the immutable reviewed snapshot and performs one durable dispatch. */
export const gameOperationSpecs:LegacyOperationSpec[]=(['legacy','modern']as const).map(engine=>({
 engines:[engine],
 definition:{type:'function',function:{name:`encounter_propose_${engine}_game_settings`,description:engine==='legacy'?'Prepare exact native game settings: title, authors, description, dates, requests, limits, fee/currency, prizes, statistics/scenario visibility, finish position, certificates, rating and author complexity. Values are literal native form strings; is_moderated and show_finish_place are booleans. Read editable_fields first; unavailable/disabled controls are rejected. Preserves all fresh hidden, unknown and unchecked form controls.':'Prepare any supported modern AdminUpdateGameRequest setting. Reads the game editor, saves a review card, sends one partial PATCH and independently verifies persisted fields and unchanged siblings. Dates require RFC3339 with timezone, afc uses 0..1 in tenths. Cannot move a started game start. Readback-unavailable fields are rejected before dispatch; no server CAS claimed.',parameters:{type:'object',additionalProperties:false,properties:{fields:fieldsSchema(engine)},required:['fields']}}},
 capability:'game-settings-update',
 validate(input){if(Object.keys(input).some(k=>!['fields','levelId'].includes(k))||input.levelId!==undefined&&input.levelId!==0)throw new Error('Invalid game settings scope');return {levelId:0,fields:validateGameSettingsPatch(engine,input.fields)};},
 read:(api,_args,signal)=>readGameSettings(api,signal),
 checkBefore:(before,args)=>checkGameSettingsBefore(engine,before,args.fields as Record<string,unknown>),
 request:(api,args,before)=>gameSettingsRequest(api,args.fields as Record<string,unknown>,before),
 verify:(before,after,args)=>verifyGameSettingsChange(engine,before,after,args.fields as Record<string,unknown>),
 riskReason:engine==='legacy'?'Review every native before/after setting. This is one full native form POST with preserved siblings and an observed precondition; it has no server CAS.':'Review every game before/after setting. This is one partial PATCH after fresh comparison and read-back; the game editor endpoint does not document server CAS.',
}));

export const modernAnnouncementOperationSpec:LegacyOperationSpec={
 engines:['modern'],
 definition:{type:'function',function:{name:'encounter_propose_modern_announcement',description:'Publish a reviewed announcement HTML fragment to modern game descr with explicit replace_nl_to_br, hide_game_descr and display_announcement native values. Preserves other game settings and verifies independent read-back. This publishes text/display settings; poster upload and separate from_author_text have distinct contracts.',parameters:{type:'object',additionalProperties:false,properties:{html:{type:'string',maxLength:100000},replaceNlToBr:{type:'boolean'},hideGameDescr:{type:'boolean'},displayAnnouncement:{type:'integer'}},required:['html','replaceNlToBr','hideGameDescr','displayAnnouncement']}}},
 capability:'game-settings-update',
 validate(input){if(Object.keys(input).some(k=>!['html','replaceNlToBr','hideGameDescr','displayAnnouncement','levelId'].includes(k))||input.levelId!==undefined&&input.levelId!==0)throw new Error('Invalid announcement scope');const fields=validateGameSettingsPatch('modern',{descr:input.html,replace_nl_to_br:input.replaceNlToBr,hide_game_descr:input.hideGameDescr,display_announcement:input.displayAnnouncement});return {levelId:0,html:fields.descr,replaceNlToBr:fields.replace_nl_to_br,hideGameDescr:fields.hide_game_descr,displayAnnouncement:fields.display_announcement};},
 read:(api,_args,signal)=>readGameSettings(api,signal),
 checkBefore:(before,args)=>checkGameSettingsBefore('modern',before,announcementFields(args)),
 request:(api,args,before)=>gameSettingsRequest(api,announcementFields(args),before),
 verify:(before,after,args)=>verifyGameSettingsChange('modern',before,after,announcementFields(args)),
 riskReason:'Review announcement HTML and all three explicit display settings. Native display_announcement semantics must be chosen from the game settings; this operation publishes one game PATCH.',
};
const announcementFields=(args:Record<string,unknown>)=>({descr:args.html,replace_nl_to_br:args.replaceNlToBr,hide_game_descr:args.hideGameDescr,display_announcement:args.displayAnnouncement});
