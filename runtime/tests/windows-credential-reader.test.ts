import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {WindowsCredentialReader} from '../src/windows-credential-reader.ts';
function fixture(script:string,timeout=2000){let starts=0;const reader=new WindowsCredentialReader(async()=>{starts++;return spawn(process.execPath,['-e',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});},timeout);return {reader,starts:()=>starts};}
test('reuses the reader process but every concurrent request freshly reads the vault, including deletion',async()=>{
 const f=fixture(String.raw`let version=0;require('node:readline').createInterface({input:process.stdin}).on('line',()=>{version++;process.stdout.write(JSON.stringify({ok:true,value:version===3?null:'synthetic-'+version})+'\n')});`);
 try{assert.deepEqual(await Promise.all([f.reader.get(),f.reader.get()]),['synthetic-1','synthetic-2']);assert.equal(await f.reader.get(),null);assert.equal(await f.reader.get(),'synthetic-4');assert.equal(f.starts(),1);}finally{f.reader.close();}
});
test('truncated, malformed, failed and timed-out helpers never return stale values or leak output',async()=>{
 for(const body of [`process.stdout.write('SYNTHETIC_SECRET\\n');`,`process.stdout.write(JSON.stringify({ok:false,value:'SYNTHETIC_SECRET'})+'\\n');`,`process.exit(1);`,``]){
  const f=fixture(`process.stdin.on('data',()=>{${body}});`,300);
  try{await assert.rejects(f.reader.get(),e=>{assert.match(String(e),/Credential reader failed/);assert.ok(!String(e).includes('SYNTHETIC_SECRET'));return true;});assert.equal(f.starts(),1);}finally{f.reader.close();}
 }
});
test('split UTF-8 JSON replies preserve a literal secret',async()=>{
 const f=fixture(`process.stdin.on('data',()=>{const line=JSON.stringify({ok:true,value:'синтетика\\n001'})+'\\n';process.stdout.write(line.slice(0,7));setTimeout(()=>process.stdout.write(line.slice(7)),5)});`);
 try{assert.equal(await f.reader.get(),'синтетика\n001');}finally{f.reader.close();}
});
