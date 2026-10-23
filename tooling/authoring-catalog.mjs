import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function parseRuleMarkdown(markdown, source = 'Markdown') {
  const rules = [];
  let section = '', current = null;
  const finish = () => {
    if (current) {
      current.text = current.text.trimEnd();
      if (!current.text.trim()) throw new Error(source + ': empty rule ' + current.id);
      rules.push(current); current = null;
    }
  };
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('## ')) { finish(); section = line.slice(3).trim(); continue; }
    const match = /^- \*\*([A-Z][A-Z0-9-]*-\d+)\*\* — (.*?) <!-- scope: ([a-z, ]+) -->$/.exec(line);
    if (match) {
      finish();
      const scope = match[3].split(',').map(value => value.trim());
      if (!section || scope.some(value => !['all','field','virtual','mixed'].includes(value)) ||
          new Set(scope).size !== scope.length || (scope.includes('all') && scope.length > 1))
        throw new Error(source + ': invalid section/scope for ' + match[1]);
      current = { id: match[1], section, scope, text: match[2], kind: 'advisory' };
    } else if (/^- \*\*/.test(line)) {
      throw new Error(source + ': malformed rule or missing scope: ' + line);
    } else if (current) {
      if (line && !/^ {2}/.test(line)) throw new Error(source + ': indent continuation of ' + current.id);
      current.text += '\n' + line;
    }
  }
  finish();
  return rules;
}
export function catalogFromMarkdown(guide, marking) {
  const title = guide.match(/^# (.+)\r?$/m)?.[1];
  const end = guide.indexOf('<!-- checklist:introduction:end -->');
  if (!title || end < 0) throw new Error('Guide title/introduction marker missing');
  const introduction = guide.slice(guide.indexOf('\n') + 1, end).trim() + '\n';
  const rules = [...parseRuleMarkdown(guide, 'authoring-guide.md'), ...parseRuleMarkdown(marking, 'code-marking.md')];
  const ids = new Set();
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new Error('Duplicate rule ID: ' + rule.id);
    ids.add(rule.id);
  }
  if (!rules.length) throw new Error('Empty authoring checklist');
  return { schemaVersion: 1, title, introduction, rules };
}
export async function buildAuthoringCatalog(root) {
  const [guide, marking] = await Promise.all(['authoring-guide.md','code-marking.md'].map(file => readFile(join(root,'knowledge',file),'utf8')));
  const catalog = catalogFromMarkdown(guide, marking);
  await mkdir(join(root,'dist','knowledge'), { recursive: true });
  await writeFile(join(root,'dist','knowledge','authoring-rules.json'), JSON.stringify(catalog,null,2)+'\n');
  return catalog;
}
