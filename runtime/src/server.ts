import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { EncounterApiClient } from "./api-client.js";
import { loadProfile, readProfiles, resolveDataDir } from "./config.js";
import { OsCredentialStore } from "./credential-store.js";
import { EncounterOperations } from "./operations.js";
import { safeError } from "./redaction.js";
import { registerRecalculationTools } from './recalculation.js';
import { registerRoutingTool } from './routing.js';
import {createRuntimeApi,runtimeProfile,runtimeAuthoringPort} from './authoring-client.js';
import {resolveEngineProfile} from '../../src/engine-profile.ts';
import {legacyCredentialKey} from '../../src/node-legacy-session.ts';
import {captureAuthoringExport} from '../../src/authoring-export.ts';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {executeRuntimeOperation,operationInputs} from './operation-inputs.js';

import {registerImportPlanTools} from './import-plan-tools.js';
import {runtimePlanHost} from './import-plan-host.js';

const server = new McpServer({ name: "encounter-author", version: "0.0.1" });
registerRecalculationTools(server);
registerRoutingTool(server);
registerImportPlanTools(server,async profile=>runtimePlanHost(await operations(profile)),()=>join(resolveDataDir(),'import-plans'));
const profileField = z.string().min(1).optional().describe("Configured Encounter profile; defaults to the active profile");
const id = z.number().int().positive();

