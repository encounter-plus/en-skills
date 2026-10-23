import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { buildSkills } = await import(new URL('../tooling/skill-packaging.mjs',import.meta.url).href);
const { validateSkills } = await import(new URL('../tooling/validate-skills.mjs',import.meta.url).href);
const { validateMarkdown, markdownLinks, markdownAnchors } = await import(new URL('../tooling/markdown-links.mjs',import.meta.url).href);
import { parseGame, comparePhotoCodes, applyLocalChanges } from '../src/core.ts';

async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'synthetic-skill-links-'));
  await mkdir(join(root,'skills/synthetic-skill'),{recursive:true});
  await mkdir(join(root,'knowledge'));
  await writeFile(join(root,'skills/synthetic-skill/SKILL.md'),'---\nname: synthetic-skill\ndescription: Synthetic fixture\n---\n[Guide](../../knowledge/guide.md#раздел)');
  await writeFile(join(root,'knowledge/guide.md'),'# Раздел\n[Same](#раздел)\n[More][detail]\n\n[detail]: details.md#part "Title"');
  await writeFile(join(root,'knowledge/details.md'),'# Part\nSynthetic text');
  return root;
}
test('links include reference definitions, titles and Unicode anchors but exclude fenced examples',()=>{
  const text='# Раздел\n# Раздел\n<a id="explicit"></a>\n[x](a.md#раздел "title")\n```md\n[x](missing.md)\n# Fake\n```\n';
  assert.deepEqual(markdownLinks(text).map((x:{url:string})=>x.url),['a.md#раздел']);
  assert.deepEqual([...markdownAnchors(text)],['explicit','раздел','раздел-1']);
});
test('packaging follows reference links and validates source freshness, missing assets and anchors',async()=>{
  const root=await fixture();
  await buildSkills(root);
  assert.equal((await validateSkills(root)).packages,3);
  assert.match(await readFile(join(root,'dist/skills/synthetic-skill/references/guide.md'),'utf8'),/details.md#part/);
  await writeFile(join(root,'knowledge/details.md'),'# Part\nChanged synthetic text');
  await assert.rejects(validateSkills(root),/Stale package content/);
  await buildSkills(root);
  await writeFile(join(root,'dist/claude/skills/synthetic-skill/extra.md'),'stale');
  await assert.rejects(validateSkills(root),/Stale package file set/);
  await buildSkills(root);
  await writeFile(join(root,'knowledge/guide.md'),'# Раздел\n[Missing](details.md#missing)');
  await assert.rejects(validateSkills(root),/Missing anchor/);
  await writeFile(join(root,'knowledge/guide.md'),'# Раздел\n`examples/game.json`');
  await assert.rejects(validateSkills(root),/Unlinked resource/);
  await writeFile(join(root,'knowledge/guide.md'),'# Раздел\n[Missing](absent.md)');
  await assert.rejects(validateSkills(root),/ENOENT/);
});
test('packaged links cannot escape their install directory',async()=>{
  const root=await fixture(),file=join(root,'knowledge/guide.md');
  await writeFile(file,'[Outside](../../outside.md)');
  await assert.rejects(validateMarkdown(file,root),/Nonportable/);
});
test('portable synthetic examples execute against the actual local data contracts',async()=>{
  const text=await readFile(new URL('../knowledge/local-data-contract.md',import.meta.url),'utf8');
  const [game,observations,plan]=[...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map(m=>JSON.parse(m[1]));
  assert.equal(parseGame(game).levels[0].sectors[0].answers[0],'synthetic-answer-001');
  assert.doesNotThrow(()=>comparePhotoCodes(game,observations));
  assert.equal(applyLocalChanges(game,plan).game.levels[0].task,plan.edits[0].after);
});
