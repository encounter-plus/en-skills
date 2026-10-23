import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {validateCatalog}=await import(new URL('../tooling/validate-skill-catalog.mjs',import.meta.url).href);
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'skill-catalog-'));
  for(const name of ['game-author','demo']){
    await mkdir(join(root,'skills',name),{recursive:true});await mkdir(join(root,'docs/skills'),{recursive:true});
    await writeFile(join(root,'skills',name,'SKILL.md'),'Instruction');
    await writeFile(join(root,'docs/skills',name+'.md'),`[Source](../../skills/${name}/SKILL.md)`);
  }
  await writeFile(join(root,'README.md'),'<!-- skill-catalog:start -->\n| [game-author](docs/skills/game-author.md) | Router |\n| [demo](docs/skills/demo.md) | Demo |\n<!-- skill-catalog:end -->');
  await writeFile(join(root,'skills/game-author/SKILL.md'),'<!-- skill-routes:start -->\n| Situation | `demo` | Materials |\n<!-- skill-routes:end -->');
  return root;
}
test('catalog tracks discovered skills and catches missing, duplicate, stale and mislinked entries',async()=>{
  for(const change of ['missing','duplicate','stale','link']){
    const root=await fixture();assert.equal((await validateCatalog(root)).skills,2);
    const p=join(root,'README.md'),s=await readFile(p,'utf8');
    const row='| [demo](docs/skills/demo.md) | Demo |';
    await writeFile(p,s.replace(row,change==='missing'?'':change==='duplicate'?row+'\n'+row:change==='stale'?row.replace('[demo]','[retired]'):row.replace('docs/skills/demo.md','docs/skills/game-author.md')));
    await assert.rejects(validateCatalog(root));
  }
});
test('router and docs are independently checked, including broken document links',async()=>{
  const root=await fixture();await writeFile(join(root,'skills/game-author/SKILL.md'),'<!-- skill-routes:start -->\n<!-- skill-routes:end -->');
  await assert.rejects(validateCatalog(root),/router/);
  const other=await fixture();await writeFile(join(other,'docs/skills/demo.md'),'[Source](../../skills/demo/SKILL.md)\n[Missing](gone.md)');
  await assert.rejects(validateCatalog(other));
});
