import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runRemoteCommand,remoteCommands} from '../src/remote-cli.ts';

test('public workbook CLI discovers later sheets and preserves literal codes without OAuth',async()=>{
 const previousFetch=globalThis.fetch;
 const requests:string[]=[];
 globalThis.fetch=async(input,init)=>{
  const url=String(input);requests.push(url);
  assert.equal(new Headers(init?.headers).has('authorization'),false);
  if(url.includes('format=xlsx'))return new Response('',{status:404});
  if(url.includes('htmlview'))return new Response('<ul><li id="sheet-button-0">Summary</li><li id="sheet-button-987">Level one</li></ul>',{headers:{'content-type':'text/html'}});
  return new Response(url.includes('gid=987')?'code,text\n001,level one':'summary',{headers:{'content-type':'text/csv'}});
 };
 try {
  assert.deepEqual(remoteCommands['google-public-all'],['url','out']);
  const result=await runRemoteCommand('google-public-all',{url:'https://docs.google.com/spreadsheets/d/synthetic_book/edit'}) as {parts:Array<{id:string;snapshot?:{rows?:string[][]}}>;coverage:{allDiscoveredPartsRead:boolean;complete:boolean}};
  assert.deepEqual(result.parts.map(part=>part.id),['0','987']);
  assert.equal(result.parts[1].snapshot?.rows?.[1][0],'001');
  assert.equal(result.coverage.allDiscoveredPartsRead,true);
  assert.equal(result.coverage.complete,false);
  assert.equal(requests.length,4);
 } finally {globalThis.fetch=previousFetch;}
});
