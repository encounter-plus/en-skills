import {z} from 'zod';
const text=z.string().min(1),id=z.number().int().positive();
export const levelImportPlan=z.object({
 schemaVersion:z.literal(1),domain:text,gameId:id,levelId:id,confirmed:z.literal(true),
 sectors:z.array(z.object({name:text,answers:z.array(text).min(1)}).strict()).max(200),
 bonusDefaults:z.record(z.string(),z.unknown()),
 bonuses:z.array(z.object({sourceKey:text,fields:z.record(z.string(),z.unknown()).optional(),sourceFields:z.record(z.string(),text).optional()}).strict()).max(200),
}).strict();
export type ImportPlan=z.infer<typeof levelImportPlan>;
type Data=Record<string,any>;
export interface ImportHost {
 read(resource:'sectors'|'bonuses'|'bonus-create'):Promise<Data>;
 create(resource:'sectors'|'bonus-create',fields:Data,version:string):Promise<Data>;
 addAnswer(sectorId:number,answer:string):Promise<unknown>;
 resolve(fields:Data,pointers:Record<string,string>):Promise<Data>;
 checkpoint(value:Data):Promise<void>;
 progress(value:Data):void;
}
function equal(a:unknown,b:unknown){return JSON.stringify(a)===JSON.stringify(b);}
function matchesBonus(actual:Data,wanted:Data){
 for(const [key,value]of Object.entries(wanted)){
  const observed=key==='new_answers'?actual.answers?.map((row:Data)=>row.answer_text):actual[key];
  if(!equal(observed,value))return false;
 }
 return true;
}
/** Resolve the whole plan first, then apply serially without a model call per object. */
export async function applyLevelImport(input:unknown,host:ImportHost,previous:Data|undefined=undefined){
 const plan=levelImportPlan.parse(input),resolved: {sourceKey:string;fields:Data}[]=[];
 for(const row of plan.bonuses){
  const fields=await host.resolve({...plan.bonusDefaults,...row.fields},row.sourceFields??{});
  if(typeof fields.bonus_name!=='string'||!fields.bonus_name||typeof fields.bonus_text!=='string'||typeof fields.help_text!=='string'||!Array.isArray(fields.new_answers)||!fields.new_answers.length||fields.new_answers.some((value:unknown)=>typeof value!=='string'||!value)||typeof fields.reward_seconds!=='number'||!Number.isSafeInteger(fields.reward_seconds)||fields.reward_seconds<0||typeof fields.is_negative!=='boolean'||fields.all_levels!==false||!equal(fields.level_ids,[plan.levelId]))throw new Error('Invalid or unscoped bonus plan: '+row.sourceKey);
  resolved.push({sourceKey:row.sourceKey,fields});
 }
 for(const keys of [resolved.map(row=>row.sourceKey),resolved.map(row=>row.fields.bonus_name),plan.sectors.map(row=>row.name)])if(new Set(keys).size!==keys.length)throw new Error('Duplicate import source key or name');
 for(const sector of plan.sectors)if(new Set(sector.answers).size!==sector.answers.length)throw new Error('Duplicate sector answer');
 const planIdentity=JSON.stringify({domain:plan.domain,gameId:plan.gameId,levelId:plan.levelId,sectors:plan.sectors,bonuses:resolved});
 if(previous&&previous.planIdentity!==planIdentity)throw new Error('Journal belongs to a different resolved plan');
 const journal:Data={schemaVersion:1,gameId:plan.gameId,levelId:plan.levelId,planIdentity,status:'prepared',steps:previous?.steps??[],startedAt:previous?.startedAt??new Date().toISOString()};
 let sectors=await host.read('sectors'),bonuses=await host.read('bonuses');
 const findBonus=(name:string)=>{const found=bonuses.bonuses.filter((b:Data)=>b.bonus_name===name);if(found.length>1)throw new Error('Duplicate remote bonus: '+name);return found[0];};
 // All known conflicts are rejected before the first write.
 if(bonuses.bonuses.some((b:Data)=>!resolved.some(row=>row.fields.bonus_name===b.bonus_name)))throw new Error('Remote bonus outside complete level plan');
 for(const row of resolved){const actual=findBonus(row.fields.bonus_name);if(actual&&!matchesBonus(actual,row.fields))throw new Error('Remote bonus differs from plan: '+row.sourceKey);}
 for(const wanted of plan.sectors){
  const found=sectors.sectors.filter((s:Data)=>s.sector_name===wanted.name);if(found.length>1)throw new Error('Duplicate remote sector: '+wanted.name);
  if(found.length&&sectors.answers.some((a:Data)=>a.sector_id===found[0].sector_id&&!wanted.answers.includes(a.answer_text)))throw new Error('Remote sector has an unplanned answer');
 }
 if(sectors.sectors.some((s:Data)=>!plan.sectors.some(row=>row.name===s.sector_name)))throw new Error('Remote sector outside complete level plan');
 const unresolved=previous?.steps?.find((step:Data)=>['dispatching','unknown'].includes(step.status));
 if(unresolved){
  const desired=resolved.find(row=>row.sourceKey===unresolved.key),observed=desired&&findBonus(desired.fields.bonus_name);
  if(!desired||!observed||!matchesBonus(observed,desired.fields))throw new Error('Prior uncertain write requires reconciliation; no automatic retry');
  unresolved.status='reconciled';unresolved.id=observed.bonus_id;
 }
 await host.checkpoint(journal);
 const perform=async(key:string,operation:()=>Promise<Data>)=>{
  const step:Data={key,status:'dispatching',at:new Date().toISOString()};journal.steps.push(step);journal.status='running';await host.checkpoint(journal);
  try{const result=await operation();if(result.status!=='applied')throw new Error('Write did not verify as applied');step.status='applied';step.receipt=result.receipt;await host.checkpoint(journal);return result.receipt;}
  catch(error){step.status='unknown';journal.status='stopped';await host.checkpoint(journal);throw error;}
 };
 for(const wanted of plan.sectors){
  let sector=sectors.sectors.find((s:Data)=>s.sector_name===wanted.name);
  if(!sector){await perform('sector:'+wanted.name,()=>host.create('sectors',{sector_name:wanted.name,new_answers:wanted.answers.slice(0,10)},sectors.version));sectors=await host.read('sectors');sector=sectors.sectors.find((s:Data)=>s.sector_name===wanted.name);if(!sector)throw new Error('Created sector missing');}
  for(const answer of wanted.answers)if(!sectors.answers.some((a:Data)=>a.sector_id===sector.sector_id&&a.answer_text===answer)){
   await perform('answer:'+wanted.name+':'+answer,async()=>{const receipt=await host.addAnswer(sector.sector_id,answer);sectors=await host.read('sectors');if(!sectors.answers.some((a:Data)=>a.sector_id===sector.sector_id&&a.answer_text===answer))throw new Error('Answer readback failed');return {status:'applied',receipt};});
  }
 }
 for(const [index,row]of resolved.entries()){
  if(!findBonus(row.fields.bonus_name)){
   const before=await host.read('bonus-create');
   const created=await perform(row.sourceKey,()=>host.create('bonus-create',row.fields,before.version));
   if(!matchesBonus(created,row.fields))throw new Error('Created bonus differs from plan');
   bonuses.bonuses.push(created);
  }
  host.progress({completed:index+1,total:resolved.length,name:row.fields.bonus_name,id:findBonus(row.fields.bonus_name).bonus_id});
 }
 // Fresh whole-collection verification is distinct from per-create receipts.
 bonuses=await host.read('bonuses');sectors=await host.read('sectors');
 if(bonuses.bonuses.length!==resolved.length||resolved.some(row=>!findBonus(row.fields.bonus_name)||!matchesBonus(findBonus(row.fields.bonus_name),row.fields)))throw new Error('Final bonus verification failed');
 if(sectors.sectors.length!==plan.sectors.length||plan.sectors.some(wanted=>{const actual=sectors.sectors.find((s:Data)=>s.sector_name===wanted.name);return !actual||!equal(sectors.answers.filter((a:Data)=>a.sector_id===actual.sector_id).map((a:Data)=>a.answer_text).sort(),[...wanted.answers].sort());}))throw new Error('Final sector verification failed');
 journal.status='verified';journal.verifiedAt=new Date().toISOString();journal.mapping=resolved.map(row=>({sourceKey:row.sourceKey,name:row.fields.bonus_name,bonusId:findBonus(row.fields.bonus_name).bonus_id}));await host.checkpoint(journal);
 return {status:'verified',gameId:plan.gameId,levelId:plan.levelId,sectors:plan.sectors.length,bonuses:resolved.length,mapping:journal.mapping};
}
