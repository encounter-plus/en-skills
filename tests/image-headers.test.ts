import test from 'node:test';
import assert from 'node:assert/strict';
import {dimensions} from '../src/image-headers.ts';
function png(width:number,height:number,animated=false){
 const bytes=new Uint8Array(animated?57:45),v=new DataView(bytes.buffer);
 bytes.set([137,80,78,71,13,10,26,10]);v.setUint32(8,13);bytes.set(new TextEncoder().encode('IHDR'),12);
 v.setUint32(16,width);v.setUint32(20,height);bytes.set(new TextEncoder().encode(animated?'acTL':'IEND'),37);
 return bytes;
}
test('reads static PNG, JPEG and WebP headers including byte slices',()=>{
 assert.deepEqual(dimensions(png(320,160)),{width:320,height:160,format:'png'});
 const jpeg=new Uint8Array([255,216,255,192,0,11,8,0,160,1,64,1,1,17,0,255,217]);
 assert.deepEqual(dimensions(jpeg),{width:320,height:160,format:'jpeg'});
 const webp=new Uint8Array(30),v=new DataView(webp.buffer);
 webp.set(new TextEncoder().encode('RIFF'));v.setUint32(4,22,true);webp.set(new TextEncoder().encode('WEBPVP8X'),8);v.setUint32(16,10,true);
 webp[24]=63;webp[25]=1;webp[27]=159;
 assert.deepEqual(dimensions(webp),{width:320,height:160,format:'webp'});
 const padded=new Uint8Array(55);padded.set(png(12,7),5);
 assert.deepEqual(dimensions(padded.subarray(5,50)),{width:12,height:7,format:'png'});
 webp[20]=2;assert.throws(()=>dimensions(webp),/Animated/);
});
test('rejects animation, unsupported input, truncated headers and excessive dimensions',()=>{
 for(const bytes of [png(10,10,true),png(5000,5000),png(0,1),new Uint8Array(),new Uint8Array([137,80,78,71]),new TextEncoder().encode('<svg/>')])assert.throws(()=>dimensions(bytes));
});
