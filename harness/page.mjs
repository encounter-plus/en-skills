import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderScriptPage } from './render.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateSnapshotManifest } from './profiles.mjs';
export async function makePage(mode,author,fixture,snapshot,options={}) {
  const profile=mode==='enplus'?'modern-enplus-kotlin':mode;
  const manifest=validateSnapshotManifest(JSON.parse(await readFile(join(snapshot,'manifest.json'),'utf8')),profile);
  for(const name of manifest.outputs)if(createHash('sha256').update(await readFile(join(snapshot,name))).digest('hex')!==manifest.hashes[name])throw new Error('Snapshot asset hash mismatch: '+name);
  const renderer=await import(pathToFileURL(join(snapshot,'renderer.mjs')).href);
  return renderScriptPage(mode,author,fixture,renderer,{},options);
}
