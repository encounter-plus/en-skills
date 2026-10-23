import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join, relative } from 'node:path';
import { collectSkillPackages } from './skill-packaging.mjs';
import { validateMarkdown } from './markdown-links.mjs';
async function files(dir) {
  const out=[];
  for(const item of await readdir(dir,{withFileTypes:true})) {
    if(item.isSymbolicLink())throw new Error('Symlink not allowed: '+dir);
    if(item.isDirectory())out.push(...await files(join(dir,item.name)));
    else out.push(join(dir,item.name));
  }
  return out;
}
export async function validateSkills(root) {
  root=resolve(root);
  const expected=await collectSkillPackages(root), urls=new Set();
  for(const folder of ['skills','knowledge']) for(const file of await files(join(root,folder))) {
    if(file.endsWith('.md')) for(const url of await validateMarkdown(file,root)) urls.add(url);
  }
  const included=new Set(expected.flatMap(p=>[...p.outputs.keys()].filter(k=>k.startsWith('references/')).map(k=>k.slice('references/'.length))));
  for(const file of await files(join(root,'knowledge'))) {
    if(file.endsWith('.md')&&!included.has(relative(join(root,'knowledge'),file).replaceAll('\\','/')))
      throw new Error('Unreachable knowledge: '+file);
  }
  let checked=0;
  for(const base of ['dist/skills','dist/codex/skills','dist/claude/skills']) {
    const dirs=(await readdir(join(root,base))).sort();
    if(JSON.stringify(dirs)!==JSON.stringify(expected.map(p=>p.name)))throw new Error('Packaged skills differ from source: '+base);
    for(const {name,outputs} of expected) {
      const dir=join(root,base,name), actual=await files(dir);
      const paths=actual.map(f=>relative(dir,f).replaceAll('\\','/')).sort();
      if(JSON.stringify(paths)!==JSON.stringify([...outputs.keys()].sort()))throw new Error('Stale package file set: '+dir);
      const entry=outputs.get('SKILL.md');
      const front=entry.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
      if(!front||!new RegExp('^name: '+name+'\\r?$','m').test(front[1]))throw new Error('Invalid name: '+name);
      const description=front[1].match(/^description: (.+)$/m)?.[1];
      if(!description||description.length>1024||entry.split('\n').length>500)throw new Error('Invalid metadata: '+name);
      for(const file of actual) {
        const content=await readFile(file,'utf8');
        if(content!==outputs.get(relative(dir,file).replaceAll('\\','/')))throw new Error('Stale package content: '+file);
        if(file.endsWith('.md'))await validateMarkdown(file,dir);
      }
      checked++;
    }
  }
  return {packages:checked,skills:expected.length,externalUrls:[...urls].sort()};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const result=await validateSkills(fileURLToPath(new URL('../',import.meta.url)));
  console.log(JSON.stringify(result,null,2));
  if(process.argv.includes('--external')) {
    // Network failures are observations, not proof that a source was deleted.
    for(const url of result.externalUrls) {
      try {
        const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
        await response.body?.cancel();
        console.log(JSON.stringify({url,status:response.status,finalUrl:response.url,accessible:response.ok}));
      } catch(error) { console.log(JSON.stringify({url,accessible:false,error:error.message})); }
    }
  }
}
