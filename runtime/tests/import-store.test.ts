import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createImportJournal} from '../src/import-store.ts';
test('crashed process releases import mutex while persisted dispatch intent survives',async()=>{const dir=await mkdtemp(join(tmpdir(),'import-crash-')),file=join(dir,'journal.json');try{const module=new URL('../src/import-store.ts',import.meta.url).href;const child=spawnSync(process.execPath,['--input-type=module','-e',`import {createImportJournal} from ${JSON.stringify(module)};const s=createImportJournal(${JSON.stringify(file)});await s.exclusive(async()=>{await s.save({status:'dispatching'});process.exit(19);});`],{encoding:'utf8'});assert.equal(child.status,19,child.stderr);const s=createImportJournal<{status:string}>(file);await s.exclusive(async()=>assert.equal((await s.load())!.status,'dispatching'));await s.exclusive(async()=>{const other=createImportJournal(file);await assert.rejects(other.exclusive(async()=>{}),{code:'import-busy'});});}finally{await rm(dir,{recursive:true,force:true});}});
