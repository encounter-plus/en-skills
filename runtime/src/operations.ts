import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {EncounterOperations as PortableOperations} from './operations-core.js';
import type {ApiLike,EncounterProfile} from './types.js';
import {createFileLegacyJournal} from '../../src/node-batch-journal.ts';
import type {LegacyAnswerMoveJournal} from '../../src/legacy-answer-move.ts';
import {createHash} from 'node:crypto';
import {resolveHostSourceFields} from './source-fields.js';
/** Node adapter; the operation implementation is shared with browser hosts. */
export class EncounterOperations extends PortableOperations {
 constructor(api:ApiLike,profile:EncounterProfile,readonly dataDir:string) {
  super(api,profile,{resolveSourceFields:resolveHostSourceFields,writesEnabled:()=>process.env.ENCOUNTER_WRITES_DISABLED!=='1',createAnswerMoveJournal:async plan=>{
   const {binding,args}=plan.before,key=createHash('sha256').update(JSON.stringify({domain:binding.domain,gameId:binding.gameId,...args})).digest('hex');
   const reference=path.join(dataDir,'compound-answer-moves',key+'.json');return {...createFileLegacyJournal<LegacyAnswerMoveJournal>(reference),reference};
  },saveSnapshot:async(value)=>{
   const snapshot=value as {operation:string;gameId:number;levelId:number;capturedAt:string};
   const directory=path.join(dataDir,'snapshots');await mkdir(directory,{recursive:true,mode:0o700});
   const destination=path.join(directory,snapshot.capturedAt.replace(/[:.]/g,'-')+'-'+snapshot.operation+'-game-'+snapshot.gameId+'-level-'+snapshot.levelId+'.json');
   await writeFile(destination,JSON.stringify(value,null,2)+'\n',{encoding:'utf8',mode:0o600});return destination;
  }});
 }
}
