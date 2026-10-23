// Assemble an auditable cohort; excluded diagnostic revisions remain on disk.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {caseInput,hash,validateCases} from './eval-cases.mjs';
import {parseTrace,zeroBasedChecks} from './eval-run-codex.mjs';
import {assessResult,compareResults} from './eval-results.mjs';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const config=await json(process.argv[2]);
const root=resolve(config.root??'.'),out=resolve(config.out);
const catalog=await validateCases(root),cohort={baseline:[],candidate:[]},sources=[];
async function rawFiles(dir){
  const result=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);
    if(entry.isDirectory())result.push(...await rawFiles(path));
    else if(entry.name==='trace.jsonl')result.push(path);
  }
  return result;
}
async function evaluationProof(base,side,id,rep,entry){
  for(const folder of await readdir(base,{withFileTypes:true})){
    if(!folder.isDirectory()||!folder.name.startsWith('judging-blind-v1-')||!entry.result.evaluator.endsWith(folder.name))continue;
    const dir=join(base,folder.name,side,id,String(rep));let judgment,review;
    try{judgment=await json(join(dir,'judgment.json'));review=await json(join(dir,'input/review.json'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
    const criteria=review.checks.map(c=>typeof c==='string'?c:c.criterion);
    if(JSON.stringify(criteria)!==JSON.stringify(entry.rubric.checks)||JSON.stringify(zeroBasedChecks(judgment.checks))!==JSON.stringify(entry.result.checks))continue;
    const observed=judgment.observations.filter(o=>['read-reference','select-skill'].includes(o.kind)).map(o=>o.kind==='select-skill'?{type:o.kind,skill:o.skill}:{type:o.kind,path:o.path});
    if(judgment.writeClaim!==entry.result.writeClaim||JSON.stringify(observed)!==JSON.stringify(entry.result.trace.events))continue;
    for(const path of await rawFiles(join(dir,'model'))){
      const bytes=await readFile(path);let parsed,answer;
      try{parsed=parseTrace(bytes.toString('utf8'));answer=JSON.parse(parsed.answer);}catch{continue;}
      if(parsed.complete&&hash(answer)===hash(judgment))return {directory:dir,path,sha256:createHash('sha256').update(bytes).digest('hex')};
    }
  }
  throw Error('No complete independent evaluation trace: '+side+'/'+id+'/'+rep);
}
for(const side of ['baseline','candidate'])for(const c of catalog.cases)for(let rep=1;rep<=3;rep++){
  const base=resolve(config[side+'Overrides']?.[c.id]??config[side]);
  const run=join(base,'runs',side,c.id,String(rep));
  const entry=await json(join(run,'result.json')),execution=await json(join(run,'execution.json'));
  const expected=hash({input:await caseInput(root,c),turns:c.turns??[]});
  if(entry.result.caseId!==c.id || entry.result.inputHash!==expected ||
    JSON.stringify(entry.rubric.checks)!==JSON.stringify(c.checks) ||
    JSON.stringify(entry.rubric.assertions)!==JSON.stringify(c.assertions??{}))throw Error('Cohort input/rubric mismatch: '+run);
  if(JSON.stringify(entry.result.dialogue)!==JSON.stringify(execution.dialogue))throw Error('Dialogue changed after judging: '+run);
  const raw=[];
  for(const trace of execution.traces){
    const target=hash(trace.events);let matched=false;
    for(const path of await rawFiles(join(run,'turn-'+trace.turn))){
      const bytes=await readFile(path);let parsed;
      try{parsed=parseTrace(bytes.toString('utf8'));}catch{continue;}
      if(parsed.complete && hash(parsed.events)===target){
        const sha256=createHash('sha256').update(bytes).digest('hex');
        raw.push({path,sha256});matched=true;break;
      }
    }
    if(!matched)throw Error('No complete original JSONL for turn: '+run+'/'+trace.turn);
  }
  if(execution.traces.length!==1+(c.turns?.length??0))throw Error('Missing dialogue turns: '+run);
  entry.result.tokens=execution.tokens;entry.result.durationMs=execution.durationMs;
  entry.result.trace.rawFiles=raw;
  const evaluation=await evaluationProof(base,side,c.id,rep,entry);
  entry.result.evaluationTrace=evaluation;
  assessResult(entry.result,entry.rubric);
  cohort[side].push(entry);sources.push({side,caseId:c.id,repetition:rep,run,raw,evaluation});
}
for(const side of ['baseline','candidate']){
  if(new Set(cohort[side].map(x=>x.result.bundleHash)).size!==1)throw Error('Mixed bundle revisions: '+side);
}
const comparison=compareResults(cohort.baseline,cohort.candidate);
if(comparison.length!==catalog.cases.length || comparison.some(c=>!c.comparable||!c.repetitionsSufficient))throw Error('Incomplete or incompatible comparison');
await mkdir(out,{recursive:true});
for(const [name,value] of Object.entries({before:cohort.baseline,after:cohort.candidate,comparison,sources})){
  await writeFile(join(out,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({cases:comparison.length,runs:cohort.baseline.length+cohort.candidate.length,out}));
