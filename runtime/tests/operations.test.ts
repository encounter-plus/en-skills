import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EncounterOperations } from "../src/operations.js";
import { ConfirmationRequiredError, OperationDeniedError } from "../src/policy.js";
import type { ApiLike, ApiRequestOptions, EncounterProfile } from "../src/types.js";

class FakeApi implements ApiLike {
  readonly calls: Array<{ method: string; path: string; body?: unknown;headers?:Record<string,string> }> = [];
  editor: Record<string, unknown> = {
    level: { level_id: 20, level_number: 3, dismissed: false },
    tasks: [{ task_id: 30, task_text: "Старый текст", replace_nl_to_br: true, for_team_id: 7 }],
    helps: [{ help_id: 40, help_text: "Намёк", timeout: 900, is_penalty: false, penalty_time: 0 }],
    answers: [{ answer_id: 50, answer_text: "OLD", sector_id: 60, score_award: 0 }],
    sectors: [{ sector_id: 60, sector_name: "1" }],
    messages: [],
  };
  live: { is_live: boolean; current_players: Array<Record<string, unknown>>; passed_players: Array<Record<string, unknown>> } = {
    is_live: true,
    current_players: [],
    passed_players: [],
  };

  async request<T = unknown>(method: string, requestPath: string, options: ApiRequestOptions = {}): Promise<T> {
    this.calls.push({ method, path: requestPath, body: options.body,...(options.headers?{headers:options.headers}:{}) });
    if (method === "GET" && requestPath.endsWith("/editor")) return structuredClone(this.editor) as T;
    if (method === "GET" && requestPath.includes("live-statistics")) return structuredClone(this.live) as T;

    const body = options.body as Record<string, unknown> | undefined;
    if (method === "PUT" && requestPath.endsWith("/tasks/30")) Object.assign((this.editor.tasks as Record<string, unknown>[])[0], body);
    if (method === "PUT" && requestPath.endsWith("/helps/40")) Object.assign((this.editor.helps as Record<string, unknown>[])[0], body);
    if (method === "POST" && requestPath.endsWith("/answers")) {
      (this.editor.answers as Record<string, unknown>[]).push({ answer_id: 51, ...body });
    }
    if (method === "DELETE" && requestPath.endsWith("/sectors/60")) this.editor.sectors = [];
    return { ok: true } as T;
  }
}

const profile: EncounterProfile = {
  name: "test",
  apiBaseUrl: "https://api.example.test",
  webBaseUrl: "https://web.example.test",
  domain: "game.example.test",
};

async function fixture() {
  const api = new FakeApi();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "en-skills-ops-"));
  return { api, operations: new EncounterOperations(api, profile, dataDir) };
}

test("moving a hint preserves unmentioned DTO fields and rereads the editor", async () => {
  const { api, operations } = await fixture();
  const result = (await operations.updateHint({ gameId: 10, levelId: 20, helpId: 40, timeout: 1200 })) as Record<string, unknown>;
  const write = api.calls.find((call) => call.method === "PUT");
  assert.deepEqual(write?.body, {
    help_text: "Намёк",
    timeout: 1200,
    is_penalty: false,
    penalty_time: 0,
  });
  assert.equal((result.after as Record<string, unknown>).timeout, 1200);
  assert.equal(api.calls.filter((call) => call.path.endsWith("/editor")).length, 2);
});

test("task update in live play requires confirmation before PUT", async () => {
  const { api, operations } = await fixture();
  api.live.current_players = [{ team_id: 1 }];
  await assert.rejects(
    operations.updateTask({ gameId: 10, levelId: 20, taskId: 30, taskText: "Новый текст" }),
    ConfirmationRequiredError,
  );
  assert.equal(api.calls.some((call) => call.method === "PUT"), false);
});

test("answer alias is idempotent and does not replace the original code", async () => {
  const { api, operations } = await fixture();
  await operations.addAnswerAlias({ gameId: 10, levelId: 20, answerText: "NEW", sectorId: 60 });
  const answers = api.editor.answers as Record<string, unknown>[];
  assert.deepEqual(answers.map((answer) => answer.answer_text), ["OLD", "NEW"]);
  const callsBefore = api.calls.length;
  const second = (await operations.addAnswerAlias({ gameId: 10, levelId: 20, answerText: "NEW", sectorId: 60 })) as Record<string, unknown>;
  assert.equal(second.changed, false);
  assert.equal(api.calls.slice(callsBefore).some((call) => call.method === "POST"), false);
});

test("sector deletion fails closed while players are on the level", async () => {
  const { api, operations } = await fixture();
  api.live.current_players = [{ team_id: 1 }];
  await assert.rejects(
    operations.deleteSector({ gameId: 10, levelId: 20, sectorId: 60, confirmed: true }),
    OperationDeniedError,
  );
  assert.equal(api.calls.some((call) => call.method === "DELETE"), false);
});

test("incomplete player arrays remain unknown and prevent sector deletion", async () => {
  const { api, operations } = await fixture();
  // A truncated response must never be interpreted as zero players.
  Reflect.deleteProperty(api.live, "current_players");
  const state = await operations.getLiveLevelState(10, 3);
  assert.equal(state.state, "unknown");
  await assert.rejects(operations.deleteSector({gameId:10, levelId:20, sectorId:60, confirmed:true}), OperationDeniedError);
  assert.equal(api.calls.some(call => call.method === "DELETE"), false);
});

test("task updates retain recipient and omit newline and geocaching fields", async () => {
  const { api, operations } = await fixture();
  const task = (api.editor.tasks as Array<Record<string, unknown>>)[0];
  task.for_member_id = 77;
  task.latitude = 50;
  await operations.updateTask({gameId:10, levelId:20, taskId:30, taskText:"A<br>B"});
  assert.deepEqual(api.calls.find(call => call.method === "PUT")?.body, {task_text:"A<br>B", for_member_id:77});
});


test('observed entity revisions are passed unchanged to the selected adapter',async()=>{
 const api=new FakeApi(),directory=await mkdtemp(path.join(os.tmpdir(),'en-runtime-revisions-'));
 (api.editor.tasks as Record<string,unknown>[])[0]._authoring_revision='legacy-observed-task';
 (api.editor.helps as Record<string,unknown>[])[0]._authoring_revision='legacy-observed-hint';
 const operations=new EncounterOperations(api,profile,directory);
 await operations.updateTask({gameId:10,levelId:20,taskId:30,taskText:'New literal',confirmed:true});
 await operations.updateHint({gameId:10,levelId:20,helpId:40,helpText:'New hint',confirmed:true});
 assert.equal(api.calls.find(call=>call.method==='PUT'&&call.path.endsWith('/tasks/30'))?.headers?.['X-Authoring-Expected-Revision'],'legacy-observed-task');
 assert.equal(api.calls.find(call=>call.method==='PUT'&&call.path.endsWith('/helps/40'))?.headers?.['X-Authoring-Expected-Revision'],'legacy-observed-hint');
});
