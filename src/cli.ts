#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { InputError, parseGame, auditGame, comparePhotoCodes, applyLocalChanges, suggestCodeVariants } from './core.ts';

import {buildChecklist} from './browser.ts';
import { remoteCommands, runRemoteCommand } from './remote-cli.ts';
import {inspectJson} from './json-inspection.ts';

const help = `en-author 0.3.0 — local checks and explicit remote adapters

node src/cli.ts validate --input game.json
node src/cli.ts audit --input game.json [--out audit.json]
node src/cli.ts checklist [--format field|virtual|mixed] [--out checklist.json]
node src/cli.ts photo-compare --input game.json --observations observations.json
node src/cli.ts code-variants --code конь6
node src/cli.ts apply-local --input game.json --plan plan.json --out revised.json
en-author inspect-json --input source.json [--pointer /parts] [--offset 0] [--limit 10]

en-author encounter-level --domain demo.en.cx --game ID --level ID [--out snapshot.json]
en-author encounter-game|encounter-levels --domain demo.en.cx --game ID
en-author encounter-export --domain DOMAIN --game ID [--input presentation-draft.json] --out preparation.json
en-author encounter-files|encounter-scenario --domain LEGACY_DOMAIN --game ID [--out references.json]
en-author google-public-all --url "GOOGLE_SHARING_LINK" [--out source.json] (whole document/workbook, no OAuth)
en-author google-public --url "GOOGLE_SHARING_LINK" [--out source.json] (selected sheet/tab only, no OAuth)
en-author route --input route.json [--out route-result.json] (free openrouteservice key: ORS_API_KEY)
Google Docs/Sheets editing: use the google-documents skill and the host browser, after user approval.
en-author ocr --input photo.jpg [--out evidence.json] (OPENAI_API_KEY + IMAGE_MODEL; optional Google fallback)
Tokens from environment; see knowledge/integrations.md. No server write command.

JSON stdout; errors JSON stderr. Exit 0 success, 1 validation/input failure,
2 audit has errors. Existing output files are never overwritten.
photo-compare compares supplied observations; it does NOT perform OCR.
apply-local supports task/answerFormat edits in a local draft, NOT server writes.
`;
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    url: { type: 'string' }, id: { type: 'string' }, range: { type: 'string' }, game: { type: 'string' }, level: { type: 'string' }, domain: { type: 'string' },
    input: { type: 'string' }, out: { type: 'string' }, plan: { type: 'string' },
    pointer: {type:'string'}, offset: {type:'string'}, limit: {type:'string'},
    observations: { type: 'string' }, format: { type: 'string' }, code: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help || !positionals.length) { process.stdout.write(help); return; }
  if (positionals.length !== 1) throw new InputError('Expected one command');
  const command = positionals[0];
  const allowed: Record<string, string[]> = {
    ...remoteCommands,
    validate: ['input', 'out'], audit: ['input', 'out'], checklist: ['format', 'out'],
    'photo-compare': ['input', 'observations', 'out'], 'apply-local': ['input', 'plan', 'out'],
    'code-variants': ['code', 'out'],
    'inspect-json': ['input','pointer','offset','limit','out'],
  };
  if (!(command in allowed)) throw new InputError(`Unknown command: ${command}`);
  for (const key of Object.keys(values)) if (!allowed[command].includes(key)) throw new InputError(`--${key} is not valid for ${command}`);
  const read = async (path: string | undefined, flag: string) => {
    if (!path) throw new InputError(`Missing --${flag}`);
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  };
  let output: unknown;
  if (command === 'inspect-json') {
    output=inspectJson(await read(values.input,'input'),{pointer:values.pointer,offset:values.offset===undefined?undefined:Number(values.offset),limit:values.limit===undefined?undefined:Number(values.limit)});
  } else if (command in remoteCommands) {
    output = await runRemoteCommand(command, values);
  } else if (command === 'code-variants') {
    output = suggestCodeVariants(values.code);
  } else if (command === 'checklist') {
    const format = values.format ?? 'mixed';
    if (!['field', 'virtual', 'mixed'].includes(format)) throw new InputError('Invalid --format');
    const catalog = JSON.parse(await readFile(new URL('../dist/knowledge/authoring-rules.json', import.meta.url), 'utf8')) as { rules: Array<{ scope: string[] }> };
    output = buildChecklist(catalog,format);
  } else {
    const game = await read(values.input, 'input');
    if (command === 'validate') { const parsed = parseGame(game); output = { valid: true, gameId: parsed.gameId, levels: parsed.levels.length }; }
    else if (command === 'audit') { const report = auditGame(game); output = report; if (report.findings.some(f => f.severity === 'error')) process.exitCode = 2; }
    else if (command === 'photo-compare') output = comparePhotoCodes(game, await read(values.observations, 'observations'));
    else {
      if (!values.out) throw new InputError('apply-local requires --out to a new file');
      output = applyLocalChanges(game, await read(values.plan, 'plan')).game;
    }
  }
  const json = JSON.stringify(output, null, 2) + '\n';
  if (values.out) {
    for (const source of [values.input, values.plan, values.observations]) if (source && resolve(source) === resolve(values.out)) throw new InputError('Output must differ from every input');
    await writeFile(values.out, json, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(JSON.stringify({ written: resolve(values.out) }) + '\n');
  } else process.stdout.write(json);
}
main().catch(error => { process.stderr.write(JSON.stringify({ error: error.name ?? 'Error', message: error.message }) + '\n'); process.exitCode = 1; });
