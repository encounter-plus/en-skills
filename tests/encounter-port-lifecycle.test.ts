import test from 'node:test';
import assert from 'node:assert/strict';
import {EncounterClient} from '../src/encounter.ts';
import {createAuthoringApi} from '../src/authoring-factory.ts';

test('generated endpoints use the credentials owned by a real modern authoring port',async()=>{
  const calls:{url:URL;init:RequestInit}[]=[];
  const api=createAuthoringApi({domain:'demo.en.cx',gameId:42,sessionEpoch:'fixture',token:()=> 'port-token',fetch:async(url,init)=>{
    calls.push({url:new URL(String(url)),init:init??{}});return Response.json({observed:true});
  }});
  const client=new EncounterClient({domain:'demo.en.cx',api});
  assert.deepEqual((await client.game('42')).data,{observed:true});
  const reads=[()=>client.monitoringPage('42','154',0,1),()=>client.statisticsPage('42',2,1),()=>client.gameStatisticsPage('42',1),()=>client.playersPage('42',1),()=>client.corrections('42'),()=>client.correction('42',91)];
  for(const read of reads)assert.deepEqual(await read(),{observed:true});
  const body={gamePlayerId:7,playerId:8,levelId:154,seconds:37,isBonus:true,comment:'synthetic'};
  assert.deepEqual(await client.createCorrection('42',body),{observed:true});
  assert.equal(calls.length,8);
  for(const call of calls){assert.equal(call.url.origin,'https://api.en.cx');assert.equal(new Headers(call.init.headers).get('Authorization'),'Bearer port-token');}
  assert.equal(calls[1].url.pathname,'/games/42/monitoring');assert.equal(calls[1].url.searchParams.get('level_id'),'154');
  assert.equal(calls.at(-1)!.init.method,'POST');assert.deepEqual(JSON.parse(String(calls.at(-1)!.init.body)),{game_player_id:7,player_id:8,level_id:154,seconds:37,is_bonus:true,comment:'synthetic'});
  client.invalidate();await assert.rejects(client.corrections('42'),/inactive/);assert.equal(calls.length,8);
});

test('generated endpoints retain token validation and token-change fencing without a supplied port',async()=>{
  let token='first',calls=0;
  const client=new EncounterClient({domain:'demo.en.cx',token:()=>token,fetch:async()=>{calls++;return Response.json({});}});
  await client.corrections('42');assert.equal(calls,1);
  token='changed';await assert.rejects(client.statisticsPage('42',2,1),/changed/);assert.equal(calls,1);
  const missing=new EncounterClient({domain:'demo.en.cx',fetch:async()=>{throw new Error('must not dispatch');}});
  await assert.rejects(missing.monitoringPage('42','154',0,1),/Missing or invalid access token/);
});

test('generated endpoints fence delayed credentials and responses on invalidation',async()=>{
  let resolveToken!:(value:string)=>void,writes=0;
  const client=new EncounterClient({domain:'demo.en.cx',token:()=>new Promise(resolve=>{resolveToken=resolve;}),fetch:async()=>{writes++;return Response.json({});}});
  const pending=client.corrections('42');client.invalidate();resolveToken('token');await assert.rejects(pending,/changed/);assert.equal(writes,0);
  let resolveResponse!:(value:Response)=>void;
  const api=createAuthoringApi({domain:'demo.en.cx',gameId:42,sessionEpoch:'fixture',token:()=> 'port-token',fetch:async()=>new Promise(resolve=>{resolveResponse=resolve;})});
  const portClient=new EncounterClient({domain:'demo.en.cx',api});
  const response=portClient.corrections('42');await new Promise(resolve=>setImmediate(resolve));portClient.invalidate();resolveResponse(Response.json({}));await assert.rejects(response,/changed/);
});

test('invalidation while decoding a response body fences the completed snapshot',async()=>{
  let reading!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>{reading=resolve;});
  const stream=new ReadableStream<Uint8Array>({pull(controller){
    reading();return new Promise<void>(resolve=>{release=()=>{controller.enqueue(new TextEncoder().encode('{"observed":true}'));controller.close();resolve();};});
  }},{highWaterMark:0});
  const metadata=createAuthoringApi({domain:'demo.en.cx',gameId:42,sessionEpoch:'fixture',token:()=> 'port-token'}).metadata;
  const client=new EncounterClient({domain:'demo.en.cx',api:{metadata,invalidate(){},request:async()=>new Response(stream)}});
  const pending=client.game('42');await started;client.invalidate();release();
  await assert.rejects(pending,/Encounter session changed/);
});

test('a real authoring port cannot be attached to a client for another tenant',()=>{
  let dispatches=0;
  const api=createAuthoringApi({domain:'demo.en.cx',gameId:42,sessionEpoch:'fixture',token:()=> 'port-token',fetch:async()=>{dispatches++;return Response.json({});}});
  assert.throws(()=>new EncounterClient({domain:'cp.en.cx',api}),/Authoring port tenant mismatch/);
  assert.equal(dispatches,0);
});
