import test from 'node:test';
import assert from 'node:assert/strict';
import {RouteCalculator,RouteError,parseRouteInput,routeToolDefinition} from '../src/routing.ts';

const origin={latitude:55.7558,longitude:37.6173},destination={latitude:55.817,longitude:37.4416};
const input={origin,destination,mode:'driving'};
const reply=(distance=8400,duration=845.2)=>Response.json({routes:[{summary:{distance,duration}}],metadata:{secret:'untrusted-provider-data'}});
function calculator(fetcher:typeof fetch,apiKey=()=> 'synthetic-routing-secret'){return new RouteCalculator({apiKey,fetch:fetcher,minIntervalMs:0});}

test('driving and walking use distinct profiles and lon/lat on the wire, preserving author via order',async()=>{
 const calls:{url:string;body:any}[]=[];
 const api=calculator(async(url,init)=>{assert.equal(new Headers(init?.headers).get('Authorization'),'synthetic-routing-secret');assert.equal(init?.method,'POST');assert.equal(init?.credentials,'omit');assert.equal(init?.redirect,'error');calls.push({url:String(url),body:JSON.parse(String(init?.body))});return reply();});
 const driving=await api.calculate({...input,via:[{latitude:55.77,longitude:37.6}]}),walking=await api.calculate({...input,mode:'walking'});
 assert.match(calls[0]!.url,/\/driving-car\/json$/);assert.match(calls[1]!.url,/\/foot-walking\/json$/);
 assert.deepEqual(calls[0]!.body.coordinates,[[37.6173,55.7558],[37.6,55.77],[37.4416,55.817]]);
 assert.deepEqual(calls[1]!.body.radiuses,[50,50]);assert.equal(calls[0]!.body.geometry,false);assert.equal(calls[0]!.body.instructions,false);
 assert.equal(driving.distanceMeters,8400);assert.equal(driving.distanceKm,8.4);assert.equal(driving.durationSeconds,845.2);assert.equal(driving.hintAfterSeconds,846);
 assert.equal(walking.profile,'foot-walking');assert.equal(walking.trafficIncluded,false);assert.ok(walking.attribution.dataUrl);
 assert.ok(!JSON.stringify(driving).includes('secret'));assert.ok(!JSON.stringify(routeToolDefinition).includes('apiKey'));
});

test('the two-minute recommendation can use unrounded seconds, rather than display minutes',async()=>{
 const above=await calculator(async()=>reply(170,120.1)).calculate({...input,mode:'walking'});
 assert.ok(above.durationSeconds>120);assert.equal(above.hintAfterSeconds,121);
 const boundary=await calculator(async()=>reply(170,120)).calculate({...input,mode:'walking'});
 assert.equal(boundary.durationSeconds,120);assert.equal(boundary.hintAfterSeconds,120);
});

test('invalid coordinates, modes, secrets, arbitrary URLs and oversized via lists never reach the network',async()=>{
 let calls=0;const api=calculator(async()=>{calls++;return reply();});
 for(const invalid of [null,{}, {...input,mode:['driving']},{...input,origin:[55,37]},{...input,origin:{latitude:'55',longitude:37}},{...input,destination:{latitude:91,longitude:0}},{...input,destination:{latitude:0,longitude:181}},{...input,origin:{latitude:NaN,longitude:0}},{...input,origin:{...origin,extra:1}},{...input,via:Array(9).fill(origin)},{...input,apiKey:'model-secret'},{...input,url:'https://other.invalid/'},{...input,mode:'flying'}]) {
  await assert.rejects(api.calculate(invalid),{code:'invalid_route_input'});
 }
 assert.equal(calls,0);assert.deepEqual(parseRouteInput(input),input);
});

test('missing keys, exhausted quota and no-route errors are explicit and have no retry or fallback',async()=>{
 let calls=0;await assert.rejects(calculator(async()=>{calls++;return reply();},()=> '').calculate(input),{code:'routing_key_required'});assert.equal(calls,0);
 for(const [status,body,code] of [[401,{},'routing_auth_failed'],[403,{},'routing_auth_failed'],[429,{},'routing_quota_exceeded'],[404,{error:{code:2010,message:'synthetic-routing-secret'}},'no_route'],[200,{error:{code:2009}},'no_route'],[503,{error:{message:'synthetic-routing-secret'}},'routing_unavailable']] as const) {
  calls=0;const api=calculator(async()=>{calls++;return Response.json(body,{status});});
  await assert.rejects(api.calculate(input),(error:unknown)=>error instanceof RouteError&&error.code===code&&!error.message.includes('secret'));assert.equal(calls,1);
 }
});

test('malformed and oversized responses never become a successful estimate',async()=>{
 for(const response of [Response.json({routes:[]}),Response.json({routes:[{summary:{distance:-1,duration:30}}]}),Response.json({routes:[{summary:{distance:100,duration:'30'}}]}),new Response('{'),new Response('x'.repeat(1_000_001))]) {
  await assert.rejects(calculator(async()=>response).calculate(input),{code:'invalid_route_response'});
 }
});

test('transport failure redacts error text and key changes discard the result',async()=>{
 await assert.rejects(calculator(async()=>{throw new Error('synthetic-routing-secret');}).calculate(input),(error:unknown)=>error instanceof RouteError&&error.code==='routing_unavailable'&&!error.message.includes('secret'));
 let key='initial';const api=calculator(async()=>{key='changed';return reply();},()=>key);
 await assert.rejects(api.calculate(input),{code:'routing_session_changed'});
});

test('cancellation prevents dispatch and propagates through the network without retry',async()=>{
 let calls=0;const aborted=AbortSignal.abort();await assert.rejects(calculator(async()=>{calls++;return reply();}).calculate(input,aborted));assert.equal(calls,0);
 const controller=new AbortController();const api=calculator(async(_url,init)=>{calls++;controller.abort();assert.equal(init?.signal?.aborted,true);throw new DOMException('Aborted','AbortError');});
 await assert.rejects(api.calculate(input,controller.signal),{name:'AbortError'});assert.equal(calls,1);
});
