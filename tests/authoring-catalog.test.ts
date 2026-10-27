import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const parser = new URL('../tooling/authoring-catalog.mjs',import.meta.url).href;
test('Markdown catalog parser preserves multiline tables and rejects lost metadata and duplicate IDs',()=>{
  const source = `
    import assert from 'node:assert/strict';
    import {parseRuleMarkdown,catalogFromMarkdown} from ${JSON.stringify(parser)};
    const guide='# Guide\\nIntro\\n<!-- checklist:introduction:end -->\\n## Rules\\n- **TEST-01** — Literal 0012 <!-- scope: all -->';
    const marking='## Marks\\n- **MARK-22** — Table <!-- scope: field -->\\n\\n  | A | B |\\n  |---|---|\\n  | ь | 6 |\\n';
    const c=catalogFromMarkdown(guide,marking);
    assert.equal(c.rules.length,2);
    assert.equal(c.rules[0].text,'Literal 0012');
    assert.deepEqual(c.rules[1].scope,['field']);
    assert.ok(c.rules[1].text.includes('\\n\\n  | A | B |'));
    assert.throws(()=>catalogFromMarkdown(guide,guide),/Duplicate/);
    assert.throws(()=>parseRuleMarkdown('## Rules\\n- **TEST-01** — missing metadata'),/scope/);
    assert.throws(()=>parseRuleMarkdown('## Rules\\n- **TEST-01** — Text <!-- scope: typo -->'),/scope/);
    assert.throws(()=>parseRuleMarkdown('## Rules\\n- **TEST-01** — Text <!-- scope: all -->\\nunindented'),/indent/);
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
test('built catalog retains 99 rules and the single MARK-02 table',()=>{
  const catalog=JSON.parse(readFileSync(fileURLToPath(new URL('../dist/knowledge/authoring-rules.json',import.meta.url)),'utf8'));
  assert.equal(catalog.rules.length,99);
  assert.equal(catalog.rules.filter((r:any)=>r.id.startsWith('MARK-')).length,19);
  assert.match(catalog.rules.find((r:any)=>r.id==='MARK-02').text,/\| S \/ 5 \|/);
});
