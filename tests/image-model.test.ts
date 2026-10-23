import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIImageReader, ImageReaderWithFallback, ImageModelRefusalError } from '../src/image-model.ts';
import { type OcrProvider, type OcrEvidence } from '../src/ocr.ts';
const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
const reading={transcription:'0012конь6',status:'ambiguous',alternatives:['0012кон66'],location:'нижняя левая надпись',evidence:'мягкий знак похож на 6'};
const response=(value:unknown)=>new Response(JSON.stringify(value));
const complete=(readings:unknown[])=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({readings})}]}]});
test('image model gets actual image input and preserves uncertain literal readings',async()=>{
  let body: any;
  const model=new OpenAIImageReader({model:'synthetic-image-model',token:()=> 'synthetic-key',
    fetch:async(url,init)=>{assert.equal(String(url),'https://api.openai.com/v1/responses');body=JSON.parse(String(init?.body));return response(complete([reading]));}});
  const result=await model.recognize(png);
  assert.equal(body.store,false); assert.equal(body.input[0].content[1].type,'input_image');
  assert.match(body.input[0].content[1].image_url,/^data:image\/png;base64,/);
  assert.equal(body.text.format.type,'json_schema'); assert.equal(body.text.format.strict,true);
  assert.equal(result.readings[0].transcription,'0012конь6');
  assert.deepEqual(result.readings[0].alternatives,['0012кон66']);assert.equal(result.needsVisualReview,true);
  assert.ok(!JSON.stringify(body).includes('0012конь6'));
});
const fallbackResult:OcrEvidence={schemaVersion:1,provider:'google-cloud-vision',imageSha256:'synthetic',capturedAt:'synthetic',text:'0012',raw:{},needsVisualReview:true};
test('technical primary failure invokes fallback once and records its use',async()=>{
  let calls=0;
  const primary:OcrProvider={recognize:async()=>{throw new Error('synthetic failure');}};
  const fallback:OcrProvider={recognize:async()=>{calls++;return fallbackResult;}};
  const result=await new ImageReaderWithFallback(primary,fallback).recognize(png);
  assert.equal(calls,1);assert.equal(result.provider,'google-cloud-vision');
  assert.equal(result.fallback?.used,true);
});
test('ambiguous, unreadable and empty model results do not trigger fallback',async()=>{
  let calls=0;
  for(const readings of [[reading],[{...reading,status:'unreadable',transcription:null}],[]]){
    const model=new OpenAIImageReader({model:'synthetic',token:()=> 'synthetic',fetch:async()=>response(complete(readings))});
    const result=await new ImageReaderWithFallback(model,{recognize:async()=>{calls++;return fallbackResult;}}).recognize(png);
    assert.equal(result.provider,'openai-image-model');
  }
  assert.equal(calls,0);
});
test('refusal is not bypassed through fallback, invalid images never leave the host',async()=>{
  let calls=0;
  const model=new OpenAIImageReader({model:'synthetic',token:()=> 'synthetic',fetch:async()=>response({status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]})});
  const pipeline=new ImageReaderWithFallback(model,{recognize:async()=>{calls++;return fallbackResult;}});
  await assert.rejects(pipeline.recognize(png),ImageModelRefusalError);
  await assert.rejects(pipeline.recognize(Buffer.from('not image')),/PNG or JPEG/);
  assert.equal(calls,0);
});
test('incomplete and semantically invalid model responses are rejected',async()=>{
  for(const data of [{...complete([reading]),status:'incomplete'},complete([{...reading,status:'clear',transcription:null}]),complete([{...reading,status:'unreadable'}])]){
    const model=new OpenAIImageReader({model:'synthetic',token:()=> 'synthetic',fetch:async()=>response(data)});
    await assert.rejects(model.recognize(png));
  }
});
