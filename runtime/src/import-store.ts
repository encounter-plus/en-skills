import {DatabaseSync} from 'node:sqlite';
import {mkdir,readFile,open,rename,unlink,access} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
/** OS releases the SQLite writer lock on process death; journal saves commit independently. */
export function createImportJournal<T>(filename:string){
 const path=resolve(filename);let held=false;
 return {
  async exclusive<R>(work:()=>Promise<R>):Promise<R>{
   await mkdir(dirname(path),{recursive:true,mode:0o700});
   // Older releases used ownerless lock files. Their ownership cannot be inferred safely.
   try{await access(path+'.lock');throw Object.assign(new Error('Legacy ownerless import lock exists; confirm its process has stopped before removing that exact lock'),{code:'legacy-journal-lock'});}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
   const db=new DatabaseSync(path+'.mutex.sqlite');
   try{db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');held=true;return await work();}
   catch(e){if((e as Error).message.includes('database is locked'))throw Object.assign(new Error('Another process is working on this import; retry after it finishes'),{code:'import-busy'});throw e;}
   finally{held=false;db.close();}
  },
  async load():Promise<T|undefined>{if(!held)throw new Error('Journal requires exclusive lock');try{const value=await readFile(path,'utf8');if(value.length>10_000_000)throw new Error('Journal exceeds limit');return JSON.parse(value) as T;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}},
  async save(value:T){if(!held)throw new Error('Journal requires exclusive lock');const temp=path+'.'+crypto.randomUUID()+'.tmp',file=await open(temp,'wx',0o600);try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}try{await rename(temp,path);}catch(e){await unlink(temp).catch(()=>{});throw e;}}
 };
}
