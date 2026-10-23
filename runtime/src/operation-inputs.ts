import {z} from 'zod';
import type {EncounterOperations} from './operations-core.js';
import {contentResources,readLevelContent,writeLevelContent} from './level-content.js';
const id=z.number().int().positive(),member=z.number().int().nonnegative().optional().describe('Native legacy membership ID from the observed recipient options; zero targets all players');
const confirmed=z.boolean().optional();
/** Shared CLI/MCP input contracts; native membership IDs never imply a user/team identity. */
export const operationInputs={
 'read-level-content':z.object({gameId:id,levelId:id,resource:z.enum(contentResources),includeText:z.boolean().optional().describe('Bonus text is summarized with length/SHA256 by default; true returns literal text for full reconciliation. Versions and all non-text fields remain exact.')}).strict(),
 'write-level-content':z.object({gameId:id,levelId:id,resource:z.enum(contentResources),expectedVersion:z.string().min(1),fields:z.record(z.string(),z.unknown()),sourceFields:z.record(z.string(),z.string()).optional().describe('Optional field -> JSON pointer in the host-pinned source. Copies exact text without model retyping; new_answers wraps a string as one answer. No arbitrary paths.'),confirmed}).strict(),
 'update-game-settings':z.object({gameId:id,fields:z.record(z.string(),z.unknown()),confirmed}).strict(),
 'update-task':z.object({gameId:id,levelId:id,taskId:id,taskText:z.string().optional(),forMemberId:member,replaceNlToBr:z.boolean().optional(),confirmed}).strict().refine(input=>input.taskText!==undefined||input.forMemberId!==undefined||input.replaceNlToBr!==undefined,{message:'Specify taskText, forMemberId or replaceNlToBr'}),
 'add-answer-alias':z.object({gameId:id,levelId:id,answerText:z.string().min(1),sectorId:id.optional(),forTeamId:id.optional(),forUserId:id.optional(),forMemberId:member}).strict(),
 'update-answer':z.object({gameId:id,levelId:id,answerId:id,answerText:z.string().min(1).optional(),sectorId:id.optional(),forMemberId:member,confirmed}).strict().refine(input=>input.answerText!==undefined||input.forMemberId!==undefined,{message:'Specify answerText or forMemberId'}),
 'post-message':z.object({gameId:id,levelId:id,messageText:z.string().min(1),allLevels:z.boolean().optional(),levelIds:z.array(id).min(1).optional().describe('With legacy allLevels:true, supply every persistent level ID from the fresh manager inventory'),replaceNlToBr:z.boolean().optional()}).strict(),
 'create-level':z.object({gameId:id,count:z.number().int().min(1).max(20).default(1),confirmed}).strict(),
 'delete-level':z.object({gameId:id,levelId:id,confirmed}).strict(),
 'copy-level':z.object({gameId:id,levelId:id,count:z.number().int().min(1).max(20).default(1),confirmed}).strict(),
 'dismiss-level':z.object({gameId:id,levelId:id,confirmed}).strict(),
 'restore-level':z.object({gameId:id,levelId:id,confirmed}).strict(),
 'delete-sector':z.object({gameId:id,levelId:id,sectorId:id,confirmed}).strict(),
 'move-answer':z.object({gameId:id,levelId:id,answerId:id,sourceSectorId:id,destinationSectorId:id,confirmed}).strict().refine(input=>input.sourceSectorId!==input.destinationSectorId,{message:'Choose distinct source and destination sectors'}),
};
export type RuntimeOperationName=keyof typeof operationInputs;
export async function executeRuntimeOperation(operations:EncounterOperations,name:string,input:unknown,signal?:AbortSignal):Promise<unknown>{
 switch(name){
  case 'read-level-content':return readLevelContent(operations,operationInputs[name].parse(input));
  case 'write-level-content':{
   const parsed=operationInputs[name].parse(input);
   if(parsed.sourceFields){if(!operations.host.resolveSourceFields)throw new Error('Host does not support source fields');parsed.fields=await operations.host.resolveSourceFields(parsed.fields,parsed.sourceFields);}
   return writeLevelContent(operations,parsed,signal);
  }
  case 'update-game-settings':return operations.updateGameSettings(operationInputs[name].parse(input));
  case 'update-task':return operations.updateTask(operationInputs[name].parse(input));
  case 'add-answer-alias':return operations.addAnswerAlias(operationInputs[name].parse(input));
  case 'update-answer':return operations.updateAnswer(operationInputs[name].parse(input));
  case 'post-message':return operations.postMessage(operationInputs[name].parse(input));
  case 'create-level':return operations.createLevel(operationInputs[name].parse(input));
  case 'delete-level':return operations.deleteLevel(operationInputs[name].parse(input));
  case 'copy-level':return operations.copyLevel(operationInputs[name].parse(input));
  case 'dismiss-level':return operations.dismissLevel(operationInputs[name].parse(input));
  case 'restore-level':return operations.restoreLevel(operationInputs[name].parse(input));
  case 'delete-sector':return operations.deleteSector(operationInputs[name].parse(input));
  case 'move-answer':return operations.moveAnswer(operationInputs[name].parse(input));
  default:throw new Error('Unsupported authoring operation');
 }
}
