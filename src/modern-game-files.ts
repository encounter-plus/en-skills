import {AuthoringApiError,type AuthoringApiPort} from './authoring-api.ts';
type Row=Record<string,unknown>;
export interface ModernGameFileUpload {filename:string;size:number;sha256:string;poster:boolean;replaceExisting:boolean}
export function validateModernGameFileUpload(input:unknown):ModernGameFileUpload {
 const row=input as ModernGameFileUpload;
 if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(key=>!['filename','size','sha256','poster','replaceExisting'].includes(key))||typeof row.filename!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(?:png|jpg|gif)$/.test(row.filename)||!Number.isSafeInteger(row.size)||row.size<1||row.size>10*1024*1024||typeof row.sha256!=='string'||! /^[a-f0-9]{64}$/.test(row.sha256)||typeof row.poster!=='boolean'||typeof row.replaceExisting!=='boolean'||row.poster&&!/^poster\.(png|jpg|gif)$/.test(row.filename))throw new AuthoringApiError('unsupported');
 if(!row.poster&&/^poster\.(png|jpg|gif)$/i.test(row.filename))throw new AuthoringApiError('unsupported');
 return structuredClone(row);
}
export async function readModernGameFiles(api:AuthoringApiPort,signal?:AbortSignal):Promise<Row>{
 if(api.metadata.binding.engine!=='modern')throw new AuthoringApiError('unsupported');
 const id=api.metadata.binding.gameId,response=await api.request(`/admin/games/${id}/files`,{signal});if(!response.ok)throw new AuthoringApiError('incomplete-read');
 const inventory=await response.json()as Row;
 if(inventory.game_id!==id||!Array.isArray(inventory.files)||inventory.files.some(value=>typeof value!=='string')||inventory.items!==undefined&&(!Array.isArray(inventory.items)||inventory.items.some(item=>!item||typeof item!=='object'||typeof item.name!=='string'||!Number.isSafeInteger(item.size)||item.size<0)))throw new AuthoringApiError('incomplete-read');
 const detailsResponse=await api.request(`/games/${id}/details`,{signal});if(!detailsResponse.ok)throw new AuthoringApiError('incomplete-read');
 const details=await detailsResponse.json()as Row,game=details.game as Row;if(!game||game.id!==id)throw new AuthoringApiError('incomplete-read');
 return {game_id:id,inventory,poster_url:game.poster_url??null};
}
function names(state:Row):string[]{return (state.inventory as Row).files as string[];}
export function checkModernGameFileBefore(before:Row,input:ModernGameFileUpload){
 validateModernGameFileUpload(input);const inventory=before.inventory as Row;
 if(!inventory||!Array.isArray(inventory.files))throw new AuthoringApiError('incomplete-read');
 if(names(before).includes(input.filename)&&!input.replaceExisting)throw new AuthoringApiError('conflict');
 if(!Array.isArray(inventory.items))throw new AuthoringApiError('incomplete-read');
 // The inventory exposes size, not a content hash. An equal-size overwrite
 // cannot be distinguished from a lost write by independent read-back.
 const existing=(inventory.items as Row[]).filter(item=>item.name===input.filename);
 if(existing.length>1||existing.some(item=>item.size===input.size))throw new AuthoringApiError('unsupported');
 if(input.poster&&names(before).some(name=>/^poster\.(?:png|jpg|gif)$/.test(name)&&name!==input.filename))throw new AuthoringApiError('conflict');
 if(typeof inventory.max_mb==='number'&&inventory.max_mb>0&&input.size>inventory.max_mb*1024*1024)throw new AuthoringApiError('unsupported');
}
export async function inspectModernGameUploadImage(input:ModernGameFileUpload,image:Blob):Promise<Blob>{
 validateModernGameFileUpload(input);
 if(!(image instanceof Blob)||image.size!==input.size)throw new AuthoringApiError('conflict');
 const bytes=new Uint8Array(await image.arrayBuffer()),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
 if(hash!==input.sha256)throw new AuthoringApiError('conflict');
 const mime=bytes.length>=8&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)?'image/png':bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.length>=6&&['GIF87a','GIF89a'].includes(new TextDecoder().decode(bytes.slice(0,6)))?'image/gif':undefined;
 const expected=input.filename.endsWith('.png')?'image/png':input.filename.endsWith('.jpg')?'image/jpeg':'image/gif';if(mime!==expected)throw new AuthoringApiError('unsupported');
 return new Blob([bytes],{type:mime});
}
export async function modernGameFileUploadRequest(api:AuthoringApiPort,input:ModernGameFileUpload,before:Row,image:Blob):Promise<Response>{
 if(api.metadata.binding.engine!=='modern')throw new AuthoringApiError('unsupported');checkModernGameFileBefore(before,input);
 const verifiedImage=await inspectModernGameUploadImage(input,image);
 const form=new FormData();form.append('file',verifiedImage,input.filename);
 return api.request(`/admin/games/${api.metadata.binding.gameId}/files`,{method:'POST',body:form});
}
export function verifyModernGameFileUpload(before:Row,after:Row,input:ModernGameFileUpload):boolean{
 if(before.game_id!==after.game_id||!after.inventory||!Array.isArray((after.inventory as Row).files)||!Array.isArray((after.inventory as Row).items))return false;
 const prior=names(before),current=names(after),items=(after.inventory as Row).items as Row[],item=items.filter(item=>item.name===input.filename);
 if(new Set(prior).size!==prior.length||new Set(current).size!==current.length)return false;
 if(item.length!==1||item[0].size!==input.size||!current.includes(input.filename)||JSON.stringify(prior.filter(name=>name!==input.filename).sort())!==JSON.stringify(current.filter(name=>name!==input.filename).sort()))return false;
 const oldItems=(before.inventory as Row).items;if(!Array.isArray(oldItems))return false;
 const siblings=(rows:Row[])=>rows.filter(row=>row.name!==input.filename).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
 if(JSON.stringify(siblings(oldItems))!==JSON.stringify(siblings(items)))return false;
 if(input.poster){
  if(typeof after.poster_url!=='string')return false;let url:URL;try{url=new URL(after.poster_url,'https://api.en.cx/');}catch{return false;}
  if(url.pathname!==`/data/games/${after.game_id}/${input.filename}`||url.search||url.hash)return false;
 }else if(before.poster_url!==after.poster_url)return false;
 return true;
}