server.registerTool('encounter_export_snapshot',{
  description:'Capture source-bound raw JSON for migration preparation and save a private local artifact. Explicit partial coverage and observed reread consistency; never a full backup, server restore or migration. Unsupported important/poster drafts remain unapplied.',
  inputSchema:{gameId:id,profile:profileField,maxLevels:z.number().int().min(1).max(1000).optional(),draftPresentation:z.record(z.string(),z.unknown()).optional()},
},async({gameId,profile,maxLevels,draftPresentation})=>{
  try {
    const dataDir=resolveDataDir(),selected=await loadProfile(profile,dataDir),api=await runtimeAuthoringPort(selected,new OsCredentialStore(),gameId);
    const snapshot=await captureAuthoringExport(api,{maxLevels,draftPresentation}),reference=crypto.randomUUID(),directory=join(dataDir,'exports');
    await mkdir(directory,{recursive:true,mode:0o700});const snapshotFile=join(directory,reference+'.json');
    await writeFile(snapshotFile,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx',mode:0o600});
    return output({ok:true,reference,snapshotFile,binding:snapshot.binding,coverage:snapshot.coverage,migration:snapshot.migration});
  }catch(error){return failure(error);}
});
for(const [name,suffix] of [['encounter_file_references','files'],['encounter_scenario_export','scenario-export']] as const)server.registerTool(name,{
  description:name==='encounter_file_references'?'Read scoped legacy uploader links/storage-base metadata. Partial observed references, no authoritative empty inventory, resource bytes, upload or poster assignment.':'Read exact legacy scenario overview blocks. Partial readable export, never a full editor backup or automatic migration.',
  inputSchema:{gameId:id,profile:profileField},
},async({gameId,profile})=>{
  try {const selected=await loadProfile(profile,resolveDataDir());if(resolveEngineProfile(selected.domain).engine!=='legacy')throw new Error('Observed resource codec is legacy-only; no guessed modern endpoint');const api=await runtimeAuthoringPort(selected,new OsCredentialStore(),gameId),response=await api.request(`/admin/games/${gameId}/${suffix}`);if(!response.ok)throw new Error('Scoped reference read unavailable');return output({ok:true,value:await response.json()});}catch(error){return failure(error);}
});

function output(value: unknown) {
  const structured = value && typeof value === "object" ? (value as Record<string, unknown>) : { value };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

function failure(error: unknown) {
  const structured = { ok: false, error: safeError(error) };
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

async function operations(profileName?: string): Promise<EncounterOperations> {
  const dataDir = resolveDataDir();
  const profile = await loadProfile(profileName, dataDir);
  const credentials = new OsCredentialStore();
  const api = createRuntimeApi(profile, credentials);
  return new EncounterOperations(api, runtimeProfile(profile), dataDir);
}

server.registerTool(
  "encounter_profile_status",
  {
    title: "Encounter profile status",
    description: "Show selected engine and non-secret profile metadata, and whether its distinct OS-keyring credential exists. Never returns bearer tokens or cookies.",
    inputSchema: { profile: profileField },
  },
  async ({ profile }) => {
    try {
      const dataDir = resolveDataDir();
      const selected = await loadProfile(profile, dataDir);
      const engine=resolveEngineProfile(selected.domain).engine;
      const credentialPresent = Boolean(await new OsCredentialStore().get(engine==='legacy'?legacyCredentialKey(selected.name):selected.name));
      return output({ ok: true, profile: selected, engine, credentialKind:engine==='legacy'?'browser-cookie-session':'bearer',credentialPresent,...(engine==='modern'?{tokenPresent:credentialPresent}:{}),dataDir });
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "encounter_get_game",
  {
    title: "Get Encounter game",
    description: "Read the current author/admin representation of one Encounter game.",
    inputSchema: { gameId: id, profile: profileField },
  },
  async ({ gameId, profile }) => {
    try {
      return output({ ok: true, game: await (await operations(profile)).getGame(gameId) });
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "encounter_list_levels",
  {
    title: "List Encounter levels",
    description: "Read level IDs, numbers, titles, order, and dismissed state for a game.",
    inputSchema: { gameId: id, profile: profileField },
  },
  async ({ gameId, profile }) => {
    try {
      return output({ ok: true, levels: await (await operations(profile)).listLevels(gameId) });
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "encounter_get_level",
  {
    title: "Get Encounter level editor",
    description: "Read the selected engine editor payload with available completeness evidence. Legacy may expose a supported subset; absent collections are unknown, never proof of empty content.",
    inputSchema: { gameId: id, levelId: id, profile: profileField },
  },
  async ({ gameId, levelId, profile }) => {
    try {
      return output({ ok: true, level: await (await operations(profile)).getLevel(gameId, levelId) });
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "encounter_get_live_level_state",
  {
    title: "Get live Encounter level state",
    description: "Read current and passed player counts for a level number. Use immediately before every live-game write.",
    inputSchema: { gameId: id, levelNumber: z.number().int().nonnegative(), profile: profileField },
  },
  async ({ gameId, levelNumber, profile }) => {
    try {
      return output({ ok: true, live: await (await operations(profile)).getLiveLevelState(gameId, levelNumber) });
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "encounter_preview_target",
  {
    title: "Get Encounter preview target",
    description: "Return the configured web-engine target for browser preview. This does not claim that preview was opened or passed.",
    inputSchema: { gameId: id, levelId: id, profile: profileField },
  },
  async ({ gameId, levelId, profile }) => {
    try {
      return output({ ok: true, preview: await (await operations(profile)).previewTarget(gameId, levelId) });
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "encounter_update_task",
  {
    title: "Update Encounter task",
    description: "Update an EXISTING task using its observed task_id from read_level_content(resource=tasks). Never substitute ordinal 1 for an ID. Empty tasks require creation via write_level_content(resource=tasks), or create_level_from_plan for a new filled level. Verify by rereading. In live/unknown risk, confirmed=true requires user authorization.",
    inputSchema: {...operationInputs['update-task'].shape,profile:profileField},
  },
  async ({ profile, ...input }) => {
    try {
      return output({ ok: true, result: await (await operations(profile)).updateTask(input) });
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "encounter_update_hint",
  {
    title: "Update Encounter hint",
    description: "Change hint text and/or timeout, preserving other fields and verifying the write. Moving a hint means changing timeout only.",
    inputSchema: {
      gameId: id,
      levelId: id,
      helpId: id,
      helpText: z.string().optional(),
      timeout: z.number().int().nonnegative().optional(),
      confirmed: z.boolean().optional(),
      profile: profileField,
    },
  },
  async ({ profile, ...input }) => {
    try {
      return output({ ok: true, result: await (await operations(profile)).updateHint(input) });
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "encounter_add_answer_alias",
  {
    title: "Add Encounter answer alias",
    description: "Add a correct answer variant without replacing an existing code; preferred for live code corrections.",
    inputSchema: {...operationInputs['add-answer-alias'].shape,profile:profileField},
  },
  async ({ profile, ...input }) => {
    try {
      return output({ ok: true, result: await (await operations(profile)).addAnswerAlias(input) });
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "encounter_update_answer",
  {
    title: "Update Encounter answer",
    description: "Replace one existing answer and verify it. Prefer encounter_add_answer_alias for live code errors.",
    inputSchema: {...operationInputs['update-answer'].shape,profile:profileField},
  },
  async ({ profile, ...input }) => {
    try {
      return output({ ok: true, result: await (await operations(profile)).updateAnswer(input) });
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool('encounter_move_answer',{
  title:'Move legacy answer by delete then add',
  description:'Explicit compound legacy move on one level: delete the exact source answer first, then create its exact literal code and native recipient in the destination sector with a NEW ID. Requires confirmed=true for the whole fixed plan. Sequential and non-atomic: source can remain deleted if creation fails or is uncertain. Saves both inventories and durable step journal; never retries uncertain writes or silently reuses an existing alias.',
  inputSchema:{...operationInputs['move-answer'].shape,profile:profileField},
},async({profile,...input})=>{try{return output({ok:true,result:await(await operations(profile)).moveAnswer(input)});}catch(error){return failure(error);}});

server.registerTool(
  "encounter_post_message",
  {
    title: "Post Encounter organizer message",
    description: "Create and verify an organizer message, often safer than silently changing a task already shown to players.",
    inputSchema: {...operationInputs['post-message'].shape,profile:profileField},
  },
  async ({ profile, ...input }) => {
    try {
      return output({ ok: true, result: await (await operations(profile)).postMessage(input) });
    } catch (error) {
      return failure(error);
    }
  },
);

for(const [tool,name,title,description] of [
 ['encounter_read_level_content','read-level-content','Read legacy level content','Read exact tasks, sectors, bonuses (including creation template), bonus-create (membership and template only), hints (helps/penalty_helps), meta, autopass or completion and its version. Read before writing; absent editor collections do not mean empty.'],
 ['encounter_write_level_content','write-level-content','Write legacy level content','One confirmed, snapshotted, version-checked legacy write with adapter readback. tasks/sectors/bonuses/bonus-create/hints CREATE one entity; meta/autopass/completion UPDATE fields. Supply exact version from read_level_content. See installed mcp-runtime reference for field contracts. Unknown results require read-only reconciliation, never retry. confirmed=true is permitted for steps already authorized in the user import request.'],
 ['encounter_update_game_settings','update-game-settings','Update game settings','Apply an exact confirmed settings patch using the selected engine. Read current game/allowed fields first, preserve siblings and verify readback; snapshot saved before one write. Legacy values follow native editable field types; modern values follow AdminUpdateGameRequest.'],
 ['encounter_create_level','create-level','Create Encounter level','LOW-LEVEL: snapshot and create a BLANK level at the end, without name or task. For a requested filled legacy level use prepare_import_plan then create_level_from_plan and verify_import_plan. Modern supports one level per call; legacy count 1..20. Requires confirmed=true for the exact game/count. Content and position need separate reviewed operations.'],
 ['encounter_delete_level','delete-level','Delete Encounter level','Snapshot the exact level and remove it with all contents using a persistent ID. Requires confirmed=true after reviewing the game, ID and destructive impact. Never uses ordinal zero or deletes all levels.'],
 ['encounter_copy_level','copy-level','Copy Encounter level','Snapshot and invoke native same-game clone of the exact persistent source ID, count 1..20. Requires confirmed=true. Verifies new IDs/inventory; copied contents, recipients and global references require separate editor review. Unknown writes cannot be retried.'],
] as const)server.registerTool(tool,{title,description,inputSchema:{...operationInputs[name].shape,profile:profileField}},async({profile,...input}:Record<string,unknown>,extra:{signal:AbortSignal})=>{try{return output({ok:true,result:await executeRuntimeOperation(await operations(typeof profile==='string'?profile:undefined),name,input,extra.signal)});}catch(error){return failure(error);}});

server.registerTool(
  "encounter_dismiss_level",
  {
    title: "Dismiss Encounter level",
    description: "Snapshot and dismiss one level, preserving its contents and identity. Native dismissal refunds time spent as a bonus. Always requires confirmed=true after the user confirms the exact level and refund impact.",
    inputSchema: {...operationInputs['dismiss-level'].shape,profile:profileField},
  },
  async ({ profile, ...input }) => {
    try {
      return output({ ok: true, result: await (await operations(profile)).dismissLevel(input) });
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "encounter_restore_level",
  {
    title: "Restore Encounter level",
    description: "Snapshot and restore one dismissed level. Native restoration annuls the refund bonus from dismissal. Always requires confirmed=true after the user confirms the exact level and bonus impact.",
    inputSchema: {...operationInputs['restore-level'].shape,profile:profileField},
  },
  async ({ profile, ...input }) => {
    try {
      return output({ ok: true, result: await (await operations(profile)).restoreLevel(input) });
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "encounter_delete_sector",
  {
    title: "Delete Encounter sector",
    description: "Snapshot and delete one exact sector with linked answers. Native legacy requires explicit confirmed=true after reviewing the exact sector/code snapshot and unknown or observed player risk. Modern deletion remains blocked when players are present or live state is unknown.",
    inputSchema: {...operationInputs['delete-sector'].shape,profile:profileField},
  },
  async ({ profile, ...input }) => {
    try {
      return output({ ok: true, result: await (await operations(profile)).deleteSector(input) });
    } catch (error) {
      return failure(error);
    }
  },
);

async function main(): Promise<void> {
  // Read profiles once during startup so configuration errors appear before the first tool call only when the file is malformed.
  await readProfiles(resolveDataDir());
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify(safeError(error))}\n`);
  process.exitCode = 1;
});
