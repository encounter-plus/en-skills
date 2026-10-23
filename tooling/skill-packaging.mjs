import { readFile, writeFile, readdir, mkdir, cp, rm, lstat } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { markdownLinks } from './markdown-links.mjs';

export async function discoverSkills(root) {
  const entries=await readdir(join(root,'skills'),{withFileTypes:true});
  const names=[];
  for(const entry of entries){
    if(entry.isSymbolicLink())throw new Error('Skill symlink not supported');
    if(!entry.isDirectory())continue;
    if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.name))throw new Error('Invalid skill directory');
    await readFile(join(root,'skills',entry.name,'SKILL.md'),'utf8');
    names.push(entry.name);
  }
  if(!names.length)throw new Error('No skills found');
  return names.sort();
}
export async function collectSkillPackages(root) {
  root=resolve(root);
  const names=await discoverSkills(root);
  const knowledge=join(root,'knowledge');
  // Build all documents in memory before replacing any generated package.
  const packages=[];
  for(const name of names){
    const dir=join(root,'skills',name);
    const outputs=new Map();
    const pending=[{path:join(dir,'SKILL.md'),output:'SKILL.md'}];
    while(pending.length){
      const item=pending.shift();if(outputs.has(item.output))continue;
      const original=await readFile(item.path,'utf8');
      const rewrites=[];
      for(const match of (item.path.endsWith('.md') ? markdownLinks(original) : [])){
        const [link,...fragment]=match.url.split('#');
        if(!link || /^https?:\/\//.test(link))continue;
        if(isAbsolute(link))throw new Error('Absolute reference not allowed');
        const target=resolve(dirname(item.path),decodeURIComponent(link));
        const rel=relative(knowledge,target);
        const resource=relative(dir,target).split(sep).join('/');
        const ownResource=/^(scripts|agents)\/[a-zA-Z0-9_./-]+\.(py|mjs|json|yaml)$/.test(resource) && !resource.split('/').includes('..');
        if(!ownResource && (rel.startsWith('..')||isAbsolute(rel)||!rel.endsWith('.md')))throw new Error('References must resolve to knowledge Markdown or local scripts/agents: '+link);
        for(let check=target;check!==root;check=dirname(check)){
          if((await lstat(check)).isSymbolicLink())throw new Error('Symlink reference not allowed');
        }
        const output=ownResource ? resource : 'references/'+rel.split(sep).join('/');
        pending.push({path:target,output});
        const rewritten=relative(dirname(item.output),output).split(sep).join('/')+(fragment.length?'#'+fragment.join('#'):'');
        rewrites.push({start:match.start,end:match.end,to:rewritten});
      }
      let text=original;for(const r of rewrites.reverse())text=text.slice(0,r.start)+r.to+text.slice(r.end);
      outputs.set(item.output,text);
    }
    async function resources(folder) {
      let entries;try{entries=await readdir(join(dir,folder),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
      for(const entry of entries){
        if(entry.isSymbolicLink())throw new Error('Skill resource symlink not supported');
        const output=folder+'/'+entry.name;
        if(entry.isDirectory())await resources(output);
        else {
          if(!/\.(py|mjs|json|yaml)$/.test(entry.name))throw new Error('Unsupported skill resource: '+output);
          outputs.set(output,await readFile(join(dir,output),'utf8'));
        }
      }
    }
    await resources('scripts');await resources('agents');
    packages.push({name,outputs});
  }
  return packages;
}
export async function buildSkills(root) {
  root=resolve(root);
  const packages=await collectSkillPackages(root);
  const names=packages.map(item=>item.name);
  for(const suffix of ['dist/skills','dist/codex/skills','dist/claude/skills']){
    const target=resolve(root,suffix);
    if(relative(root,target).split(sep).join('/')!==suffix)throw new Error('Invalid build destination');
    // Refuse junctions/symlinks before recursively removing a known generated directory.
    for(let check=target;check!==root;check=dirname(check)){
      try{if((await lstat(check)).isSymbolicLink())throw new Error('Build destination is a symlink');}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
    await rm(target,{recursive:true,force:true});
  }
  for(const {name,outputs} of packages){
    for(const [file,text] of outputs){
      const path=join(root,'dist/skills',name,file);await mkdir(dirname(path),{recursive:true});await writeFile(path,text);
    }
  }
  for(const host of ['codex','claude']){
    await mkdir(join(root,'dist',host),{recursive:true});
    await cp(join(root,'dist/skills'),join(root,'dist',host,'skills'),{recursive:true});
  }
  return names;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const root=process.argv[2];if(!root)throw new Error('Expected fixture/repository root');
  console.log(JSON.stringify(await buildSkills(root)));
}
