import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicGoogleSources, GooglePublicAccessError, publicGoogleLink, parsePublicCsv } from '../src/google-public.ts';
const doc='https://docs.google.com/document/d/synthetic_doc/edit?tab=t.synthetic';
const sheet='https://docs.google.com/spreadsheets/d/synthetic_sheet/edit#gid=42';

test('whole-link reader discovers nonsequential tabs and preserves partial coverage',async()=>{
 const calls:string[]=[];
 const client=new PublicGoogleSources({fetch:async(url,init)=>{
  assert.equal(init?.credentials,'omit');calls.push(String(url));
  if(String(url).includes('htmlview'))return new Response('<ul><li id="sheet-button-42">Summary</li><li id="sheet-button-987654">Codes</li><li id="sheet-button-71">Unavailable</li></ul>',{headers:{'content-type':'text/html'}});
  if(String(url).includes('gid=71'))return new Response('',{status:403});
  return new Response('001,"line\nnext"',{headers:{'content-type':'text/csv'}});
 }});
 const result=await client.readAll(sheet);
 assert.deepEqual(result.parts.map(part=>part.id),['42','987654','71']);
 assert.equal(result.parts[1].snapshot?.rows?.[0][0],'001');
 assert.equal(result.parts[2].status,'failed');assert.equal(result.coverage.allDiscoveredPartsRead,false);
 assert.equal(result.coverage.complete,false);assert.equal(calls.length,5);
});

test('missing public inventory never becomes a complete workbook claim',async()=>{
 const client=new PublicGoogleSources({fetch:async(url)=>new Response(String(url).includes('htmlview')?'<html>No navigation</html>':'001',{headers:{'content-type':String(url).includes('htmlview')?'text/html':'text/csv'}})});
 const result=await client.readAll(sheet);assert.equal(result.parts.length,1);assert.equal(result.coverage.inventoryVerified,false);assert.equal(result.coverage.allDiscoveredPartsRead,false);
});

