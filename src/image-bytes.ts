export function checkedPhoto(image:Uint8Array) {
 const bytes=Uint8Array.from(image);
 if(!bytes.length||bytes.length>8*1024*1024)throw new Error('Image must be at most 8 MiB');
 const png=[137,80,78,71,13,10,26,10].every((byte,index)=>bytes[index]===byte);
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(!png&&!jpeg)throw new Error('Expected PNG or JPEG image');
 return {bytes,mime:png?'image/png':'image/jpeg'};
}
export function photoBase64(bytes:Uint8Array) {let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));return btoa(binary);}
export async function photoSha256(bytes:Uint8Array) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes))),byte=>byte.toString(16).padStart(2,'0')).join('');}
