import test from 'node:test';
import assert from 'node:assert/strict';
import {gameOperationSpecs,modernAnnouncementOperationSpec} from '../src/game-operation-specs.ts';
import {createModernGameFileUploadSpec} from '../src/modern-game-file-operation-spec.ts';
import type {AuthoringApiPort} from '../src/recalculation-browser.ts';
const legacy=gameOperationSpecs[0],modern=gameOperationSpecs[1];
const api=(engine:'legacy'|'modern',request:AuthoringApiPort['request'])=>({metadata:{binding:{engine,gameId:42}},request})as unknown as AuthoringApiPort;
test('game settings proposals bind engine-specific types and game scope without accepting arbitrary POST fields',()=>{
 assert.deepEqual(legacy.validate({fields:{title:'new',hide_game_from_calendar:true,is_available_after_finished:false}}),{levelId:0,fields:{title:'new',hide_game_from_calendar:true,is_available_after_finished:false}});
 assert.throws(()=>legacy.validate({fields:{is_moderated:'false'}}));assert.throws(()=>legacy.validate({fields:{__VIEWSTATE:'x'}}));assert.throws(()=>legacy.validate({levelId:1,fields:{title:'x'}}));
 assert.deepEqual(modern.validate({fields:{max_players:0,is_moderated:false}}),{levelId:0,fields:{max_players:0,is_moderated:false}});assert.throws(()=>modern.validate({fields:{max_players:'0'}}));
});
test('modern announcement requires all explicit display values and verifies every setting and unchanged sibling',async()=>{
 const args=modernAnnouncementOperationSpec.validate({html:'<h1>literal + &</h1>',replaceNlToBr:false,hideGameDescr:false,displayAnnouncement:1});
 assert.throws(()=>modernAnnouncementOperationSpec.validate({html:'text'}));
 const before={game:{id:42,title:'game',descr:'old',replace_nl_to_br:true,hide_game_descr:true,display_announcement:0},authors:[],referees:[]};
 modernAnnouncementOperationSpec.checkBefore?.(before,args);let calls=0;
 const connection=api('modern',async(path,init)=>{calls++;assert.equal(path,'/admin/games/42');assert.equal(init?.method,'PATCH');assert.deepEqual(JSON.parse(String(init?.body)),{descr:args.html,replace_nl_to_br:false,hide_game_descr:false,display_announcement:1});return Response.json({});});
 await modernAnnouncementOperationSpec.request(connection,args,before);assert.equal(calls,1);
 const after={...before,game:{...before.game,descr:args.html,replace_nl_to_br:false,hide_game_descr:false,display_announcement:1}};
 assert.equal(modernAnnouncementOperationSpec.verify(before,after,args),true);assert.equal(modernAnnouncementOperationSpec.verify(before,{...after,game:{...after.game,title:'lost'}},args),false);
});
test('modern settings proposal read omits computed counters but retains permissions and precise actor identity',async()=>{
 const connection=api('modern',async()=>Response.json({game:{id:42,title:'game',started:false,seconds_remaining:123,price:10},authors:[{user_id:4,login:'author',common_index:999}],referees:[],can_edit:true}));
 assert.deepEqual(await modern.read(connection,{levelId:0}),{game:{id:42,title:'game',started:false,price:10},authors:[{user_id:4,login:'author'}],referees:[],can_edit:true});
});
test('image upload proposal reads only a scoped opaque image artifact and rejects altered bytes before dispatch',async()=>{
 const bytes=new Uint8Array([137,80,78,71,13,10,26,10,1]),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');let resolverCalls=0,writes=0;
 const spec=createModernGameFileUploadSpec(async(ref,connection)=>{resolverCalls++;assert.equal(ref,'source:opaque');assert.equal(connection.metadata.binding.gameId,42);return new Blob([bytes]);});
 const args=spec.validate({imageRef:'source:opaque',filename:'poster.png',size:9,sha256,poster:true,replaceExisting:false});
 const connection=api('modern',async(path,init)=>{if(init?.method==='POST'){writes++;return Response.json({});}return Response.json(path.endsWith('/files')?{game_id:42,files:[],items:[]}:{game:{id:42,poster_url:null}});});
 const before=await spec.read(connection,args);spec.checkBefore?.(before,args);await spec.request(connection,args,before);assert.equal(writes,1);assert.equal(resolverCalls,2);
 await assert.rejects(spec.read(connection,{...args,sha256:'0'.repeat(64)}),/conflict/);assert.equal(writes,1);
 assert.throws(()=>spec.validate({...args,base64:'not allowed'}));
});
