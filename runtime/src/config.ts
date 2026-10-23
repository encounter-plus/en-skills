import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EncounterProfile, ProfilesFile } from "./types.js";

const PROFILE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const DOMAIN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d+)?$/i;

export function resolveDataDir(environment: NodeJS.ProcessEnv = process.env): string {
  const explicit =
    environment.ENCOUNTER_DATA_DIR ||
    environment.PLUGIN_DATA ||
    environment.CLAUDE_PLUGIN_DATA;
  if (explicit) return path.resolve(explicit);

  if (process.platform === "win32") {
    const root = environment.LOCALAPPDATA || environment.APPDATA;
    if (root) return path.join(root, "en-skills");
  }

  const configRoot = environment.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configRoot, "en-skills");
}

export function normalizeBaseUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute URL`);
  }

  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error(`${field} must use HTTPS; HTTP is allowed only for localhost`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${field} must not contain credentials, query, or fragment`);
  }
  return url.toString().replace(/\/$/, "");
}

export function validateProfile(input: EncounterProfile): EncounterProfile {
  if (!PROFILE_NAME.test(input.name)) throw new Error("Invalid profile name");
  if (!DOMAIN.test(input.domain)) throw new Error("domain must be a hostname without scheme or path");

  const profile: EncounterProfile = {
    name: input.name,
    apiBaseUrl: normalizeBaseUrl(input.apiBaseUrl, "apiBaseUrl"),
    webBaseUrl: normalizeBaseUrl(input.webBaseUrl, "webBaseUrl"),
    domain: input.domain.toLowerCase(),
  };

  if (input.previewUrlTemplate) {
    const templateProbe = input.previewUrlTemplate
      .replaceAll("{gameId}", "1")
      .replaceAll("{levelId}", "1")
      .replaceAll("{levelNumber}", "1");
    const preview=new URL(templateProbe);
    if(preview.search&&!(preview.protocol==='https:'&&preview.hostname===profile.domain&&/^\/admin\/games\/levels\/preview\/[1-9]\d*$/.test(preview.pathname)&&preview.searchParams.size===1&&/^(0|[1-9]\d*)$/.test(preview.searchParams.get('level')??'')))throw new Error('Only the exact legacy preview level query is supported');
    normalizeBaseUrl(preview.origin+preview.pathname, "previewUrlTemplate");
    if(preview.username||preview.password||preview.hash)throw new Error('previewUrlTemplate must not contain credentials or fragment');
    profile.previewUrlTemplate = input.previewUrlTemplate;
  }
  if (input.username) profile.username = input.username;
  return profile;
}

function emptyProfiles(): ProfilesFile {
  return { version: 1, profiles: {} };
}

export async function readProfiles(dataDir = resolveDataDir()): Promise<ProfilesFile> {
  try {
    const raw = await readFile(path.join(dataDir, "profiles.json"), "utf8");
    const parsed = JSON.parse(raw) as ProfilesFile;
    if (parsed.version !== 1 || typeof parsed.profiles !== "object" || parsed.profiles === null) {
      throw new Error("Unsupported profiles.json format");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyProfiles();
    throw error;
  }
}

export async function writeProfiles(file: ProfilesFile, dataDir = resolveDataDir()): Promise<void> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const destination = path.join(dataDir, "profiles.json");
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, destination);
  if (process.platform !== "win32") await chmod(destination, 0o600);
}

export async function saveProfile(
  profileInput: EncounterProfile,
  options: { activate?: boolean; dataDir?: string } = {},
): Promise<EncounterProfile> {
  const dataDir = options.dataDir ?? resolveDataDir();
  const profile = validateProfile(profileInput);
  const file = await readProfiles(dataDir);
  file.profiles[profile.name] = profile;
  if (options.activate || !file.activeProfile) file.activeProfile = profile.name;
  await writeProfiles(file, dataDir);
  return profile;
}

export async function setActiveProfile(name: string, dataDir = resolveDataDir()): Promise<void> {
  const file = await readProfiles(dataDir);
  if (!file.profiles[name]) throw new Error(`Profile '${name}' not found`);
  file.activeProfile = name;
  await writeProfiles(file, dataDir);
}

export async function loadProfile(name?: string, dataDir = resolveDataDir()): Promise<EncounterProfile> {
  const file = await readProfiles(dataDir);
  const selected = name ?? file.activeProfile;
  if (!selected) throw new Error("No active profile. Run encounter-agent profile set ... --activate");
  const profile = file.profiles[selected];
  if (!profile) throw new Error(`Profile '${selected}' not found`);
  return validateProfile(profile);
}
