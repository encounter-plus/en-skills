import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
const skillsRoot = new URL('../dist/skills/', import.meta.url);
export const skillNames: readonly string[] = Object.freeze(readdirSync(skillsRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort());
export type SkillName = string;
/** Source and installed JS both load generated, self-contained dist/skills packages. */
export async function loadSkill(name: SkillName) {
  if (!skillNames.includes(name)) throw new Error('Unknown skill');
  const root = new URL(name + '/', skillsRoot);
  return { name, instructions: await readFile(new URL('SKILL.md', root), 'utf8'), root };
}
export async function loadSkillReference(name: SkillName, filename: string) {
  const { root } = await loadSkill(name);
  if (!/^(?:[a-z][a-z0-9-]*\/)*[a-z][a-z0-9-]*\.md$/.test(filename)) throw new Error('Invalid reference filename');
  return readFile(new URL('references/' + filename, root), 'utf8');
}
