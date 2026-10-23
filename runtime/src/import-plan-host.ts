import type {EncounterOperations} from './operations-core.js';
import {readLevelContent,writeLevelContent,type ContentResource} from './level-content.js';
import {sameAuthoringBinding,type AuthoringBinding} from '../../src/authoring-api.ts';
import {planError,type PlanHost,type Data} from './import-plan.js';
import {gameAsset} from './game-assets.js';
export function runtimePlanHost(ops:EncounterOperations):PlanHost{
 let binding:AuthoringBinding|undefined;
 const port=async(gameId:number)=>{
  const api=await ops.api.authoringPort?.(gameId);
  if(!api||api.metadata.binding.engine!=='legacy'||api.metadata.binding.domain!==ops.profile.domain||api.metadata.binding.gameId!==gameId)throw planError('unsupported-import-scope','Filled level import currently requires a bound legacy adapter');
  if(binding&&!sameAuthoringBinding(binding,api.metadata.binding))throw planError('session-changed','Import session changed; stop before the next write');
  binding=api.metadata.binding;return api;
 };
 return {
  domain:ops.profile.domain,
  async identity(gameId){return JSON.stringify((await port(gameId)).metadata.binding);},
  async preflight(p){const api=await port(p.gameId);const caps=['level-settings-update','task-create',...(p.levels.some(l=>!l.targetLevelId)?['level-create']:[]),...(p.levels.some(l=>[l.task,...l.additionalTasks??[]].some(t=>t.targetTaskId))?['task-update']:[]),...(p.levels.some(l=>l.sectors?.length)?['sector-create']:[]),...(p.levels.some(l=>l.bonuses?.length)?['bonus-create']:[]),...(p.levels.some(l=>l.hints?.length)?['hint-create']:[]),...(p.levels.some(l=>l.sectors?.some(s=>s.answers.length>10))?['answer-create']:[]),...(p.assets?.length?['game-file-upload']:[]),...(p.organizer||p.levels.some(l=>l.messages?.length)?['message-update']:[])];for(const cap of caps){if(!api.metadata.capabilities[cap as keyof typeof api.metadata.capabilities]?.available)throw planError('unsupported-import-capability','Required capability unavailable: '+cap);}},
  async index(gameId){await port(gameId);return await ops.listLevels(gameId) as {levels:{level_id:number;level_name:string}[]};},
  async create(gameId){await port(gameId);return await ops.createLevel({gameId,count:1,confirmed:true}) as {status?:string;created?:{level_id:number}[]};},
  async read(gameId,levelId,resource){const api=await port(gameId);if(resource==='messages'){const r=await api.request(`/admin/games/${gameId}/levels/${levelId}/messages`);if(!r.ok)throw Error('Organizer message read unavailable');return await r.json() as Data;}return readLevelContent(ops,{gameId,levelId,resource:resource as ContentResource,includeText:true});},
  async write(gameId,levelId,resource,fields,expectedVersion){await port(gameId);return writeLevelContent(ops,{gameId,levelId,resource:resource as ContentResource,fields,expectedVersion,confirmed:true});},
  async message(gameId,levelId,messageText,levelIds,allLevels=true){await port(gameId);await ops.postMessage({gameId,levelId,messageText,allLevels,...(allLevels?{levelIds}:{}),replaceNlToBr:false});},
  async answer(gameId,levelId,sectorId,answerText){await port(gameId);await ops.addAnswerAlias({gameId,levelId,sectorId,answerText,forMemberId:0});},
  async asset(gameId,asset,upload){const api=await port(gameId);if(upload){if(!ops.host.writesEnabled())throw planError('writes-disabled','Host disabled writes');await ops.host.saveSnapshot({operation:'upload-import-asset',gameId,filename:asset.filename,binding:api.metadata.binding});}return gameAsset(api,asset,upload);},
 };
}
