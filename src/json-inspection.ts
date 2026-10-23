export function jsonPointerValue(root:unknown,pointer:string):unknown {
 if(pointer!==''&&!pointer.startsWith('/'))throw new Error('Expected a JSON pointer beginning with /');
 let value:any=root;
 for(const raw of pointer===''?[]:pointer.slice(1).split('/')) {
  if(/~(?![01])/.test(raw))throw new Error('Invalid JSON pointer escape');
  const key=raw.replaceAll('~1','/').replaceAll('~0','~');
  if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))throw new Error('JSON pointer does not exist');
  value=value[key];
 }
 return value;
}
/** Bounded, lossless navigation of saved JSON without repeating remote reads. */
export function inspectJson(root:unknown,options:{pointer?:string;offset?:number;limit?:number}={}) {
 const pointer=options.pointer??'',offset=options.offset??0,limit=options.limit??10,maxChars=16000;
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>4000)throw new Error('Invalid inspection offset or limit (1..4000)');
 const value:any=jsonPointerValue(root,pointer);
 const child=(key:string)=>pointer+'/'+key.replaceAll('~','~0').replaceAll('/','~1');
 const describe=(item:any)=>({type:item===null?'null':Array.isArray(item)?'array':typeof item,...(typeof item==='string'?{length:item.length}:Array.isArray(item)?{length:item.length}:item&&typeof item==='object'?{keys:Object.keys(item).length}:{value:item})});
 if(typeof value==='string') {
  if(offset>value.length)throw new Error('Offset exceeds string length');
  // A string page is deliberately smaller than JSON output budget, including escapes.
  let end=Math.min(value.length,offset+Math.min(limit,2000));
  if(end<value.length&&end>offset&&/[\uD800-\uDBFF]/.test(value[end-1])&&/[\uDC00-\uDFFF]/.test(value[end]))end++;
  return {pointer,type:'string',offset,total:value.length,text:value.slice(offset,end),nextOffset:end,complete:end===value.length};
 }
 if(Array.isArray(value)) {
  if(offset>value.length)throw new Error('Offset exceeds array length');
  let end=Math.min(value.length,offset+Math.min(limit,100));
  while(end>offset&&JSON.stringify(value.slice(offset,end)).length>maxChars)end--;
  if(end===offset&&offset<value.length)return {pointer,type:'array',offset,total:value.length,oversized:true,nextPointer:child(String(offset)),complete:false};
  return {pointer,type:'array',offset,total:value.length,items:value.slice(offset,end),nextOffset:end,complete:end===value.length};
 }
 if(value!==null&&typeof value==='object') {
  const keys=Object.keys(value);
  if(offset>keys.length)throw new Error('Offset exceeds object length');
  let end=offset,entries:unknown[]=[];
  while(end<Math.min(keys.length,offset+Math.min(limit,100))) {
   const key=keys[end],entry={key,pointer:child(key),...describe(value[key])};
   if(JSON.stringify([...entries,entry]).length>maxChars)throw new Error('Object key exceeds inspection budget');
   entries.push(entry);end++;
  }
  return {pointer,type:'object',offset,total:keys.length,entries,nextOffset:end,complete:end===keys.length};
 }
 if(offset!==0)throw new Error('Scalar offset must be zero');
 return {pointer,type:value===null?'null':typeof value,value,complete:true};
}
