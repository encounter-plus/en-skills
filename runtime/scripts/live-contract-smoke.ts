import {createRuntimeApi,runtimeProfile} from '../src/authoring-client.js';
import {resolveEngineProfile} from '../../src/engine-profile.ts';
import { loadProfile, resolveDataDir } from "../src/config.js";
import { OsCredentialStore } from "../src/credential-store.js";
import { EncounterOperations } from "../src/operations.js";
import { redactValue, safeError } from "../src/redaction.js";

function value(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveInteger(name: string): number {
  const parsed = Number(value(name));
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive integer`);
  return parsed;
}

async function main(): Promise<void> {
  const profileName = value("profile");
  const gameId = positiveInteger("game-id");
  const levelId = positiveInteger("level-id");
  const dataDir = resolveDataDir();
  const profile = await loadProfile(profileName, dataDir);
  const api = createRuntimeApi(profile,new OsCredentialStore());
  const operations = new EncounterOperations(api,runtimeProfile(profile),dataDir);
  const editor = await operations.getLevel(gameId, levelId);
  const level = editor.level as Record<string, unknown>;
  const levelNumber = Number(level.level_number);
  const live = await operations.getLiveLevelState(gameId, levelNumber);

  const report: Record<string, unknown> = {
    ok: true,
    mode: "read-only",
    engine:resolveEngineProfile(profile.domain).engine,
    completeness:editor.legacy_evidence??null,
    gameId,
    levelId,
    levelNumber,
    live,
    counts: {
      tasks: Array.isArray(editor.tasks) ? editor.tasks.length : null,
      helps: Array.isArray(editor.helps) ? editor.helps.length : null,
      answers: Array.isArray(editor.answers) ? editor.answers.length : null,
      sectors: Array.isArray(editor.sectors) ? editor.sectors.length : null,
    },
  };

  if (process.argv.includes("--allow-write")) {
    if (process.env.ENCOUNTER_LIVE_CONTRACT_ACK !== "TEST_GAME_ONLY") {
      throw new Error("Write smoke requires ENCOUNTER_LIVE_CONTRACT_ACK=TEST_GAME_ONLY");
    }
    const helpId = positiveInteger("help-id");
    const help = (editor.helps as Array<Record<string, unknown>> | undefined)?.find(
      (item) => Number(item.help_id) === helpId,
    );
    if (!help) throw new Error(`help_id=${helpId} not found`);
    const timeout = Number(help.timeout);
    if (!Number.isInteger(timeout) || timeout < 0) throw new Error("Selected hint has no valid timeout");
    report.mode = "same-value-write";
    report.writeResult = await operations.updateHint({
      gameId,
      levelId,
      helpId,
      timeout,
      confirmed: true,
    });
  }

  process.stdout.write(`${JSON.stringify(redactValue(report), null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: safeError(error) }, null, 2)}\n`);
  process.exitCode = 1;
});
