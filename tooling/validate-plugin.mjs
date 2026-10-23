import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = JSON.parse(await readFile(path.join(root, "plugin.json"), "utf8"));
const mcp = JSON.parse(await readFile(path.join(root, "mcp.json"), "utf8"));
const allowedPluginFields = new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
]);

assert.equal(plugin.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
assert.match(plugin.name, /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/);
assert.deepEqual(Object.keys(plugin).filter((key) => !allowedPluginFields.has(key)), []);
assert.equal(mcp.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
assert.deepEqual(Object.keys(mcp).sort(), ["$schema", "mcpServers"].sort());
assert.equal(mcp.mcpServers["encounter-author"].type, "stdio");
assert.equal(mcp.mcpServers["encounter-author"].command, "node");
assert.match(mcp.mcpServers["encounter-author"].args[0], /^\$\{PLUGIN_ROOT\}\//);

const skillRoot = path.join(root, "dist", "skills", "game-author");
const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
assert.match(skill, /^---\r?\nname: game-author\r?\n/);
assert.doesNotMatch(skill, /\[TODO:|TODO:/i);

const references = [...skill.matchAll(/\]\(((?:references|assets)\/[^)]+)\)/g)].map((match) => match[1]);
for (const reference of references) await access(path.join(skillRoot, decodeURIComponent(reference.split('#')[0])));

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(item)));
    else files.push(item);
  }
  return files;
}

for (const file of await walk(path.join(root, "dist", "skills"))) {
  const content = await readFile(file, "utf8");
  assert.doesNotMatch(content, /spa\.en\.cx/i, `${path.relative(root, file)} must not hard-code the development engine`);
  assert.doesNotMatch(content, /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, `${file} contains a JWT-like value`);
}

await access(path.join(root, "runtime", "dist", "server.mjs"));
await access(path.join(root, "runtime", "dist", "cli.mjs"));

const evalFile = await readFile(path.join(root, "evals", "encounter-game-author.jsonl"), "utf8");
const evals = evalFile.trim().split(/\r?\n/).map((line) => JSON.parse(line));
assert.ok(evals.length >= 8);
for (const scenario of evals) {
  assert.equal(typeof scenario.id, "string");
  assert.equal(typeof scenario.request, "string");
  assert.ok(Array.isArray(scenario.expected));
}

process.stdout.write(`Validated Agent Plugin ${plugin.name}@${plugin.version}: ${evals.length} eval scenarios\n`);
