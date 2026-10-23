import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {jsonPointerValue} from '../../src/json-inspection.ts';

export function mapSourceFields(root:unknown,fields:Record<string,unknown>,pointers:Record<string,string>){
 const result={...fields};
 for(const [key,pointer]of Object.entries(pointers)){
  if(!['task_text','bonus_name','bonus_text','help_text','new_answers'].includes(key)||Object.hasOwn(result,key))throw new Error('Unsupported or duplicate source field');
  const value=jsonPointerValue(root,pointer);
  if(key==='new_answers'){
   const values=typeof value==='string'?[value]:value;
   if(!Array.isArray(values)||!values.length||values.some(item=>typeof item!=='string'||!item))throw new Error('Source answers must be literal strings');
   result[key]=values;
  }else{if(typeof value!=='string')throw new Error('Source text must be a string');result[key]=value;}
 }
 return result;
}
export async function resolveHostSourceFields(fields:Record<string,unknown>,pointers:Record<string,string>){
 const file=process.env.ENCOUNTER_IMPORT_SOURCE,hash=process.env.ENCOUNTER_IMPORT_SOURCE_SHA256;
 if(!file||!hash)throw new Error('Host has not configured a pinned import source');
 const bytes=await readFile(file);
 if(bytes.length>10*1024*1024||createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('Pinned import source changed or exceeds limit');
 return mapSourceFields(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')),fields,pointers);
}
