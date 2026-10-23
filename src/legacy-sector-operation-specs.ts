import type {LegacyOperationSpec} from './operation-contract.ts';
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
type Row=Record<string,unknown>;
const rows=(value:Row,key:string)=>value[key]as Row[];
export const legacySectorOperationSpec:LegacyOperationSpec={
 definition:{type:'function',function:{name:'encounter_propose_sector_operation',description:'Prepare a reviewed legacy sector create, exact rename, or deletion. Deletion also removes codes in that exact sector; the card contains those codes and their IDs. All other sectors and answers must survive unchanged.',parameters:{type:'object',additionalProperties:false,properties:{action:{type:'string',enum:['create','rename','delete']},levelId:{type:'integer',minimum:1},sectorId:{type:'integer',minimum:1},sectorName:{type:'string',minLength:1,maxLength:1000}},required:['action','levelId']}}},
 capability:args=>args.action==='create'?'sector-create':args.action==='delete'?'sector-delete':'sector-update',
 validate(value){if(!['create','rename','delete'].includes(String(value.action))||!positive(value.levelId)||(value.action==='create'?value.sectorId!==undefined:!positive(value.sectorId))||Object.keys(value).some(key=>!['action','levelId','sectorId','sectorName'].includes(key))||(value.action==='delete'?value.sectorName!==undefined:typeof value.sectorName!=='string'||!value.sectorName.trim()||value.sectorName.length>1000))throw new Error('Choose an exact sector and literal name');return structuredClone(value)as Row&{levelId:number};},
 async read(api,args,signal){const response=await api.request(`/admin/games/${api.metadata.binding.gameId}/levels/${args.levelId}/sectors`,{signal});if(!response.ok)throw new Error('Sector inventory unavailable');const body=await response.json();if(body.game_id!==api.metadata.binding.gameId||body.level_id!==args.levelId||typeof body.version!=='string'||!['answers','sectors','sector_proofs'].every(key=>Array.isArray(body[key])))throw new Error('Incomplete sector inventory');return body;},
 checkBefore(before,args){if(args.action!=='create'&&rows(before,'sectors').filter(row=>row.sector_id===args.sectorId).length!==1)throw new Error('Sector outside selected level');},
 request(api,args,before){return api.request(`/admin/games/${api.metadata.binding.gameId}/levels/${args.levelId}/sectors${args.action==='create'?'':'/'+args.sectorId}`,{method:args.action==='create'?'POST':args.action==='delete'?'DELETE':'PUT',headers:{'Content-Type':'application/json','If-Match':String(before.version)},...(args.action==='delete'?{}:{body:JSON.stringify({sector_name:args.sectorName})})});},
 verify(before,after,args,receipt){if(after.game_id!==before.game_id||after.level_id!==before.level_id||!['answers','sectors','sector_proofs'].every(key=>Array.isArray(after[key])))return false;
  const old=rows(before,'sectors'),actual=rows(after,'sectors'),oldIds=new Set(old.map(row=>row.sector_id)),created=args.action==='create'?actual.filter(row=>!oldIds.has(row.sector_id)):[];
  if(args.action==='create'&&(created.length!==1||created[0].sector_name!==args.sectorName||receipt?.created_sector_id!==undefined&&created[0].sector_id!==receipt.created_sector_id))return false;
  const expected=args.action==='delete'?old.filter(row=>row.sector_id!==args.sectorId):args.action==='rename'?old.map(row=>row.sector_id===args.sectorId?{...row,sector_name:args.sectorName}:row):old;
  if(!equal(args.action==='create'?actual.filter(row=>oldIds.has(row.sector_id)):actual,expected))return false;
  const expectedAnswers=args.action==='delete'?rows(before,'answers').filter(row=>row.sector_id!==args.sectorId):rows(before,'answers');if(!equal(after.answers,expectedAnswers))return false;
  const priorProofs=rows(before,'sector_proofs').filter(row=>args.action!=='delete'||row.sector_id!==args.sectorId),currentProofs=rows(after,'sector_proofs').filter(row=>args.action!=='create'||oldIds.has(row.sector_id));return equal(priorProofs,currentProofs);
 },
};
