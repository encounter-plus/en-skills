#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { EncounterApiClient } from "./api-client.js";
import {
  loadProfile,
  readProfiles,
  resolveDataDir,
  saveProfile,
  setActiveProfile,
} from "./config.js";
import { OsCredentialStore } from "./credential-store.js";
import {readFile} from 'node:fs/promises';
import {resolveEngineProfile} from '../../src/engine-profile.ts';
import {legacyCredentialKey,parseLegacyCookieJar} from '../../src/node-legacy-session.ts';
import {EncounterOperations} from './operations.js';
import {createRuntimeApi,runtimeProfile} from './authoring-client.js';
import {executeRuntimeOperation,operationInputs} from './operation-inputs.js';
import { safeError } from "./redaction.js";

type Options = Record<string, string | boolean>;

function parseOptions(args: string[]): { positional: string[]; options: Options } {
  const positional: string[] = [];
  const options: Options = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) options[key] = true;
    else {
      options[key] = next;
      index += 1;
    }
  }
  return { positional, options };
}

function stringOption(options: Options, key: string, required = false): string | undefined {
  const value = options[key];
  if (typeof value === "string") return value;
  if (required) throw new Error(`Missing --${key}`);
  return undefined;
}

async function promptVisible(label: string): Promise<string> {
  const reader = createInterface({ input: stdin, output: stdout });
  try {
    return (await reader.question(label)).trim();
  } finally {
    reader.close();
  }
}

async function promptHidden(label: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Interactive password input requires a TTY");
  }
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  let value = "";
  try {
    return await new Promise<string>((resolve, reject) => {
      const onData = (chunk: string) => {
        for (const character of chunk) {
          if (character === "\u0003") {
            stdin.off("data", onData);
            reject(new Error("Cancelled"));
            return;
          }
          if (character === "\r" || character === "\n") {
            stdin.off("data", onData);
            stdout.write("\n");
            resolve(value);
            return;
          }
          if (character === "\b" || character === "\u007f") {
            if (value.length > 0) {
              value = value.slice(0, -1);
              stdout.write("\b \b");
            }
            continue;
          }
          value += character;
          stdout.write("*");
        }
      };
      stdin.on("data", onData);
    });
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
  }
}

