import {open,readFile,rename,unlink,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import type {LegacyBatchJournal,LegacyBatchJournalStore} from './legacy-command-batch.ts';
/** Local durable journal; an orphaned crash lock blocks execution rather than replaying. */
export function createFileLegacyBatchJournal(path:string):LegacyBatchJournalStore {
 return createFileLegacyJournal<LegacyBatchJournal>(path);
}
/** Shared atomic file persistence; the operation validates the stored journal shape. */
export function createFileLegacyJournal<T>(path:string):{exclusive<R>(work:()=>Promise<R>):Promise<R>;load():Promise<T|undefined>;save(value:T):Promise<void>} {
 const target=resolve(path);let held=false;
 return {
  async exclusive(work){await mkdir(dirname(target),{recursive:true,mode:0o700});const lock=await open(target+'.lock','wx',0o600);held=true;try{return await work();}finally{held=false;await lock.close();await unlink(target+'.lock');}},
  async load(){if(!held)throw new Error('Journal requires exclusive lock');try{const text=await readFile(target,'utf8');if(text.length>10_000_000)throw new Error('Journal exceeds limit');return JSON.parse(text) as T;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}},
  async save(value){if(!held)throw new Error('Journal requires exclusive lock');const temporary=target+'.'+crypto.randomUUID()+'.tmp',file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}try{await rename(temporary,target);}catch(error){await unlink(temporary).catch(()=>{});throw error;}}
 };
}
