import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCodeGeneratorTools,secureBelow,wantsCodeGenerator} from '../src/code-generator.ts';
const dictionary=['ёж','ель','щука','мост','кот','дом','плащ','ёлка'];
const tools=()=>createCodeGeneratorTools(async()=>dictionary,()=>0n);

test('portable generator needs no DOM for digit and letter modes and requires a word loader',async()=>{
 const portable=createCodeGeneratorTools();
 assert.equal((await portable.execute('generate_digit_codes',{count:1})).codes?.length,1);
 assert.equal((await portable.execute('generate_letter_codes',{count:1})).codes?.length,1);
 await assert.rejects(portable.execute('generate_word_codes',{count:1}),/Dictionary loader required/);
});
test('dictionary generation supports exactly 1..24 without repeating suffixes',async()=>{
 const words=Array.from({length:24},(_,i)=>'код'+String.fromCharCode(1072+i));
 const result=await createCodeGeneratorTools(async()=>words).execute('generate_word_codes',{count:24,minLength:4,maxLength:5,antiMin:1,antiMax:24,antiMode:'sequential',antiWidth:1});
 assert.equal(result.codes?.length,24);assert.equal(new Set(result.codes?.map(c=>c.base)).size,24);
 assert.deepEqual(result.codes?.map(c=>c.antiCheat),Array.from({length:24},(_,i)=>String(i+1)));
 for(const c of result.codes!){assert.ok(words.includes(c.base));assert.match(c.base,/^[а-яё]{4,5}$/u);assert.equal(c.code,c.base+c.antiCheat);}
});
test('random anti-cheat includes both endpoints in arbitrary ranges and sequential mode rejects overflow',async()=>{
 for(const [antiMin,antiMax] of [[10,99],[100,999],[1,24],[0,999999],[42,42]]){
  for(const upper of [false,true]){
   const tool=createCodeGeneratorTools(async()=>dictionary,limit=>upper?limit-1n:0n);
   const result=await tool.execute('generate_word_codes',{count:1,antiMin,antiMax,antiMode:'random'});
   assert.equal(result.codes?.[0].antiCheat,String(upper?antiMax:antiMin).padStart(2,'0'));
  }
 }
 for(const args of [{antiMode:'unique'},{antiWidth:0},{antiWidth:7},{count:3,antiMin:1,antiMax:2,antiMode:'sequential'}])
  await assert.rejects(tools().execute('generate_word_codes',args));
 const letters=await tools().execute('generate_letter_codes',{count:3,length:2,antiMode:'sequential',antiMin:8,antiMax:10});
 assert.deepEqual(letters.codes?.map(c=>c.antiCheat),['08','09','10']);
});
test('noun range is inclusive, exclusions are case insensitive, and single-digit anti-cheat retains zero',async()=>{
 const result=await tools().execute('generate_word_codes',{count:2,minLength:4,maxLength:4,excludeLetters:'Щ',antiMin:8,antiMax:8});
 assert.ok(result.codes);assert.equal(result.codes.length,2);for(const code of result.codes){assert.equal(code.base.length,4);assert.ok(!code.base.includes('щ'));assert.equal(code.antiCheat,'08');assert.equal(code.code,code.base+'08');}
});
test('default exclusions are empty; ё and е remain distinct, anti-cheat starts at 10',async()=>{
 const result=await tools().execute('generate_word_codes',{count:8});assert.ok(result.codes);assert.equal(result.settings?.excludeLetters,'');assert.equal(result.settings?.antiMin,10);assert.equal(result.settings?.antiMax,99);assert.ok(result.codes.some(c=>c.base==='щука'));assert.ok(result.codes.some(c=>c.base==='ёж'));assert.ok(result.codes.every(c=>c.code.endsWith('10')));
 const onlyYo=await tools().execute('generate_word_codes',{count:1,minLength:2,maxLength:2,excludeLetters:'Е'});assert.equal(onlyYo.codes?.[0].base,'ёж');
});
test('small spaces exhaust without duplicate retries; digits retain their exact width',async()=>{
 const digits=await tools().execute('generate_digit_codes',{length:1,count:10});assert.equal(new Set(digits.codes?.map(c=>c.code)).size,10);assert.ok(digits.codes?.some(c=>c.code==='0'));
 const letters=await tools().execute('generate_letter_codes',{alphabet:'ааБ',length:2,count:4,antiMin:0,antiMax:0});assert.equal(new Set(letters.codes?.map(c=>c.base)).size,4);assert.ok(letters.codes?.every(c=>c.code.endsWith('00')));
 const padded=await tools().execute('generate_digit_codes',{length:6,count:1});assert.equal(padded.codes?.[0].code,'000000');
 assert.equal((await tools().execute('generate_digit_codes',{length:1,count:11})).error,'insufficient_candidates');
 assert.equal((await tools().execute('generate_word_codes',{count:9})).error,'insufficient_candidates');
});
test('invalid ranges and unexpected arguments fail; canceled generation does not consume dictionary',async()=>{
 for(const args of [{count:0},{minLength:5,maxLength:2},{antiMin:100,antiMax:10},{excludeLetters:'A'},{count:null},{surprise:true}])await assert.rejects(tools().execute('generate_word_codes',args));
 await assert.rejects(tools().execute('generate_letter_codes',{alphabet:'123'}));
 const controller=new AbortController();controller.abort();await assert.rejects(tools().execute('generate_word_codes',{},controller.signal));
 for(const n of [1n,2n,10n,100000000000000000000n]){const value=secureBelow(n);assert.ok(value>=0n&&value<n);}
 assert.ok(wantsCodeGenerator('Сгенерируй слова с античитом'));
});
