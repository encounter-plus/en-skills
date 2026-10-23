import test from "node:test";
import assert from "node:assert/strict";
import { EncounterApiClient } from "../src/api-client.js";
import { MemoryCredentialStore } from "../src/credential-store.js";

test("a rejected write is never automatically replayed after auth refresh", async () => {
  const credentials = new MemoryCredentialStore();
  await credentials.set("test", "synthetic-token");
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (url, options) => {
    requests.push(`${options?.method} ${url}`);
    return new Response("unauthorized", {status:401});
  };
  const api = new EncounterApiClient({name:"test",apiBaseUrl:"https://api.example.test",webBaseUrl:"https://web.example.test",domain:"game.example.test"}, "test", credentials, fetchImpl);
  await assert.rejects(api.request("POST", "/admin/games/1/levels/2/answers", {body:{answer_text:"001"}}));
  assert.equal(requests.length, 1);
});
