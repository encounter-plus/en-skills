import { readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { discoverSkills, collectSkillPackages } from './skill-packaging.mjs';

export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const bundleFingerprint = packages => hash(packages.map(p => [p.name, [...p.outputs].sort(([a], [b]) => a.localeCompare(b))]));
export async function caseInput(root,c) {
  const fixtures=await Promise.all((c.artifacts??[]).map(async path=>({path,base64:(await readFile(resolve(root,path))).toString('base64')})));
  const input={schemaVersion:1,caseId:c.id,request:c.request,tools:c.tools,state:c.state??{},fixtures};
  if(c.availableSkills)input.availableSkills=c.availableSkills;
  return input;
}
export async function validateCases(root, catalog) {
  root = resolve(root);
  catalog ??= JSON.parse(await readFile(join(root, 'evals/cases.json'), 'utf8'));
  if (catalog.schemaVersion !== 2 || !Array.isArray(catalog.cases) || !catalog.cases.length) throw Error('Expected nonempty eval schemaVersion 2');
  const skills = await discoverSkills(root), ids = new Set();
  for (const c of catalog.cases) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.id) || ids.has(c.id)) throw Error('Invalid/duplicate case ID: ' + c.id);
    ids.add(c.id);
    if (!skills.includes(c.skill)) throw Error('Unknown skill: ' + c.skill);
    if (c.availableSkills !== undefined && (!Array.isArray(c.availableSkills) || c.availableSkills.some(name=>!skills.includes(name)))) throw Error('Unknown available skill');
    if (!['explicit', 'routing', 'dialogue'].includes(c.mode) || typeof c.request !== 'string' || !c.request.trim()) throw Error('Missing mode/request: ' + c.id);
    if (!['synthetic', 'incident'].includes(c.origin?.kind) || (c.origin.kind === 'incident' && !c.origin.source)) throw Error('Missing provenance: ' + c.id);
    if (!Array.isArray(c.checks) || !c.checks.length || c.checks.some(x => typeof x !== 'string' || !x.trim())) throw Error('Missing rubric: ' + c.id);
    if (!Array.isArray(c.tools) || c.tools.some(x => typeof x !== 'string')) throw Error('Missing tool context: ' + c.id);
    if (c.assertions !== undefined) {
      const a = c.assertions;
      if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).some(k => !['noMutations', 'requiredReferences', 'allowedAnswerStrings', 'selectedSkill'].includes(k))) throw Error('Unknown assertion');
      if (a.noMutations !== undefined && typeof a.noMutations !== 'boolean') throw Error('Invalid mutation assertion');
      for (const key of ['requiredReferences', 'allowedAnswerStrings']) if (a[key] !== undefined && (!Array.isArray(a[key]) || a[key].some(x => typeof x !== 'string'))) throw Error('Invalid assertion strings');
      if (a.selectedSkill !== undefined && !skills.includes(a.selectedSkill)) throw Error('Unknown assertion skill');
    }
    if (c.mode === 'dialogue' && (!Array.isArray(c.turns) || !c.turns.length || c.turns.some(t => typeof t.user !== 'string' || !t.user.trim()))) throw Error('Missing dialogue turns: ' + c.id);
    for (const artifact of c.artifacts ?? []) {
      if (typeof artifact !== 'string' || !artifact.startsWith('evals/fixtures/')) throw Error('Fixture path required');
      const base = await realpath(join(root, 'evals/fixtures'));
      const target = await realpath(resolve(root, artifact));
      const rel = relative(base, target);
      if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) throw Error('Fixture escapes directory');
      await readFile(target);
    }
  }
  return catalog;
}

export async function prepareCase(root, id, agentDir, evaluatorDir, bundleRoot = root, catalogOverride) {
  const catalog = await validateCases(root,catalogOverride), c = catalog.cases.find(x => x.id === id);
  if (!c) throw Error('Unknown case: ' + id);
  const a = resolve(agentDir), e = resolve(evaluatorDir);
  const nested = (x, y) => { const r = relative(x, y); return !r || (r !== '..' && !r.startsWith('../') && !r.startsWith('..\\') && !isAbsolute(r)); };
  if (nested(a, e) || nested(e, a)) throw Error('Agent and evaluator directories must be separate');
  const packages = await collectSkillPackages(resolve(bundleRoot));
  const bundleHash = bundleFingerprint(packages);
  const input = await caseInput(root,c);
  const inputHash = hash({ input, turns: c.turns ?? [] });
  const selected = c.mode === 'routing' ? packages : packages.filter(p => p.name === c.skill || c.availableSkills?.includes(p.name));
  if (![c.skill,...(c.availableSkills??[])].every(name=>packages.some(p=>p.name===name))) throw Error('Skill missing from bundle: ' + c.skill);
  await mkdir(a, { recursive: true }); await mkdir(e, { recursive: true });
  const realA = await realpath(a), realE = await realpath(e);
  if (nested(realA, realE) || nested(realE, realA)) throw Error('Agent and evaluator directories must be separate');
  // Exclusive writes refuse stale or mixed runs. Use fresh directories for each preparation.
  await writeFile(join(a, 'input.json'), JSON.stringify(input, null, 2) + '\n', { flag: 'wx' });
  for (const p of selected) for (const [name, content] of p.outputs) {
    const path = join(a, 'skills', p.name, name);
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, content, { flag: 'wx' });
  }
  const rubric = { schemaVersion: 1, caseId: id, mode: c.mode, expectedSkill: c.skill, turns: c.turns ?? [], checks: c.checks, assertions: c.assertions ?? {}, inputHash, bundleHash };
  await writeFile(join(e, 'rubric.json'), JSON.stringify(rubric, null, 2) + '\n', { flag: 'wx' });
  return { caseId: id, inputHash, bundleHash, agentDir: a, evaluatorDir: e };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const [command = 'validate', id, agentDir, evaluatorDir] = process.argv.slice(2);
  if (command === 'validate') console.log(JSON.stringify({ cases: (await validateCases(root)).cases.length }));
  else if (command === 'prepare' && id && agentDir && evaluatorDir) console.log(JSON.stringify(await prepareCase(root, id, agentDir, evaluatorDir)));
  else throw Error('Usage: eval-cases.mjs validate | prepare CASE AGENT_DIR EVALUATOR_DIR');
}
