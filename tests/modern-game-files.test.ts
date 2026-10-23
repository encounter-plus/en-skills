import test from 'node:test';
import assert from 'node:assert/strict';
import type {AuthoringApiPort} from '../src/authoring-api.ts';
import {validateModernGameFileUpload,checkModernGameFileBefore,inspectModernGameUploadImage,modernGameFileUploadRequest,readModernGameFiles,verifyModernGameFileUpload} from '../src/modern-game-files.ts';
const bytes=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);
const hash=async(value:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(value))),n=>n.toString(16).padStart(2,'0')).join('');
const before={game_id:42,inventory:{game_id:42,files:['task.png'],items:[{name:'task.png',size:100,url:'data/games/42/task.png'}],max_mb:10},poster_url:null};
const args=async()=>({filename:'poster.png',size:bytes.length,sha256:await hash(bytes),poster:true,replaceExisting:false});
const api=(request:AuthoringApiPort['request'])=>({metadata:{binding:{engine:'modern',gameId:42}},request}) as unknown as AuthoringApiPort;
test('reviewed image upload binds exact supplied bytes and dispatches one multipart file with no forced content-type',async()=>{
 const input=await args(),calls:RequestInit[]=[];const connection=api(async(path,init)=>{assert.equal(path,'/admin/games/42/files');calls.push(init!);return Response.json({});});
 await modernGameFileUploadRequest(connection,input,before,new Blob([bytes]));assert.equal(calls.length,1);assert.equal(calls[0].method,'POST');assert.equal(new Headers(calls[0].headers).has('Content-Type'),false);
 const file=(calls[0].body as FormData).get('file')as File;assert.equal(file.name,'poster.png');assert.equal(file.type,'image/png');assert.deepEqual(new Uint8Array(await file.arrayBuffer()),bytes);
 await assert.rejects(modernGameFileUploadRequest(connection,{...input,sha256:'0'.repeat(64)},before,new Blob([bytes])),/conflict/);
 await assert.rejects(modernGameFileUploadRequest(connection,input,before,new Blob([bytes.slice(1)])),/conflict/);assert.equal(calls.length,1);
});
test('image upload validates native filename, explicit replacement, signature and bounded limits before writing',async()=>{
 const input=await args();for(const patch of [{poster:false},{filename:'Poster.png',poster:false},{filename:'../poster.png'},{filename:'poster.svg'},{filename:'other.png'},{size:0},{size:10485761},{sha256:'xyz'}])assert.throws(()=>validateModernGameFileUpload({...input,...patch}));
 assert.throws(()=>checkModernGameFileBefore({...before,inventory:{...before.inventory,files:['poster.gif']}},input));
 assert.throws(()=>checkModernGameFileBefore({...before,inventory:{...before.inventory,files:['poster.png'],items:[{name:'poster.png',size:11}]}},{...input,replaceExisting:true}),/unsupported/);
 assert.throws(()=>checkModernGameFileBefore({...before,inventory:{...before.inventory,max_mb:0.000001}},input));
 const gif=new Uint8Array([71,73,70,56,57,97,1]);await assert.rejects(inspectModernGameUploadImage({...input,size:gif.length,sha256:await hash(gif)},new Blob([gif])),/unsupported/);
});
test('poster readback requires scoped list, exact file size, unchanged siblings and actual returned poster assignment',async()=>{
 const input=await args(),after={...before,inventory:{...before.inventory,files:['task.png','poster.png'],items:[...before.inventory.items,{name:'poster.png',size:11,url:'data/games/42/poster.png'}]},poster_url:'https://cdn.example/data/games/42/poster.png'};
 assert.equal(verifyModernGameFileUpload(before,after,input),true);
 for(const changed of [{poster_url:null},{poster_url:'/data/games/43/poster.png'},{inventory:{...after.inventory,items:[{name:'poster.png',size:11}]}},{inventory:{...after.inventory,items:[...before.inventory.items,{name:'poster.png',size:12}]}}])assert.equal(verifyModernGameFileUpload(before,{...after,...changed},input),false);
 const read=api(async path=>Response.json(path.endsWith('/files')?after.inventory:{game:{id:42,poster_url:after.poster_url}}));assert.deepEqual(await readModernGameFiles(read),after);
 await assert.rejects(readModernGameFiles(api(async()=>Response.json({game_id:43,files:[],items:[]}))),/incomplete-read/);
});
