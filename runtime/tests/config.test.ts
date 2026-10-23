import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadProfile, readProfiles, saveProfile, setActiveProfile } from "../src/config.js";

test("profiles persist only non-secret configuration", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "en-skills-config-"));
  await saveProfile(
    {
      name: "development",
      apiBaseUrl: "https://api.example.test/",
      webBaseUrl: "https://web.example.test/",
      domain: "game.example.test",
      username: "Author1",
    },
    { activate: true, dataDir },
  );

  const loaded = await loadProfile(undefined, dataDir);
  assert.equal(loaded.apiBaseUrl, "https://api.example.test");
  assert.equal(loaded.webBaseUrl, "https://web.example.test");
  assert.equal(loaded.username, "Author1");

  const raw = await readFile(path.join(dataDir, "profiles.json"), "utf8");
  assert.doesNotMatch(raw, /password|token|secret/i);
});

test("active profile can be switched explicitly", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "en-skills-config-"));
  for (const name of ["development", "production"]) {
    await saveProfile(
      {
        name,
        apiBaseUrl: "https://api.example.test",
        webBaseUrl: "https://web.example.test",
        domain: `${name}.example.test`,
      },
      { dataDir },
    );
  }
  await setActiveProfile("production", dataDir);
  assert.equal((await readProfiles(dataDir)).activeProfile, "production");
});

test("insecure remote API URLs are rejected", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "en-skills-config-"));
  await assert.rejects(
    saveProfile(
      {
        name: "bad",
        apiBaseUrl: "http://api.example.test",
        webBaseUrl: "https://web.example.test",
        domain: "game.example.test",
      },
      { dataDir },
    ),
    /HTTPS/,
  );
});


test('legacy preview templates permit only the exact scoped level query',async()=>{
 const {validateProfile}=await import('../src/config.js');
 const base={name:'legacy',domain:'fixture.en.cx',apiBaseUrl:'https://api.en.cx',webBaseUrl:'https://fixture.en.cx'};
 assert.equal(validateProfile({...base,previewUrlTemplate:'https://fixture.en.cx/admin/games/levels/preview/{gameId}?level={levelNumber}'}).previewUrlTemplate,'https://fixture.en.cx/admin/games/levels/preview/{gameId}?level={levelNumber}');
 for(const url of ['https://evil.test/admin/games/levels/preview/1?level=1','https://fixture.en.cx/admin/games/levels/preview/1?level=1&token=secret','https://user:password@fixture.en.cx/admin/games/levels/preview/1?level=1'])assert.throws(()=>validateProfile({...base,previewUrlTemplate:url}));
});
