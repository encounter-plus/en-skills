import {AuthoringApiError,type AuthoringApiPort} from './authoring-api.ts';
export interface LevelOperation {action:'create'|'delete'|'copy';levelId:number;count?:number}
export interface LevelIndex extends Record<string,unknown>{game_id:number;version:string;levels:{level_id:number;level_number:number;level_name:string;[key:string]:unknown}[]}
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
const canonical=(value:unknown):string=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}':JSON.stringify(value);
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
export function validateLevelOperation(input:Record<string,unknown>):LevelOperation{
 if(Object.keys(input).some(key=>!['action','levelId','count'].includes(key))||!['create','delete','copy'].includes(String(input.action)))throw new AuthoringApiError('unsupported');
 if(input.action==='create'){if(!positive(input.count)||input.count>20||input.levelId!==undefined&&input.levelId!==0)throw new AuthoringApiError('unsupported');return {action:'create',levelId:0,count:input.count};}
 if(!positive(input.levelId)||input.action==='delete'&&input.count!==undefined||input.action==='copy'&&(!positive(input.count)||input.count>20))throw new AuthoringApiError('unsupported');
 return {action:input.action as 'delete'|'copy',levelId:input.levelId,...(input.action==='copy'?{count:input.count as number}:{})};
}
/** A complete, game-bound observed index is required on either engine. */
export async function readLevelOperationIndex(api:AuthoringApiPort,signal?:AbortSignal):Promise<LevelIndex>{
 const response=await api.request(`/admin/games/${api.metadata.binding.gameId}/levels`,{signal});if(!response.ok)throw new AuthoringApiError('incomplete-read');const index=await response.json();
 const prefix=api.metadata.binding.engine+'-observed:level-index-v1:';
 if(index.game_id!==api.metadata.binding.gameId||typeof index.version!=='string'||!index.version.startsWith(prefix)||!Array.isArray(index.levels)||index.levels.some((row:LevelIndex['levels'][number],i:number)=>!positive(row.level_id)||row.level_number!==i+1||typeof row.level_name!=='string')||new Set(index.levels.map((row:LevelIndex['levels'][number])=>row.level_id)).size!==index.levels.length)throw new AuthoringApiError('incomplete-read');
 return index;
}
export function checkLevelOperation(index:LevelIndex,args:LevelOperation,engine:'legacy'|'modern'):void{
 if(args.action!=='create'&&!index.levels.some(row=>row.level_id===args.levelId))throw new AuthoringApiError('invalid-scope');
 if(engine==='modern'&&(index.can_manipulate_levels!==true||args.action==='create'&&args.count!==1))throw new AuthoringApiError('unsupported');
}
/** Host must persist dispatch intent and user approval before calling this once. */
export function requestLevelOperation(api:AuthoringApiPort,args:LevelOperation,before:LevelIndex):Promise<Response>{
 checkLevelOperation(before,args,api.metadata.binding.engine);const root=`/admin/games/${api.metadata.binding.gameId}/levels`;
 return api.request(args.action==='delete'?`${root}/${args.levelId}`:args.action==='copy'?root+'/copy':root,{method:args.action==='delete'?'DELETE':'POST',headers:{'Content-Type':'application/json','X-Authoring-Expected-Revision':before.version},...(args.action==='delete'?{}:{body:JSON.stringify(args.action==='copy'?{from_level_id:args.levelId,count:args.count}:{count:args.count})})});
}
/** Confirms exact inventory/order. Native clone contents need a separate editor review. */
export function verifyLevelOperation(before:LevelIndex,after:LevelIndex,args:LevelOperation):boolean{
 if(!Array.isArray(after.levels))return false;
 if(args.action==='delete')return same(before.levels.filter(row=>row.level_id!==args.levelId).map((row,i)=>({...row,level_number:i+1})),after.levels);
 const old=new Set(before.levels.map(row=>row.level_id));return after.levels.length===before.levels.length+Number(args.count)&&after.levels.filter(row=>!old.has(row.level_id)).length===args.count&&same(after.levels.slice(0,before.levels.length),before.levels);
}