function jwtExpiry(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as { exp?: number };
    return payload.exp ? new Date(payload.exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

function print(value: unknown): void {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function help(): void {
  stdout.write(`Encounter author CLI\n\n`);
  stdout.write(`  encounter-agent profile set <name> --api-base-url <url> --web-base-url <url> --domain <host> [--preview-url-template <url>] [--activate]\n`);
  stdout.write(`  encounter-agent profile list\n`);
  stdout.write(`  encounter-agent profile use <name>\n`);
  stdout.write(`  encounter-agent profile show [name]\n`);
  stdout.write(`  encounter-agent auth login [--profile <name>]\n`);
  stdout.write(`  encounter-agent auth import-session --input <private-browser-storage-state.json> [--profile <name>]\n`);
  stdout.write(`  encounter-agent auth status [--profile <name>]\n`);
  stdout.write(`  encounter-agent auth logout [--profile <name>]\n`);
  stdout.write(`  encounter-agent operation <${Object.keys(operationInputs).join("|")}> --input <private-input.json> [--profile <name>]\n`);
  stdout.write(`  encounter-agent doctor [--profile <name>]\n`);
}

async function main(): Promise<void> {
  const { positional, options } = parseOptions(process.argv.slice(2));
  const [group, action, name] = positional;
  const dataDir = resolveDataDir();
  const credentials = new OsCredentialStore();

  if (!group || group === "help" || options.help) {
    help();
    return;
  }

  if (group === "profile" && action === "set") {
    if (!name) throw new Error("Profile name is required");
    const profile = await saveProfile(
      {
        name,
        apiBaseUrl: stringOption(options, "api-base-url", true) as string,
        webBaseUrl: stringOption(options, "web-base-url", true) as string,
        domain: stringOption(options, "domain", true) as string,
        previewUrlTemplate: stringOption(options, "preview-url-template"),
      },
      { activate: options.activate === true, dataDir },
    );
    print({ ok: true, profile, active: options.activate === true, dataDir });
    return;
  }

  if (group === "profile" && action === "list") {
    const file = await readProfiles(dataDir);
    print({ ok: true, activeProfile: file.activeProfile, profiles: Object.values(file.profiles), dataDir });
    return;
  }

  if (group === "profile" && action === "use") {
    if (!name) throw new Error("Profile name is required");
    await setActiveProfile(name, dataDir);
    print({ ok: true, activeProfile: name });
    return;
  }

  if (group === "profile" && action === "show") {
    print({ ok: true, profile: await loadProfile(name, dataDir), dataDir });
    return;
  }

  if (group === "auth") {
    const profileName = stringOption(options, "profile");
    const profile = await loadProfile(profileName, dataDir);
    const legacy=resolveEngineProfile(profile.domain).engine==='legacy';
    const credentialKey=legacy?legacyCredentialKey(profile.name):profile.name;
    if(action==='import-session') {
      if(!legacy)throw new Error('Cookie session import is only for a selected legacy profile');
      const input=stringOption(options,'input',true)!;
      const bytes=await readFile(input);if(bytes.length>128000)throw new Error('Browser session export exceeds host limit');
      let jar;try{jar=parseLegacyCookieJar(JSON.parse(bytes.toString('utf8')),profile.domain);}catch{throw new Error('Invalid authorized browser session file for this tenant');}
      await credentials.set(credentialKey,JSON.stringify({...jar,importId:crypto.randomUUID()}));
      print({ok:true,profile:profile.name,engine:'legacy',credentialKind:'browser-cookie-session',credentialPresent:true,credentialBackend:credentials.backend(),note:'Stored in the OS credential store. Source file is not copied into profiles or logs. No game request was sent.'});return;
    }
    if (action === "login") {
      if(legacy)throw new Error('Legacy uses an explicitly authorized browser session: encounter-agent auth import-session --input private-browser-storage-state.json. Password login is not exposed to model tools.');
      const login = await promptVisible(`Login for ${profile.domain}: `);
      let password = await promptHidden("Password: ");
      try {
        const api = new EncounterApiClient(profile, profile.name, credentials);
        await api.login(login, password);
        await saveProfile({ ...profile, username: login }, { dataDir });
        print({ ok: true, profile: profile.name, login, credentialBackend: credentials.backend() });
      } finally {
        // Drop the last reference as soon as the request completes. JavaScript cannot guarantee memory zeroing.
        password = "";
      }
      return;
    }
    if (action === "status") {
      const token = await credentials.get(credentialKey);
      print({
        ok: true,
        profile: profile.name,
        login: profile.username,
        engine:legacy?'legacy':'modern',
        credentialKind:legacy?'browser-cookie-session':'bearer',
        credentialPresent:Boolean(token),
        ...(legacy?{}:{tokenPresent:Boolean(token),tokenExpiresAt:jwtExpiry(token)}),
        credentialBackend: credentials.backend(),
      });
      return;
    }
    if (action === "logout") {
      await credentials.delete(credentialKey);
      print({ok:true,profile:profile.name,credentialPresent:false,...(legacy?{}:{tokenPresent:false})});
      return;
    }
  }

  if(group==='operation'){
    if(!action||!Object.hasOwn(operationInputs,action))throw new Error('Unsupported authoring operation');
    const inputFile=stringOption(options,'input',true)!;
    const input=JSON.parse(await readFile(inputFile,'utf8'));
    // Validate before loading credentials or constructing a network-capable client.
    operationInputs[action as keyof typeof operationInputs].parse(input);
    const profile=await loadProfile(stringOption(options,'profile'),dataDir);
    const operations=new EncounterOperations(createRuntimeApi(profile,credentials),runtimeProfile(profile),dataDir);
    print({ok:true,result:await executeRuntimeOperation(operations,action,input)});return;
  }

  if (group === "doctor") {
    const profileName = stringOption(options, "profile");
    const profile = await loadProfile(profileName, dataDir);
    const legacy=resolveEngineProfile(profile.domain).engine==='legacy';
    const token = await credentials.get(legacy?legacyCredentialKey(profile.name):profile.name);
    print({
      ok: true,
      engine:legacy?'legacy':'modern',
      credentialKind:legacy?'browser-cookie-session':'bearer',
      node: process.version,
      dataDir,
      profile,
      credentialBackend: credentials.backend(),
      credentialPresent:Boolean(token),
      ...(legacy?{}:{tokenPresent:Boolean(token)}),
      writesDisabled: process.env.ENCOUNTER_WRITES_DISABLED === "1",
    });
    return;
  }

  help();
  throw new Error("Unknown command");
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: safeError(error) }, null, 2)}\n`);
  process.exitCode = 1;
});
