export type CodeGeneratorToolDefinition = {type:'function';function:{name:string;description:string;parameters:Record<string,unknown>}};
const RU='абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
export const wantsCodeGenerator=(request:string)=>/генер|сгенер|случайн|античит|random|generat|anti.?cheat/i.test(request);
const integer=(minimum:number,maximum:number,description:string)=>({type:'integer',minimum,maximum,description});
const common={count:integer(1,100,'Number of unique results; default 10.')};
const anti={antiMin:integer(0,999999,'Inclusive anti-cheat minimum; default 10.'),antiMax:integer(0,999999,'Inclusive maximum; default 99. Set min=max for a fixed suffix.'),antiMode:{type:'string',enum:['random','sequential'],description:'Default random: independently sample suffixes, repeats allowed. Sequential: assign antiMin, antiMin+1, ... once each; count must fit the range.'},antiWidth:integer(1,6,'Minimum suffix width, default 2 (01..09). Use 1 for literal 1..24. Larger values are never truncated.')};
export const codeGeneratorDefinitions:CodeGeneratorToolDefinition[]=[
 {type:'function',function:{name:'generate_word_codes',description:'Generate unique Russian noun bases from the bundled CityProject nouns dictionary plus numeric anti-cheat. Local only. No forbidden letters by default; ё is distinct from е. Results are candidates for author review, not added to a game. Default length covers the full dictionary.',parameters:{type:'object',properties:{...common,...anti,minLength:integer(1,100,'Minimum number of letters, inclusive; default 1.'),maxLength:integer(1,100,'Maximum number of letters, inclusive; default 100.'),excludeLetters:{type:'string',maxLength:64,description:'Russian letters excluded anywhere in the word, case-insensitive; default empty. Example ЩЪ.'}},additionalProperties:false}}},
 {type:'function',function:{name:'generate_letter_codes',description:'Generate unique random letter sequences plus numeric anti-cheat, locally. Default alphabet is all 33 lowercase Russian letters, no readability exclusions. Length default 6. Optional alphabet may contain only Russian/Latin letters; case preserved.',parameters:{type:'object',properties:{...common,...anti,length:integer(1,32,'Number of letters before anti-cheat; default 6.'),alphabet:{type:'string',minLength:1,maxLength:128}},additionalProperties:false}}},
 {type:'function',function:{name:'generate_digit_codes',description:'Generate unique random digit strings locally. Exact length (default 6), leading zeros preserved. No extra anti-cheat suffix; never convert codes to numbers or add them to a game.',parameters:{type:'object',properties:{...common,length:integer(1,32,'Exact code length, including leading zeros; default 6.')},additionalProperties:false}}},
];
export function secureBelow(limit:bigint):bigint {
 if(limit<1n)throw Error('Invalid random range');if(limit===1n)return 0n;
 const bits=(limit-1n).toString(2).length,bytes=new Uint8Array(Math.ceil(bits/8));
 for(;;){crypto.getRandomValues(bytes);bytes[0]&=255>>>(bytes.length*8-bits);let value=0n;for(const byte of bytes)value=value*256n+BigInt(byte);if(value<limit)return value;}
}
function sample(total:bigint,count:number,random:(limit:bigint)=>bigint):bigint[]{
 if(BigInt(count)>total)throw Error(`Only ${total} unique bases available; reduce count or widen filters`);
 const moved=new Map<bigint,bigint>();const output:bigint[]=[];
 for(let i=0;i<count;i++){const remaining=total-BigInt(i);const index=random(remaining);if(index<0n||index>=remaining)throw Error('Invalid random source');output.push(moved.get(index)??index);const last=remaining-1n;moved.set(index,moved.get(last)??last);moved.delete(last);}
 return output;
}
function int(args:Record<string,unknown>,key:string,fallback:number,min:number,max:number){const value=args[key]??fallback;if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)throw Error(`Invalid ${key}`);return Number(value);}
export function createCodeGeneratorTools(load:()=>Promise<readonly string[]>=async()=>{throw Error('Dictionary loader required for word generation');},random:(limit:bigint)=>bigint=secureBelow){
 return {definitions:codeGeneratorDefinitions,async execute(name:string,args:Record<string,unknown>,signal?:AbortSignal){
  signal?.throwIfAborted();const definition=codeGeneratorDefinitions.find(d=>d.function.name===name);if(!definition)throw Error('Unknown generator');
  const allowed=Object.keys((definition.function.parameters as {properties:Record<string,unknown>}).properties);
  if(Object.keys(args).some(key=>!allowed.includes(key))||Object.values(args).some(value=>value===null))throw Error('Invalid generator arguments');
  const count=int(args,'count',10,1,100),digits=name==='generate_digit_codes',word=name==='generate_word_codes';
  const antiMin=digits?0:int(args,'antiMin',10,0,999999),antiMax=digits?0:int(args,'antiMax',99,0,999999);if(antiMin>antiMax)throw Error('antiMin exceeds antiMax');
  const antiMode=digits?'random':args.antiMode??'random',antiWidth=digits?2:int(args,'antiWidth',2,1,6);
  if(antiMode!=='random'&&antiMode!=='sequential')throw Error('Invalid antiMode');
  if(!digits&&antiMode==='sequential'&&count>antiMax-antiMin+1)throw Error('Sequential anti-cheat range is smaller than count');
  let bases:string[],settings:Record<string,unknown>;
  if(word){
   const minLength=int(args,'minLength',1,1,100),maxLength=int(args,'maxLength',100,1,100);if(minLength>maxLength)throw Error('minLength exceeds maxLength');
   const exclude=args.excludeLetters??'';if(typeof exclude!=='string'||exclude.length>64||!/^[а-яё]*$/iu.test(exclude))throw Error('excludeLetters must contain Russian letters only');
   const excluded=[...new Set(exclude.normalize('NFC').toLowerCase())];
   const dictionary=await load();signal?.throwIfAborted();
   const candidates=[...new Set(dictionary)].filter(value=>{const length=[...value].filter(c=>/[а-яё]/u.test(c)).length;return length>=minLength&&length<=maxLength&&!excluded.some(letter=>value.includes(letter));});
   if(candidates.length<count)return {error:'insufficient_candidates',available:candidates.length,requested:count,applied:false,note:'Reduce count or widen filters; constraints were not relaxed.'};
   bases=sample(BigInt(candidates.length),count,random).map(i=>candidates[Number(i)]);settings={minLength,maxLength,excludeLetters:excluded.join(''),eligibleWords:candidates.length,dictionary:'CityProject nouns/ru'};
  }else{
   const length=int(args,'length',6,1,32),raw=digits?'0123456789':args.alphabet??RU;
   if(typeof raw!=='string'||!raw||raw.length>128||!digits&&!/^[а-яёa-z]+$/iu.test(raw))throw Error('Invalid alphabet');
   const alphabet=[...new Set(raw.normalize('NFC'))],radix=BigInt(alphabet.length);
   if(radix**BigInt(length)<BigInt(count))return {error:'insufficient_candidates',available:String(radix**BigInt(length)),requested:count,applied:false,note:'Increase length/alphabet or reduce count.'};
   bases=sample(radix**BigInt(length),count,random).map(rank=>{let value='';for(let i=0;i<length;i++){value=alphabet[Number(rank%radix)]+value;rank/=radix;}return value;});settings={length,alphabet:alphabet.join('')};
  }
  const codes=bases.map((base,index)=>{const anti=digits?'':String(antiMin+(antiMode==='sequential'?index:Number(random(BigInt(antiMax-antiMin+1))))).padStart(antiWidth,'0');return {base,...(digits?{}:{antiCheat:anti}),code:base+anti};});
  const outputSettings:Record<string,unknown>={...settings,...(digits?{}:{antiMin,antiMax,antiMode,antiWidth})};
  signal?.throwIfAborted();return {kind:word?'word+anti-cheat':digits?'digits':'letters+anti-cheat',count,settings:outputSettings,codes,applied:false,notice:'Generated locally. Unique bases within this batch only; no game writes. Preserve exact strings and leading zeros; author should review dictionary words for suitability.'};
 }};
}