test('Google htmlview literal navigation is parsed without executing scripts or accepting other files',async()=>{
 const inventory='<script>items.push({name: "Codes", pageUrl: "https://docs.google.com/spreadsheets/d/synthetic_sheet/htmlview/sheet?headers=true&gid=987", gid: "987",initialSheet:false});items.push({name: "Other", pageUrl: "https://docs.google.com/spreadsheets/d/other/htmlview/sheet?gid=2", gid: "2"});throw new Error("MUST NOT EXECUTE");</script>';
 const client=new PublicGoogleSources({fetch:async(url)=>new Response(String(url).includes('htmlview')?inventory:'001',{headers:{'content-type':String(url).includes('htmlview')?'text/html':'text/csv'}})});
 const result=await client.readAll(sheet);assert.deepEqual(result.parts.map(part=>part.id),['987']);assert.equal(result.coverage.allDiscoveredPartsRead,true);
});
test('public links select tab/gid and keep resourcekey without arbitrary query parameters', () => {
  assert.equal(publicGoogleLink(doc).exportUrl.searchParams.get('tab'),'t.synthetic');
  assert.equal(publicGoogleLink(sheet).exportUrl.searchParams.get('gid'),'42');
  const link=publicGoogleLink(doc+'&resourcekey=synthetic_key&access_token=ignored');
  assert.equal(link.exportUrl.searchParams.get('resourcekey'),'synthetic_key');
  assert.equal(link.exportUrl.searchParams.get('access_token'),null);
  for(const value of ['http://docs.google.com/document/d/x','https://docs.google.com.evil.invalid/document/d/x','https://docs.google.com@evil.invalid/document/d/x'])
    assert.throws(()=>publicGoogleLink(value));
});
test('public reader sends no credentials and follows only Google export redirects',async()=>{
  const calls: RequestInit[]=[];
  const client=new PublicGoogleSources({fetch:async(url,init)=>{
    calls.push(init!);
    if(calls.length===1) return new Response(null,{status:302,headers:{location:'https://docs.googleusercontent.com/synthetic-export'}});
    return new Response('Код 0012',{headers:{'content-type':'text/plain; charset=utf-8'}});
  }});
  const result=await client.read(doc);
  assert.equal(result.text,'Код 0012');
  assert.equal(result.selection,'t.synthetic');
  assert.ok(result.limitations.length);
  for(const call of calls){assert.equal(call.credentials,'omit');assert.equal(call.headers,undefined);}
});
test('CSV preserves zeros, Unicode, quoted commas/newlines, empty and escaped fields',()=>{
  assert.deepEqual(parsePublicCsv('0012,"конь6,кон66","строка\nещё","a""b",\r\n'),[['0012','конь6,кон66','строка\nещё','a"b','']]);
  assert.deepEqual(parsePublicCsv(''),[]);
  assert.deepEqual(parsePublicCsv('""'),[['']]);
  assert.throws(()=>parsePublicCsv('"unfinished'));
  assert.throws(()=>parsePublicCsv('"closed"x'));
});
test('sheet reader returns literal rows and single-sheet coverage',async()=>{
  const result=await new PublicGoogleSources({fetch:async()=>new Response('0012,конь6',{headers:{'content-type':'text/csv'}})}).read(sheet);
  assert.deepEqual(result.rows,[['0012','конь6']]); assert.equal(result.selection,'42');
});
test('closed files and login HTML request link sharing, rate limiting does not',async()=>{
  for(const response of [
    new Response(null,{status:403}),
    new Response(null,{status:302,headers:{location:'https://accounts.google.com/login'}}),
    new Response('<html>login</html>',{headers:{'content-type':'text/html'}}),
    new Response('<!DOCTYPE html><html>login</html>',{headers:{'content-type':'text/plain'}})
  ]){
    await assert.rejects(new PublicGoogleSources({fetch:async()=>response}).read(doc),
      error=>error instanceof GooglePublicAccessError && /Все, у кого есть ссылка → Читатель/.test(error.message));
  }
  await assert.rejects(new PublicGoogleSources({fetch:async()=>new Response(null,{status:429})}).read(doc),/HTTP 429/);
});
test('untrusted redirects and oversized exports fail rather than return partial content',async()=>{
  let calls=0;
  await assert.rejects(new PublicGoogleSources({fetch:async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});}}).read(doc),/Unexpected/);
  assert.equal(calls,1);
  await assert.rejects(new PublicGoogleSources({fetch:async()=>new Response(new Uint8Array(10*1024*1024+1),{headers:{'content-type':'text/plain'}})}).read(doc),/10 MiB/);
});

test('browser public exports follow opaque redirects without credentials and validate final host',async()=>{
 const response=(url:string)=>{const result=new Response('Код 0012',{headers:{'content-type':'text/plain'}});Object.defineProperty(result,'url',{value:url});return result;};
 const client=new PublicGoogleSources({browserRedirects:true,fetch:async(_url,init)=>{assert.equal(init?.redirect,'follow');assert.equal(init?.credentials,'omit');assert.equal(init?.referrerPolicy,'no-referrer');return response('https://docs.googleusercontent.com/export');}});
 assert.equal((await client.read(doc)).text,'Код 0012');
 await assert.rejects(new PublicGoogleSources({browserRedirects:true,fetch:async()=>response('https://evil.invalid/export')}).read(doc),/Unexpected/);
 await assert.rejects(new PublicGoogleSources({browserRedirects:true,fetch:async()=>response('https://accounts.google.com/login')}).read(doc),GooglePublicAccessError);
});

test('gviz and pubhtml errors explain the supported sharing link and do not retry',()=>{
 for(const suffix of ['gviz/tq?tqx=out:csv&sheet=Brief','pubhtml'])assert.throws(()=>publicGoogleLink('https://docs.google.com/spreadsheets/d/synthetic_sheet/'+suffix),/edit\?gid=.*Do not retry/);
});
