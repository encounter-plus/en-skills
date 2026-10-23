import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {loadProfile,resolveDataDir} from './config.js';
import {OsCredentialStore} from './credential-store.js';
import {createRuntimeApi,runtimeProfile} from './authoring-client.js';
import {EncounterOperations} from './operations.js';
import {readLevelContent,writeLevelContent} from './level-content.js';
import {resolveHostSourceFields} from './source-fields.js';
import {applyLevelImport,levelImportPlan} from './level-import.js';
import {createFileLegacyBatchJournal} from '../../src/node-batch-journal.ts';
import {safeError} from './redaction.js';
async function main(){
 const args=process.argv.slice(2),option=(key:string)=>{const at=args.indexOf(key);return at<0?undefined:args[at+1];};
 const planPath=option('--plan'),journalPath=option('--journal');
 if(!planPath||!journalPath||args.some((value,index)=>index%2===0&&!['--plan','--journal','--profile'].includes(value)))throw new Error('Usage: level-import --plan plan.json --journal journal.json [--profile name]');
 if(process.env.ENCOUNTER_WRITES_DISABLED==='1')throw new Error('Writes disabled by host');
 const plan=levelImportPlan.parse(JSON.parse((await readFile(planPath,'utf8')).replace(/^\uFEFF/,'')));
 const dataDir=resolveDataDir(),profile=await loadProfile(option('--profile'),dataDir);
 if(profile.domain!==plan.domain)throw new Error('Plan domain differs from active profile');
 const ops=new EncounterOperations(createRuntimeApi(profile,new OsCredentialStore()),runtimeProfile(profile),dataDir);
 await mkdir(path.dirname(path.resolve(journalPath)),{recursive:true});
 await createFileLegacyBatchJournal(journalPath).exclusive(async()=>{
 let previous;try{previous=JSON.parse(await readFile(journalPath,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}

 const scope={gameId:plan.gameId,levelId:plan.levelId};
 const prepared=new Map<string,Record<string,unknown>>();
 const result=await applyLevelImport(plan,{
  read:async resource=>{const value=await readLevelContent(ops,{...scope,resource,includeText:true});prepared.set(resource,value);return value;},
  create:(resource,fields,expectedVersion)=>writeLevelContent(ops,{...scope,resource,fields,expectedVersion,confirmed:true},undefined,prepared.get(resource)),
  addAnswer:(sectorId,answerText)=>ops.addAnswerAlias({...scope,sectorId,answerText}),
  resolve:resolveHostSourceFields,
  checkpoint:async value=>{const temporary=journalPath+'.tmp';await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(temporary,journalPath);},
  progress:value=>console.log(JSON.stringify({event:'progress',...value})),
 },previous);
 console.log(JSON.stringify({event:'complete',...result}));
 });
}
main().catch(error=>{console.error(JSON.stringify({event:'stopped',error:safeError(error)}));process.exitCode=1;});
