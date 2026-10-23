/** Stable authoring data only; transient revision/form tokens are not game content. */
function stable(value:unknown):unknown {
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!key.startsWith('_authoring')&&!['version','preservation_version','creation_preservation_version','recipient'].includes(key)).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)]));
 return value;
}
export function verificationResource(operation:string,args:Record<string,unknown>):string|undefined {
 if(operation==='encounter_propose_level_operation')return 'level-index';
 if(operation==='encounter_propose_level_settings')return `settings:${args.kind}`;
 if(operation==='encounter_propose_task_operation')return 'tasks';
 if(operation==='encounter_propose_sector_operation')return 'sectors';
 if(operation==='encounter_propose_answer_operation')return 'answers';
 if(/^encounter_propose_bonus_(create|update|delete)$/.test(operation))return 'bonuses';
 if(/^encounter_propose_hint_(create|delete)$/.test(operation))return 'hints';
 return undefined;
}
export function verificationContent(resource:string,snapshot:Record<string,unknown>):unknown {
 if(resource==='level-index')return Array.isArray(snapshot.levels)?snapshot.levels.map((row:any)=>({level_id:row.level_id,level_number:row.level_number})):undefined;
 if(resource.startsWith('settings:'))return stable(snapshot.fields);
 if(resource==='hints')return Array.isArray(snapshot.helps)&&Array.isArray(snapshot.penalty_helps)?stable([...snapshot.helps,...snapshot.penalty_helps]):undefined;
 return stable(snapshot[resource]);
}
