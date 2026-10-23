import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';

/** Read the OS vault on every request; only the PowerShell process is reused. */
export class WindowsCredentialReader {
 private worker?:Promise<ChildProcessWithoutNullStreams>;
 private child?:ChildProcessWithoutNullStreams;
 private pending:{resolve:(value:string|null)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}[]=[];
 private idle?:NodeJS.Timeout;
 constructor(private readonly start:()=>Promise<ChildProcessWithoutNullStreams>,private readonly timeoutMs=20000){}
 async get():Promise<string|null>{
  if(this.idle)clearTimeout(this.idle);
  const worker=await (this.worker??=this.startWorker());
  if(this.idle)clearTimeout(this.idle);
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>this.fail(worker),this.timeoutMs);
   this.pending.push({resolve,reject,timer});
   worker.stdin.write('read\n',error=>{if(error)this.fail(worker);});
  });
 }
 private async startWorker(){
  let child:ChildProcessWithoutNullStreams;
  try{child=await this.start();}catch{this.worker=undefined;throw new Error('Credential reader unavailable');}
  // Pending request timers keep a CLI alive; idle helpers must not do so.
  this.child=child;child.unref();
  for(const stream of [child.stdin,child.stdout,child.stderr]) (stream as unknown as {unref?:()=>void}).unref?.();
  let buffer='';child.stdout.setEncoding('utf8');child.stderr.resume();
  child.stdout.on('data',(chunk:string)=>{
   if(this.child!==child)return;
   buffer+=chunk;if(buffer.length>1_000_000){this.fail(child);return;}
   for(;;){const end=buffer.indexOf('\n');if(end<0)break;
    const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
    let result:unknown;try{result=JSON.parse(line);}catch{this.fail(child);return;}
    const row=result as {ok?:unknown;value?:unknown};
    if(!row||row.ok!==true||!(row.value===null||typeof row.value==='string')||!this.pending.length){this.fail(child);return;}
    const request=this.pending.shift()!;clearTimeout(request.timer);request.resolve(row.value as string|null);
    if(!this.pending.length){this.idle=setTimeout(()=>this.fail(child),10000);this.idle.unref();}
   }
  });
  child.on('error',()=>this.fail(child));child.stdin.on('error',()=>this.fail(child));
  child.on('close',()=>this.fail(child));
  return child;
 }
 private fail(child:ChildProcessWithoutNullStreams){
  if(this.child!==child)return;
  if(this.idle)clearTimeout(this.idle);this.worker=undefined;this.child=undefined;child.kill();
  for(const request of this.pending.splice(0)){clearTimeout(request.timer);request.reject(new Error('Credential reader failed; no cached value used'));}
 }
 close(){if(this.idle)clearTimeout(this.idle);void this.worker?.then(child=>this.fail(child),()=>{});}
}

export async function startWindowsCredentialReader(script:string,target:string){
 for(const command of [process.env.POWERSHELL_EXE||'pwsh.exe','powershell.exe']){
  try{return await new Promise<ChildProcessWithoutNullStreams>((resolve,reject)=>{
   const child=spawn(command,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'get-stream',target],{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
   child.once('spawn',()=>resolve(child));child.once('error',reject);
  });}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 }
 throw new Error('Credential reader executable unavailable');
}
