#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { EncounterClient } from './encounter.ts';
import { readRecalculationEvidence, requireData, type RecalculationEvidence } from './recalculation-evidence.ts';
import { calculateRecalculation, type RecalculationResult } from './recalculation.ts';
import { renderRecalculationReport, renderRecalculationCsv } from './recalculation-report.ts';
import { createCorrectionPlan, type CorrectionPlan } from './correction-plan.ts';
import { executeCorrectionPlan, verifyCorrectionPlan, verifyCorrectionStatistics, renderCorrectionOutcome } from './correction-executor.ts';
import { FileCorrectionHost } from './recalculation-store.ts';
import {resolveEngineProfile} from './engine-profile.ts';
import {createNodeLegacySession,parseLegacyCookieJar} from './node-legacy-session.ts';
import {createAuthoringApi} from './authoring-factory.ts';

const help = `en-recalculate — post-game monitoring and corrections
read --domain DOMAIN --game ID --level DB_ID --out evidence.json
calculate --evidence evidence.json --rules incident.json [--store PRIVATE_DIRECTORY] --out calculation.json
report --input calculation.json|plan.json [--format markdown|csv] --out table.md
propose --evidence evidence.json --rules incident.json [--store PRIVATE_DIRECTORY] --out plan.json
approve --plan plan.json --confirmed-table SHA256 --store PRIVATE_DIRECTORY
apply --plan plan.json --store PRIVATE_DIRECTORY [--out outcome.json]
verify --plan plan.json --store PRIVATE_DIRECTORY [--out outcome.json]

Modern token: ENCOUNTER_ACCESS_TOKEN. Legacy session: ENCOUNTER_LEGACY_SESSION_FILE.
Never pass secrets on the command line. Engine selection never falls back after authentication errors.
approve is a host action: run only after the human confirmed the displayed table.
The MCP tools cannot approve a plan. No writes before exact-table approval.
read/calculate/propose are read-only. Existing output files are never overwritten.
After partial/unknown writes: verify, read fresh evidence, create and confirm a new table; do not resend.
`;
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: Object.fromEntries(
    ['domain', 'game', 'level', 'out', 'input', 'evidence', 'rules', 'plan', 'store', 'confirmed-table', 'format'].map(key => [key, { type: 'string' as const }])) });
  if (!positionals.length || positionals[0] === 'help') { process.stdout.write(help); return; }
  requireData(positionals.length === 1, 'Expected one recalculation command');
  const command = positionals[0];
  const allowed: Record<string, string[]> = { read: ['domain', 'game', 'level', 'out'], calculate: ['evidence', 'rules', 'out', 'store'],
    report: ['input', 'out', 'format'], propose: ['evidence', 'rules', 'out', 'store'], approve: ['plan', 'confirmed-table', 'store'], apply: ['plan', 'store', 'out'], verify: ['plan', 'store', 'out'] };
  requireData(allowed[command], 'Unknown recalculation command');
  for (const key of Object.keys(values)) requireData(allowed[command].includes(key), 'Unexpected --' + key);
  const flag = (name: string) => { const value = values[name]; requireData(typeof value === 'string' && value.length > 0, 'Missing --' + name); return value; };
  const json = async (name: string) => JSON.parse(await readFile(flag(name), 'utf8'));
  const client = async(domain: string,gameId:string) => {
    if(resolveEngineProfile(domain).engine==='modern')return new EncounterClient({ domain, token: () => { requireData(process.env.ENCOUNTER_ACCESS_TOKEN, 'Missing ENCOUNTER_ACCESS_TOKEN'); return process.env.ENCOUNTER_ACCESS_TOKEN; } });
    const session=await createNodeLegacySession({domain,gameId:Number(gameId),persistentBinding:true,credential:async()=>{const path=process.env.ENCOUNTER_LEGACY_SESSION_FILE;requireData(path,'Set ENCOUNTER_LEGACY_SESSION_FILE to an explicitly authorized browser session export; bearer credentials cannot authenticate legacy');const bytes=await readFile(path);requireData(bytes.length<=128000,'Legacy session export exceeds host limit');return parseLegacyCookieJar(JSON.parse(bytes.toString('utf8')),domain);}});
    return new EncounterClient({domain,api:createAuthoringApi({domain,gameId:Number(gameId),sessionEpoch:session.binding.sessionEpoch,legacySession:session})});
  };
  let result: unknown, text = false;
  if (command === 'read') result = await readRecalculationEvidence(await client(flag('domain'),flag('game')), flag('domain'), flag('game'), flag('level'));
  else if (command === 'calculate' || command === 'propose') {
    const evidence = await json('evidence') as RecalculationEvidence, rules = await json('rules');
    if (values.store) rules.existingCorrectionIds = [...new Set([...(rules.existingCorrectionIds ?? []), ...await new FileCorrectionHost(values.store).incidentCorrectionIds(rules.id, evidence.scope, evidence.sessionKey)])];
    result = command === 'calculate' ? calculateRecalculation(evidence, rules) : await createCorrectionPlan(evidence, rules);
  } else if (command === 'report') {
    const input = await json('input') as RecalculationResult | CorrectionPlan;
    requireData(values.format === undefined || values.format === 'markdown' || values.format === 'csv', 'Choose markdown or csv');
    const calculation = 'calculation' in input ? input.calculation : input;
    result = values.format === 'csv' ? renderRecalculationCsv(calculation) : renderRecalculationReport(calculation); text = true;
  } else {
    const plan = await json('plan') as CorrectionPlan, host = new FileCorrectionHost(flag('store'));
    if (command === 'approve') { await host.approve(plan, flag('confirmed-table')); result = { planId: plan.id, approved: true, note: 'No game mutation performed' }; }
    else {
      if (command === 'apply') requireData(process.env.ENCOUNTER_WRITES_DISABLED !== '1', 'Encounter writes disabled');
      const api = await client(plan.scope.domain,plan.scope.gameId);
      const prior = await host.load(plan.id);
      if (command === 'verify') requireData(prior, 'No correction attempts to verify');
      const journal = command === 'apply' ? await executeCorrectionPlan(api, plan, host) : await verifyCorrectionPlan(api, plan, prior!);
      if (command === 'verify') await host.save(journal);
      result = { planId: plan.id, journal, report: renderCorrectionOutcome(plan, journal), statistics: await verifyCorrectionStatistics(api, plan) };
    }
  }
  const output = text ? String(result) : JSON.stringify(result, null, 2) + '\n';
  if (values.out) {
    for (const name of ['input', 'evidence', 'rules', 'plan']) if (values[name]) requireData(resolve(values.out) !== resolve(values[name]), 'Output must differ from inputs');
    await writeFile(values.out, output, { flag: 'wx', mode: 0o600 }); process.stdout.write(JSON.stringify({ written: resolve(values.out) }) + '\n');
  } else process.stdout.write(output);
}
main().catch(error => { process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : 'Recalculation failed' }) + '\n'); process.exitCode = 1; });
