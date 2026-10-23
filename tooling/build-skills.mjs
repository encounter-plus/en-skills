import { rm } from 'node:fs/promises';
import { buildSkills } from './skill-packaging.mjs';
import { buildAuthoringCatalog } from './authoring-catalog.mjs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
// Retired API artifacts must not survive incremental builds or npm packaging.
for (const name of ['google','google-auth','sheets-client']) {
  for (const extension of ['js','js.map','d.ts','d.ts.map']) await rm(new URL('../dist/'+name+'.'+extension,import.meta.url),{force:true});
}
const catalog = await buildAuthoringCatalog(root);
const names = await buildSkills(root);
console.log(`Built ${names.length} discovered skills, ${catalog.rules.length} rules from Markdown.`);
