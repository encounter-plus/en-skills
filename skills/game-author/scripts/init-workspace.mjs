import {readFile, writeFile, mkdir, readdir, lstat} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {randomUUID} from 'node:crypto';

async function rejectLinks(path) {
  for(let cursor=resolve(path);;cursor=dirname(cursor)) {
    try { if((await lstat(cursor)).isSymbolicLink()) throw new Error('Workspace path contains a symbolic link'); }
    catch(error) { if(error.code!=='ENOENT') throw error; }
    if(dirname(cursor)===cursor) break;
  }
}

export async function initializeWorkspace(directory, name) {
  if(typeof name!=='string'||!name.trim()||/[\r\n\x00-\x1f]/.test(name)||name.length>160) throw new Error('Invalid game name');
  const root=resolve(directory);
  const template=JSON.parse(await readFile(new URL('./workspace-template.json',import.meta.url),'utf8'));
  await rejectLinks(root);
  await mkdir(root,{recursive:true});
  const metadata=join(root,'.en-agent','project.json');
  await rejectLinks(metadata);
  let existing;
  try { existing=JSON.parse(await readFile(metadata,'utf8')); }
  catch(error) { if(error.code!=='ENOENT') throw error; }
  if(existing) {
    if(existing.templateVersion!==template.templateVersion||existing.schemaVersion!==1||typeof existing.id!=='string') throw new Error('Workspace migration required');
    return {root,created:false,project:existing};
  }
  if((await readdir(root)).length) throw new Error('Choose an empty folder or import the existing game explicitly');
  // A failed initial creation is left visible for inspection, never overwritten on retry.
  for(const folder of template.directories) await mkdir(join(root,folder));
  for(const [file,content] of Object.entries(template.files)) {
    await writeFile(join(root,file),content.replaceAll('{{GAME_NAME}}',()=>name.trim()),{flag:'wx'});
  }
  await mkdir(join(root,'.en-agent'));
  const project={schemaVersion:1,templateVersion:template.templateVersion,id:randomUUID(),name:name.trim()};
  await writeFile(metadata,JSON.stringify(project,null,2)+'\n',{flag:'wx'});
  return {root,created:true,project};
}
