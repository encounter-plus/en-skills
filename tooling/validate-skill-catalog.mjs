import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverSkills } from './skill-packaging.mjs';
import { validateMarkdown } from './markdown-links.mjs';

function section(text, marker) {
  const start = `<!-- ${marker}:start -->`, end = `<!-- ${marker}:end -->`;
  if (text.split(start).length !== 2 || text.split(end).length !== 2 || text.indexOf(end) < text.indexOf(start)) throw Error('Missing/duplicate catalog markers: ' + marker);
  return text.split(start)[1].split(end)[0];
}
function same(actual, expected, label) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) throw Error('Catalog mismatch: ' + label);
}
export async function validateCatalog(root) {
  root = resolve(root);
  const skills = await discoverSkills(root);
  const readme = section(await readFile(join(root, 'README.md'), 'utf8'), 'skill-catalog');
  const entries = [...readme.matchAll(/^\| \[([a-z0-9-]+)\]\(([^)]+)\)/gm)];
  same(entries.map(x => x[1]), skills, 'README');
  for (const [, name, link] of entries) if (![ `docs/skills/${name}.md`, `https://github.com/encounter-plus/en-skills/blob/HEAD/docs/skills/${name}.md` ].includes(link)) throw Error('Incorrect documentation link: ' + name);
  const router = section(await readFile(join(root, 'skills/game-author/SKILL.md'), 'utf8'), 'skill-routes');
  const routes = [...router.matchAll(/^\|[^\n|]+\| `([a-z0-9-]+)` \|/gm)].map(x => x[1]);
  same(routes, skills.filter(x => x !== 'game-author'), 'router');
  same((await readdir(join(root, 'docs/skills'))).filter(x => x.endsWith('.md')), skills.map(x => x + '.md'), 'docs');
  for (const name of skills) {
    const path = join(root, 'docs/skills', name + '.md'), text = await readFile(path, 'utf8');
    if (!text.includes(`](../../skills/${name}/SKILL.md)`)) throw Error('Missing source link: ' + name);
    await validateMarkdown(path, root);
  }
  return { skills: skills.length, routes: routes.length, docs: skills.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(await validateCatalog(fileURLToPath(new URL('../', import.meta.url)))));
