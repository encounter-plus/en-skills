import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {compareResults} from './eval-results.mjs';
const [beforePath,afterPath,output]=process.argv.slice(2);
if(!beforePath||!afterPath||!output)throw Error('Usage: eval-report.mjs BEFORE.json AFTER.json REPORT.md');
const before=JSON.parse(await readFile(beforePath,'utf8')),after=JSON.parse(await readFile(afterPath,'utf8'));
const comparisons=compareResults(before,after);
for(const entries of [before,after])if(new Set(entries.map(x=>x.result.bundleHash)).size!==1)throw Error('Mixed suite bundle revisions');
const count=items=>['pass','fail','not-checked'].map(s=>items.filter(x=>x.status===s).length).join(' / ');
const metric=(entries,key)=>{const values=entries.map(x=>x.result[key]).filter(x=>x!==null);return values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):'—';};
const lines=['# A/B: результаты модельного прогона','',
  `Запусков: baseline **${before.length}**, candidate **${after.length}**. Условий: **${comparisons.length}**.`,
  `Сравнимых условий с минимум тремя повторами: **${comparisons.filter(x=>x.comparable&&x.repetitionsSufficient).length}**.`,
  `Bundle SHA-256: baseline \`${before[0].result.bundleHash}\`; candidate \`${after[0].result.bundleHash}\`.`,
  `Модель: \`${after[0].result.model}\`; host: \`${after[0].result.host}\`; tools: \`${after[0].result.toolset}\`.`,
  '', 'Порядок счётчиков: pass / fail / not-checked. not-checked не является успешной проверкой.', '',
  '| Метрика | Baseline | Candidate |','| --- | ---: | ---: |',
  `| Вердикты выполнений | ${count(comparisons.flatMap(x=>x.before))} | ${count(comparisons.flatMap(x=>x.after))} |`,
  `| Критерии | ${count(before.flatMap(x=>x.result.checks))} | ${count(after.flatMap(x=>x.result.checks))} |`,
  `| Средние input + output tokens за выполнение | ${metric(before,'tokens')} | ${metric(after,'tokens')} |`,
  `| Средняя длительность, мс (только известные значения) | ${metric(before,'durationMs')} | ${metric(after,'durationMs')} |`,
  '', 'Токены включают повторно переданный контекст всех модельных вызовов внутри выполнения; это не размер skill-файлов и не стоимость в деньгах. Длительность зависит от сети и повторов CLI.',
  '', '| Кейс | Baseline | Candidate | Сравним, ≥3 повтора |','| --- | --- | --- | --- |',
  ...comparisons.map(x=>`| ${x.condition[0]} | ${count(x.before)} | ${count(x.after)} | ${x.comparable&&x.repetitionsSufficient?'да':'нет'} |`),
  '', '## Критерии, отмеченные оценщиком как fail',''];
for(const [name,entries] of [['Baseline',before],['Candidate',after]]){
  lines.push(`### ${name}`,'');
  const failures=entries.flatMap(x=>x.result.checks.filter(c=>c.status==='fail').map(c=>`- ${x.result.runId}, критерий ${c.index}: ${c.evidence.replaceAll('\n',' ')}`));
  lines.push(...(failures.length?failures:['Нет.']),'');
}
lines.push('## Ограничения покрытия','',
  'Все случаи выполнены с локальным read-only shell без сервисных инструментов. Этот прогон не доказывает операции в движке, сохранение Google-документов или распознавание отсутствующих фото. Невыполнимые в данном окружении действия отмечаются not-checked. Обе стороны оцениваются по одинаковым критериям; исправления тестовых входов и критериев описаны в протоколе.',
  'Оценщик работает в отдельном контексте. Его оценки требуют просмотра человеком для спорных выводов; машинные assertions и исходный tool trace сохраняются отдельно.','');
const gaps=new Map();
for(const [side,entries] of [['before',before],['after',after]])for(const x of entries)for(const c of x.result.checks.filter(c=>c.status==='not-checked')){
  const key=x.result.caseId+':'+c.index;
  if(!gaps.has(key))gaps.set(key,{id:x.result.caseId,criterion:x.rubric.checks[c.index],before:0,after:0});
  gaps.get(key)[side]++;
}
lines.push('| Кейс | Непроверенный критерий | Baseline | Candidate |','| --- | --- | ---: | ---: |',
  ...[...gaps.values()].map(x=>`| ${x.id} | ${x.criterion.replaceAll('|',' / ')} | ${x.before} | ${x.after} |`),'');
await writeFile(resolve(output),lines.join('\n'));
