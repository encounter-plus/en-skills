import {createHash} from 'node:crypto';
import type {AuthoringApiPort} from '../../src/authoring-api.ts';
import {assetBytes,assetHash,planError,type Asset} from './import-plan.js';
/** Content-addressed names avoid overwriting user files. Only observed game storage is used. */
export async function gameAsset(api:AuthoringApiPort,a:Asset,upload:boolean,fetcher:typeof fetch=fetch){
 const bytes=assetBytes(a),hash=assetHash(a),ext=a.filename.slice(a.filename.lastIndexOf('.')),filename=a.filename.slice(0,-ext.length)+'-'+hash+ext;
 if(bytes.length===0||bytes.length>10*1024*1024)throw planError('asset-size','Resource must be 1 byte to 10 MiB');
 const mimeByExt:Record<string,string>={'.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif'};
 if(mimeByExt[ext]!==a.mime)throw planError('asset-type','Filename and MIME differ');
 if(a.encoding==='base64'&&bytes.toString('base64')!==a.content)throw planError('asset-encoding','Canonical base64 required');
 if(ext!=='.css'){const valid=ext==='.png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='.jpg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:/^GIF8[79]a/.test(bytes.toString('ascii',0,6));if(!valid)throw planError('asset-type','Image signature does not match MIME');}
 const response=await api.request(`/admin/games/${api.metadata.binding.gameId}/files`);if(!response.ok)throw planError('asset-inventory','Cannot read game storage');
 const inventory=await response.json() as {storageBases?:string[]};
 if(inventory.storageBases?.length!==1)throw planError('asset-storage','Expected one observed storage base');
 const base=new URL(inventory.storageBases[0]!);
 if(!/^https:\/\/d[1-9]\d*\.endata\.cx$/.test(base.origin)||base.pathname!==`/data/games/${api.metadata.binding.gameId}`||base.search||base.hash||base.username||base.password)throw planError('asset-scope','Invalid observed storage scope');
 const url=base.href+'/'+filename;
 const read=async()=>{const r=await fetcher(url,{redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(20000)});if(r.status===404)return undefined;if(!r.ok)throw planError('asset-read','Resource read failed: '+r.status);if(Number(r.headers.get('content-length'))>10*1024*1024)throw planError('asset-size','Remote resource exceeds limit');const reader=r.body?.getReader();if(!reader)throw planError('asset-read','No resource body');const digest=createHash('sha256');let size=0;try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>10*1024*1024)throw planError('asset-size','Remote resource exceeds limit');digest.update(chunk.value);}}finally{await reader.cancel();}const observed=digest.digest('hex');if(observed!==hash)throw planError('asset-conflict','Content-addressed resource has unexpected bytes');return {url,sha256:observed};};
 const existing=await read();if(existing||!upload)return existing;
 if(!api.metadata.capabilities['game-file-upload'].available)throw planError('asset-unsupported','This host cannot upload files');
 await api.request(`/admin/games/${api.metadata.binding.gameId}/files/upload`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename,mime:a.mime,base64:bytes.toString('base64')})});
 const verified=await read();if(!verified)throw planError('unknown-after-dispatch','Uploaded resource unavailable; reconcile before retry');return verified;
}
