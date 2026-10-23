import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = await mkdtemp(path.join(os.tmpdir(), "en-skills-mcp-"));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(runtimeRoot, "dist", "server.mjs")],
  cwd: runtimeRoot,
  env: { ...process.env, ENCOUNTER_DATA_DIR: dataDir, ORS_API_KEY: '' },
  stderr: "pipe",
});
const client = new Client({ name: "en-skills-smoke", version: "0.1.0" });

try {
  await client.connect(transport);
  const result = await client.listTools();
  const names = new Set(result.tools.map((tool) => tool.name));
  for (const required of [
    "encounter_get_level",
    "encounter_read_level_content",
    "encounter_write_level_content",
    "encounter_get_live_level_state",
    "encounter_update_hint",
    "encounter_add_answer_alias",
    "encounter_move_answer",
    "encounter_dismiss_level",
    "encounter_delete_sector",
    "encounter_read_recalculation_evidence",
    "encounter_calculate_recalculation",
    "encounter_propose_corrections",
    "encounter_apply_corrections",
    "encounter_verify_corrections",
    "calculate_route",
    "encounter_export_snapshot",
    "encounter_file_references",
    "encounter_scenario_export",
  ]) {
    assert.ok(names.has(required), `Missing MCP tool: ${required}`);
  }
  assert.equal(result.tools.length, 36);
  for(const name of ['encounter_prepare_import_plan','encounter_create_level_from_plan','encounter_verify_import_plan'])assert.ok(names.has(name));
  for (const name of ['encounter_create_level','encounter_delete_level','encounter_copy_level','encounter_update_game_settings']) assert.ok(names.has(name), 'Missing MCP tool: '+name);
  for(const name of ['encounter_update_task','encounter_add_answer_alias','encounter_update_answer']){
    const schema=result.tools.find(tool=>tool.name===name).inputSchema;
    assert.equal(schema.properties.forMemberId.minimum,0,`${name} exposes native nonnegative recipient IDs`);
  }
  assert.ok(!result.tools.find(tool=>tool.name==='encounter_update_answer').inputSchema.required.includes('answerText'),'Recipient-only answer updates preserve the code');
  assert.ok(!result.tools.find(tool=>tool.name==='encounter_update_task').inputSchema.required.includes('taskText'),'Recipient-only task updates preserve literal source');
  assert.equal(result.tools.find(tool=>tool.name==='encounter_post_message').inputSchema.properties.levelIds.type,'array');
  const route = await client.callTool({ name: 'calculate_route', arguments: {
    origin: { latitude: 55.7558, longitude: 37.6173 },
    destination: { latitude: 55.817, longitude: 37.4416 }, mode: 'walking',
  } });
  assert.equal(route.isError, true);
  assert.equal(route.structuredContent.error, 'routing_key_required');
  assert.ok(!result.tools.some(tool => /approv/i.test(tool.name)), 'Model tools cannot approve a table');
  assert.ok(!JSON.stringify(result.tools.find(tool => tool.name === 'encounter_apply_corrections').inputSchema).includes('confirmed'));
  process.stdout.write(`MCP smoke passed: ${result.tools.length} tools\n`);
} finally {
  await client.close();
}
