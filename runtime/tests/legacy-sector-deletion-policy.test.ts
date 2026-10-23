import test from 'node:test';import assert from 'node:assert/strict';
import {authoringBinding,authoringMetadata} from '../../src/authoring-api.ts';
import {EncounterOperations} from '../src/operations-core.ts';
import type {ApiLike,ApiRequestOptions} from '../src/types.ts';
function fixture(live?:{is_live:boolean;current_players:unknown[];passed_players:unknown[]}){
 const metadata=authoringMetadata(authoringBinding('tech.en.cx',42,'sector-policy'),['sector-delete']),snapshots:unknown[]=[],writes:ApiRequestOptions[]=[];
 const inventory={game_id:42,level_id:9,version:'observed',sectors:[{sector_id:71,sector_name:'delete'},{sector_id:72,sector_name:'keep'}],answers:[{answer_id:31,sector_id:71,answer_text:'001'},{answer_id:32,sector_id:72,answer_text:'002'}],sector_proofs:[{sector_id:71,preservation_version:'first'},{sector_id:72,preservation_version:'second'}]};
 const api:ApiLike={authoringMetadata:async()=>metadata,async request<T>(method:string,path:string,options:ApiRequestOptions={}){if(path.endsWith('/editor'))return {level:{level_id:9,level_number:1}}as T;if(path.includes('live-statistics')){if(!live)throw new Error('Native player statistics unavailable');return live as T;}if(method==='DELETE'){writes.push(options);inventory.sectors=inventory.sectors.filter(row=>row.sector_id!==71);inventory.answers=inventory.answers.filter(row=>row.sector_id!==71);inventory.sector_proofs=inventory.sector_proofs.filter(row=>row.sector_id!==71);return {}as T;}return structuredClone(inventory)as T;}};
 return {operations:new EncounterOperations(api,{name:'fixture',apiBaseUrl:'https://tech.en.cx',webBaseUrl:'https://tech.en.cx',domain:'tech.en.cx'},{writesEnabled:()=>true,saveSnapshot:async value=>{snapshots.push(value);return 'private';}}),snapshots,writes,inventory};
}
test('native sector deletion with unknown live requires explicit approval, snapshots exact codes and verifies siblings',async()=>{
 const f=fixture();await assert.rejects(f.operations.deleteSector({gameId:42,levelId:9,sectorId:71}),{code:'CONFIRMATION_REQUIRED'});assert.equal(f.writes.length,0);
 const result=await f.operations.deleteSector({gameId:42,levelId:9,sectorId:71,confirmed:true})as {live:{state:string};warnings:string[]};assert.equal(result.live.state,'unknown');assert.ok(result.warnings.includes('current-player-state-unknown'));assert.deepEqual(f.writes[0].headers,{'If-Match':'observed'});assert.deepEqual(f.inventory.answers,[{answer_id:32,sector_id:72,answer_text:'002'}]);
 const snapshot=f.snapshots[0]as {editor:{answers:unknown[]}};assert.equal(snapshot.editor.answers.length,2);
});
test('native explicit approval retains observed current/passed player evidence and warnings',async()=>{
 const f=fixture({is_live:true,current_players:[{id:1}],passed_players:[{id:2}]});const result=await f.operations.deleteSector({gameId:42,levelId:9,sectorId:71,confirmed:true})as {live:{state:string;currentCount:number;passedCount:number};risk:{reason:string};warnings:string[]};assert.deepEqual([result.live.state,result.live.currentCount,result.live.passedCount],['live',1,1]);assert.match(result.risk.reason,/1 current, 1 passed/);assert.ok(result.warnings.includes('native-sector-deletion-removes-linked-codes'));
});
