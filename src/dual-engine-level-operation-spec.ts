import {validateLevelOperation,readLevelOperationIndex,checkLevelOperation,requestLevelOperation,verifyLevelOperation} from './recalculation-browser.ts';
import type {LevelOperation,LevelIndex} from './level-operation.ts';
import {legacyLevelOperationSpec} from './legacy-level-operation-spec.ts';
import type {LegacyOperationSpec} from './operation-contract.ts';
/** Engine-neutral immutable proposals; host registry supplies approval and durable dispatch. */
export const dualEngineLevelOperationSpec:LegacyOperationSpec={
 engines:['legacy','modern'],
 definition:{type:'function',function:{name:'encounter_propose_level_operation',description:'Prepare a human review card to create levels, delete an exact persistent level ID, or copy a source level within the selected game using the native engine operation. Modern create supports one level per card; legacy create and native copy support 1..20. Copy verifies new IDs and inventory; copied content, recipients and global references require separate editor review before declaring the level ready. Unknown mutations cannot be retried. The move action remains legacy-only and addresses persistent IDs.',parameters:{type:'object',additionalProperties:false,properties:{action:{type:'string',enum:['create','delete','copy','move']},levelId:{type:'integer',minimum:1},count:{type:'integer',minimum:1,maximum:20},afterLevelId:{type:'integer',minimum:1}},required:['action']}}},
 capability:args=>args.action==='create'?'level-create':args.action==='copy'?'level-copy':args.action==='move'?'level-move':'level-delete',
 validate:value=>value.action==='move'?legacyLevelOperationSpec.validate(value):({...validateLevelOperation(value)}),
 async read(api,args,signal){const index=await readLevelOperationIndex(api,signal);if(args.action==='move'){if(api.metadata.binding.engine!=='legacy')throw new Error('Modern move unavailable');}else if(args.action==='create')checkLevelOperation(index,args as unknown as LevelOperation,api.metadata.binding.engine);return index;},
 checkBefore(before,args){if(args.action==='move'){legacyLevelOperationSpec.checkBefore?.(before,args);return;}if(args.action!=='create'&&!(before as LevelIndex).levels.some(row=>row.level_id===args.levelId))throw new Error('Level ID outside selected game');},
 request:(api,args,before)=>args.action==='move'?legacyLevelOperationSpec.request(api,args,before):requestLevelOperation(api,args as unknown as LevelOperation,before as LevelIndex),
 verify:(before,after,args)=>args.action==='move'?legacyLevelOperationSpec.verify(before,after,args):verifyLevelOperation(before as LevelIndex,after as LevelIndex,args as unknown as LevelOperation),
 riskReason:'Review exact stable IDs, count and order. Deletion removes the whole level. Native same-game copy creates new IDs; content, recipient assignments and global references require editor review. Structural preflight is observed and provides no server CAS.',
};
