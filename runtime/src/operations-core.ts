import {readGameSettings,validateGameSettingsPatch,checkGameSettingsBefore,gameSettingsRequest,verifyGameSettingsChange} from '../../src/game-settings.ts';
import {validateLevelOperation,readLevelOperationIndex,checkLevelOperation,requestLevelOperation,verifyLevelOperation,type LevelOperation} from '../../src/level-operation.ts';
import { enforceRisk, enforceLegacySectorDeletion } from "./policy.js";
import {legacyAnswerOperation,readLegacyMessageInventory,legacyMessageCreateRequest,verifyLegacyMessageCreate} from '../../src/legacy-operation-preparation.ts';
import {validateLegacyAnswerMoveArgs,readLegacyAnswerMoveState,prepareLegacyAnswerMove,executeLegacyAnswerMove,type LegacyAnswerMovePlan,type LegacyAnswerMoveJournalStore} from '../../src/legacy-operation-preparation.ts';
import {sameAuthoringBinding,type AuthoringApiPort,type AuthoringCapability} from '../../src/authoring-api.ts';
import { redactText, redactValue } from "./redaction.js";
import type {
  ApiLike,
  EncounterProfile,
  LiveContext,
  RiskDecision,
  RiskOperation,
} from "./types.js";

type JsonObject = Record<string, unknown>;

const TASK_FIELDS = [
  "task_text",
  "for_member_id",
] as const;
const HELP_FIELDS = [
  "help_text",
  "timeout",
  "is_penalty",
  "for_team_id",
  "for_user_id",
  "penalty_comment",
  "penalty_score",
  "penalty_time",
  "request_penalty_confirm",
] as const;
const ANSWER_FIELDS = [
  "answer_text",
  "sector_id",
  "for_team_id",
  "for_user_id",
  "score_award",
  "time_award",
] as const;

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as JsonObject;
}

function asArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item && typeof item === "object")) : [];
}

function findEntity(editor: JsonObject, collection: string, idField: string, id: number): JsonObject {
  const matches = asArray(editor[collection]).filter((item) => Number(item[idField]) === id);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${collection} item with ${idField}=${id}; found ${matches.length}`);
  }
  return matches[0];
}

function pick(source: JsonObject, fields: readonly string[]): JsonObject {
  return Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));
}

function mergeDefined(base: JsonObject, patch: JsonObject): JsonObject {
  const definedPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  return { ...base, ...definedPatch };
}

function levelNumber(editor: JsonObject): number {
  const level = asObject(editor.level, "editor.level");
  const number = Number(level.level_number);
  if (!Number.isInteger(number) || number < 0) throw new Error("editor.level.level_number is missing");
  return number;
}

function levelDismissed(editor: JsonObject): boolean | undefined {
  const level = asObject(editor.level, "editor.level");
  return typeof level.dismissed === "boolean" ? level.dismissed : undefined;
}

function previewUrl(profile: EncounterProfile, values: Record<string, number>): string {
  if (!profile.previewUrlTemplate) return profile.webBaseUrl;
  return profile.previewUrlTemplate
    .replaceAll("{gameId}", encodeURIComponent(String(values.gameId)))
    .replaceAll("{levelId}", encodeURIComponent(String(values.levelId)))
    .replaceAll("{levelNumber}", encodeURIComponent(String(values.levelNumber)));
}

export class EncounterOperations {
  constructor(
    readonly api: ApiLike,
    readonly profile: EncounterProfile,
    readonly host: { saveSnapshot(value: unknown): Promise<string>; writesEnabled(): boolean; resolveSourceFields?(fields:Record<string,unknown>,pointers:Record<string,string>):Promise<Record<string,unknown>>;createAnswerMoveJournal?(plan:LegacyAnswerMovePlan):Promise<LegacyAnswerMoveJournalStore&{reference:string}> },
  ) {}

  private async legacyPort(gameId:number,capability?:AuthoringCapability):Promise<AuthoringApiPort|undefined>{
    const metadata=await this.api.authoringMetadata?.(gameId);
    if(metadata?.binding.engine!=='legacy')return undefined;
    if(!capability||!metadata.capabilities[capability]?.available)throw new Error('Operation unavailable for legacy engine');
    return {metadata,invalidate(){},request:async(path,init={})=>Response.json(await this.api.request(init.method??'GET',path,{headers:Object.fromEntries(new Headers(init.headers)),...(init.body===undefined?{}:{body:JSON.parse(String(init.body))})}))};
  }

  async getGame(gameId: number): Promise<unknown> {
    return this.api.request("GET", `/admin/games/${gameId}`);
  }

  async listLevels(gameId: number): Promise<unknown> {
    return this.api.request("GET", `/admin/games/${gameId}/levels`);
  }

  async getLevel(gameId: number, levelId: number): Promise<JsonObject> {
    return asObject(
      await this.api.request("GET", `/admin/games/${gameId}/levels/${levelId}/editor`),
      "level editor response",
    );
  }

  async getLiveLevelState(gameId: number, requestedLevelNumber: number): Promise<LiveContext> {
    const checkedAt = new Date().toISOString();
    try {
      const raw = await this.api.request<JsonObject>(
        "GET",
        `/games/${gameId}/levels/${requestedLevelNumber}/live-statistics`,
      );
      if (typeof raw.is_live !== "boolean" || !Array.isArray(raw.current_players) || !Array.isArray(raw.passed_players)) {
        return {
          state: "unknown",
          currentCount: asArray(raw.current_players).length,
          passedCount: asArray(raw.passed_players).length,
          checkedAt,
          error: "live-statistics response is missing a valid is_live flag or player arrays",
          raw,
        };
      }
      return {
        state: raw.is_live ? "live" : "not-live",
        currentCount: asArray(raw.current_players).length,
        passedCount: asArray(raw.passed_players).length,
        checkedAt,
        raw,
      };
    } catch (error) {
      return {
        state: "unknown",
        currentCount: 0,
        passedCount: 0,
        checkedAt,
        error: redactText(error instanceof Error ? error.message : String(error)),
      };
    }
  }

  async previewTarget(gameId: number, levelId: number): Promise<unknown> {
    const editor = await this.getLevel(gameId, levelId);
    const number = levelNumber(editor);
    return {
      webBaseUrl: this.profile.webBaseUrl,
      previewUrl: previewUrl(this.profile, { gameId, levelId, levelNumber: number }),
      levelNumber: number,
      configuredTemplate: Boolean(this.profile.previewUrlTemplate),
      instruction: this.profile.previewUrlTemplate
        ? "Open previewUrl in a browser with the configured Encounter web session"
        : "Open webBaseUrl in a browser and navigate to this game and level; configure previewUrlTemplate for a direct link",
    };
  }

  async updateTask(input: {
    gameId: number;
    levelId: number;
    taskId: number;
    taskText?: string;
    replaceNlToBr?: boolean;
    forMemberId?: number;
    confirmed?: boolean;
  }): Promise<unknown> {
    this.ensureWritesEnabled();
    if(input.taskText===undefined&&input.forMemberId===undefined&&input.replaceNlToBr===undefined)throw new Error("Specify taskText, forMemberId or replaceNlToBr");
    const legacy=await this.legacyPort(input.gameId,'task-update');
    if(!legacy&&input.replaceNlToBr!==undefined)throw new Error('Use explicit HTML <br>; replaceNlToBr is not supported by the modern operation');
    const taskPath = `/admin/games/${input.gameId}/levels/${input.levelId}/tasks/${input.taskId}`;
    const readTask = () => legacy
      ? this.api.request<JsonObject>("GET", taskPath)
      : this.getLevel(input.gameId, input.levelId);
    const beforeEditor = await readTask();
    const before = findEntity(beforeEditor, "tasks", "task_id", input.taskId);
    const live = await this.getLiveLevelState(input.gameId, levelNumber(beforeEditor));
    const risk = enforceRisk("update-task", live, input.confirmed === true);
    const body = mergeDefined(pick(before, legacy&&input.taskText===undefined?TASK_FIELDS.filter(field=>field!=='task_text'):TASK_FIELDS), {
      task_text: input.taskText,
      for_member_id: input.forMemberId,
      ...(legacy&&input.replaceNlToBr!==undefined?{replace_nl_to_br:input.replaceNlToBr}:{}),
    });
    const revision = before._authoring_revision ?? (legacy ? beforeEditor.version : undefined);
    const response = await this.api.request(
      "PUT",
      taskPath,
      { body,...(typeof revision==='string'?{headers:{'X-Authoring-Expected-Revision':revision}}:{}) },
    );
    const afterEditor = await readTask();
    const after = findEntity(afterEditor, "tasks", "task_id", input.taskId);
    const expectedText=input.taskText===undefined?before.task_text:legacy?input.taskText.replace(/\r\n|\r/g,'\n'):input.taskText;
    this.verify(after.task_text === expectedText, "task_text was not preserved or updated as requested", { expected: expectedText, after });
    this.verify(after.for_member_id === (input.forMemberId ?? before.for_member_id), "task recipient was not preserved or updated as requested", { after });
    if(legacy&&input.replaceNlToBr!==undefined)this.verify(after.replace_nl_to_br===input.replaceNlToBr,'Task newline checkbox was not persisted',{after});
    return this.changeResult("update-task", before, after, live, risk, response);
  }

  async updateHint(input: {
    gameId: number;
    levelId: number;
    helpId: number;
    helpText?: string;
    timeout?: number;
    confirmed?: boolean;
  }): Promise<unknown> {
    this.ensureWritesEnabled();
    if (input.helpText === undefined && input.timeout === undefined) throw new Error("helpText or timeout is required");
    const legacy = await this.legacyPort(input.gameId,'hint-update');
    const hintPath = `/admin/games/${input.gameId}/levels/${input.levelId}/helps/${input.helpId}`;
    const beforeEditor = legacy ? undefined : await this.getLevel(input.gameId, input.levelId);
    const before = legacy ? asObject(await this.api.request("GET", hintPath), "hint response")
      : findEntity({...beforeEditor!,helps:[...asArray(beforeEditor!.helps),...asArray(beforeEditor!.penalty_helps)]}, "helps", "help_id", input.helpId);
    if (Number(before.help_id) !== input.helpId) throw new Error("Hint identity mismatch");
    const ordinal = legacy
      ? Number(findEntity(asObject(await this.listLevels(input.gameId), "level index"), "levels", "level_id", input.levelId).level_number)
      : levelNumber(beforeEditor!);
    if (!Number.isInteger(ordinal) || ordinal < 0) throw new Error("Level number is missing");
    const live = await this.getLiveLevelState(input.gameId, ordinal);
    const risk = enforceRisk("update-hint", live, input.confirmed === true);
    const body = mergeDefined(pick(before, HELP_FIELDS), {
      help_text: input.helpText,
      timeout: input.timeout,
    });
    const response = await this.api.request(
      "PUT",
      hintPath,
      { body,...(typeof before._authoring_revision==='string'?{headers:{'X-Authoring-Expected-Revision':before._authoring_revision}}:{}) },
    );
    const afterEditor = legacy ? undefined : await this.getLevel(input.gameId, input.levelId);
    const after = legacy ? asObject(await this.api.request("GET", hintPath), "hint response")
      : findEntity({...afterEditor!,helps:[...asArray(afterEditor!.helps),...asArray(afterEditor!.penalty_helps)]}, "helps", "help_id", input.helpId);
    if (Number(after.help_id) !== input.helpId) throw new Error("Hint identity mismatch");
    if (input.helpText !== undefined) this.verify(after.help_text === input.helpText, "help_text was not persisted", { after });
    if (input.timeout !== undefined) this.verify(Number(after.timeout) === input.timeout, "hint timeout was not persisted", { after });
    return this.changeResult("update-hint", before, after, live, risk, response);
  }

  async addAnswerAlias(input: {
    gameId: number;
    levelId: number;
    answerText: string;
    sectorId?: number;
    forTeamId?: number;
    forUserId?: number;
    forMemberId?: number;
  }): Promise<unknown> {
    this.ensureWritesEnabled();
    const legacy=await this.legacyPort(input.gameId,'answer-create');
    if(legacy&&(input.forTeamId!==undefined||input.forUserId!==undefined||!Number.isSafeInteger(input.sectorId)||Number(input.sectorId)<1))throw new Error('Legacy answer creation requires an explicit sector; use native forMemberId rather than user/team aliases');
    if(!legacy&&input.forMemberId!==undefined)throw new Error('Native forMemberId answer scope is legacy-only');
    const args={action:'create' as const,levelId:input.levelId,sectorId:input.sectorId,answerText:input.answerText,forMemberId:input.forMemberId};
    const inventory=legacy?await legacyAnswerOperation.read(legacy,args):undefined;
    if(inventory)legacyAnswerOperation.checkBefore(inventory,args);
    const beforeEditor = legacy ? {level:asArray(asObject(await this.listLevels(input.gameId), "level index").levels).find(row=>row.level_id===input.levelId)} : await this.getLevel(input.gameId, input.levelId);
    const existing = asArray(inventory?.answers??beforeEditor.answers).filter(
      (answer) =>
        answer.answer_text === input.answerText &&
        Number(answer.sector_id ?? 0) === Number(input.sectorId ?? 0) &&
        (legacy ? answer.for_member_id === (input.forMemberId ?? 0) :
        Number(answer.for_team_id ?? 0) === Number(input.forTeamId ?? 0) &&
        Number(answer.for_user_id ?? 0) === Number(input.forUserId ?? 0)),
    );
    const live = await this.getLiveLevelState(input.gameId, levelNumber(beforeEditor));
    const risk = enforceRisk("add-answer-alias", live, true);
    if (existing.length > 0) {
      return { operation: "add-answer-alias", changed: false, reason: "Alias already exists", alias: existing[0], live, risk };
    }
    const body = mergeDefined({}, {
      answer_text: input.answerText,
      sector_id: input.sectorId,
      for_team_id: input.forTeamId,
      for_user_id: input.forUserId,
    });
    const response = legacy&&inventory?await(await legacyAnswerOperation.request(legacy,args,inventory)).json():await this.api.request('POST',`/admin/games/${input.gameId}/levels/${input.levelId}/answers`,{body});
    const afterEditor = legacy?await legacyAnswerOperation.read(legacy,args):await this.getLevel(input.gameId,input.levelId);
    if(inventory)this.verify(legacyAnswerOperation.verify(inventory,afterEditor,args),'answer creation preservation failed',{after:afterEditor});
    const created = asArray(afterEditor.answers).filter(
      (answer) =>
        answer.answer_text === input.answerText &&
        Number(answer.sector_id ?? 0) === Number(input.sectorId ?? 0) &&
        (legacy ? answer.for_member_id === (input.forMemberId ?? 0) :
        Number(answer.for_team_id ?? 0) === Number(input.forTeamId ?? 0) &&
        Number(answer.for_user_id ?? 0) === Number(input.forUserId ?? 0)),
    );
    this.verify(created.length === 1, "answer alias was not uniquely present after write", { matches: created });
    return { operation: "add-answer-alias", changed: true, after: created[0], live, risk, response: redactValue(response) };
  }

  async updateAnswer(input: {
    gameId: number;
    levelId: number;
    answerId: number;
    answerText?: string;
    sectorId?: number;
    forMemberId?: number;
    confirmed?: boolean;
  }): Promise<unknown> {
    this.ensureWritesEnabled();
    if(input.answerText===undefined&&input.forMemberId===undefined)throw new Error('Specify answerText or forMemberId');
    const beforeEditor = await this.getLevel(input.gameId, input.levelId);
    const legacy=await this.legacyPort(input.gameId,'answer-update');
    if(legacy&&input.sectorId!==undefined)throw new Error('Legacy answer updates do not support sector changes');
    if(!legacy&&input.forMemberId!==undefined)throw new Error('Native forMemberId answer scope is legacy-only');
    const args={action:'update' as const,levelId:input.levelId,answerId:input.answerId,answerText:input.answerText,forMemberId:input.forMemberId};
    const inventory=legacy?await legacyAnswerOperation.read(legacy,args):undefined;
    if(inventory)legacyAnswerOperation.checkBefore(inventory,args);
    const before = findEntity(inventory??beforeEditor, "answers", "answer_id", input.answerId);
    const live = await this.getLiveLevelState(input.gameId, levelNumber(beforeEditor));
    const risk = enforceRisk("update-answer", live, input.confirmed === true);
    const body = mergeDefined(pick(before, ANSWER_FIELDS), {
      answer_text: input.answerText,
      sector_id: input.sectorId,
    });
    const response = legacy&&inventory?await(await legacyAnswerOperation.request(legacy,args,inventory)).json():await this.api.request('PUT',`/admin/games/${input.gameId}/levels/${input.levelId}/answers/${input.answerId}`,{body});
    const afterEditor=legacy?await legacyAnswerOperation.read(legacy,args):await this.getLevel(input.gameId,input.levelId);
    if(inventory)this.verify(legacyAnswerOperation.verify(inventory,afterEditor,args),'answer update preservation failed',{after:afterEditor});
    const after = findEntity(afterEditor,'answers','answer_id',input.answerId);
    this.verify(after.answer_text === (input.answerText??before.answer_text), "answer_text was not preserved or updated as requested", { after });
    if (input.sectorId !== undefined) this.verify(Number(after.sector_id) === input.sectorId, "sector_id was not persisted", { after });
    return this.changeResult("update-answer", before, after, live, risk, response);
  }

  async postMessage(input: {
    gameId: number;
    levelId: number;
    messageText: string;
    allLevels?: boolean;
    levelIds?: number[];
    replaceNlToBr?: boolean;
  }): Promise<unknown> {
    this.ensureWritesEnabled();
    if(input.levelIds!==undefined&&input.allLevels!==true)throw new Error("Explicit levelIds currently requires allLevels:true");
    const beforeEditor = await this.getLevel(input.gameId, input.levelId);
    const live = await this.getLiveLevelState(input.gameId, levelNumber(beforeEditor));
    const risk = enforceRisk("post-message", live, true);
    const legacy=await this.legacyPort(input.gameId,'message-update');
    if(!legacy&&input.levelIds!==undefined)throw new Error('Explicit levelIds message scope is legacy-only');
    const inventory=legacy?await readLegacyMessageInventory(legacy,input.levelId):undefined;
    const body = {
      message_text: input.messageText,
      all_levels: input.allLevels ?? false,
      level_ids: input.allLevels ? [] : [input.levelId],
      replace_nl_to_br: input.replaceNlToBr ?? true,
    };
    const response = legacy&&inventory?await(await legacy.request(`/admin/games/${input.gameId}/levels/${input.levelId}/messages`,legacyMessageCreateRequest(inventory,input))).json():await this.api.request('POST',`/admin/games/${input.gameId}/levels/${input.levelId}/messages`,{body});
    const afterEditor=legacy?await readLegacyMessageInventory(legacy,input.levelId):await this.getLevel(input.gameId,input.levelId);
    if(inventory)this.verify(verifyLegacyMessageCreate(inventory,afterEditor,input),'message preservation failed',{after:afterEditor});
    const matches = asArray(afterEditor.messages).filter((message) => message.message_text === (legacy?input.messageText.replace(/\r\n|\r/g,"\n"):input.messageText));
    this.verify(matches.length > 0, "message was not present after write", { messageText: input.messageText });
    return { operation: "post-message", changed: true, after: matches.at(-1), live, risk, response: redactValue(response) };
  }

  async moveAnswer(input:{gameId:number;levelId:number;answerId:number;sourceSectorId:number;destinationSectorId:number;confirmed?:boolean}):Promise<unknown>{
    this.ensureWritesEnabled();const args=validateLegacyAnswerMoveArgs({levelId:input.levelId,answerId:input.answerId,sourceSectorId:input.sourceSectorId,destinationSectorId:input.destinationSectorId});
    const legacy=await this.legacyPort(input.gameId,'answer-delete');if(!legacy)throw new Error('Explicit compound answer move is legacy-only');
    if(!this.host.createAnswerMoveJournal)throw new Error('Durable compound move journal unavailable');
    const before=await readLegacyAnswerMoveState(legacy,args),plan=await prepareLegacyAnswerMove(before),editor=await this.getLevel(input.gameId,input.levelId),live=await this.getLiveLevelState(input.gameId,levelNumber(editor));
    const risk=enforceRisk('move-answer',live,input.confirmed===true),snapshotPath=await this.writeSnapshot('move-answer',input.gameId,input.levelId,plan as unknown as JsonObject,live),store=await this.host.createAnswerMoveJournal(plan);
    const guarded:AuthoringApiPort={metadata:legacy.metadata,invalidate(){},request:async(path,init={})=>{
      if((init.method??'GET').toUpperCase()!=='GET'){
        try{this.ensureWritesEnabled();const current=await this.api.authoringMetadata?.(input.gameId);this.ensureWritesEnabled();if(!current||!sameAuthoringBinding(current.binding,plan.before.binding)||!current.capabilities['answer-delete']?.available||!current.capabilities['answer-create']?.available)throw new Error('Binding or capability changed');}
        catch(error){throw Object.assign(new Error(error instanceof Error?error.message:'Compound write permission changed'),{code:'move-dispatch-blocked'});}
      }
      try{return await legacy.request(path,init);}catch(error){
        const status=(error as {status?:unknown})?.status;
        if((init.method??'GET').toUpperCase()!=='GET'&&typeof status==='number'&&[400,401,403,404,405,409,422,428].includes(status)&&(error as {code?:unknown})?.code!=='unknown-after-dispatch')return new Response(null,{status});
        throw error;
      }
    }};
    const journal=await executeLegacyAnswerMove(guarded,plan,store);
    return {operation:'move-answer',changed:journal.sourceState==='absent'||journal.status==='complete'?true:['rejected','conflict'].includes(journal.status)?false:null,status:journal.status,oldAnswerId:args.answerId,newAnswerId:journal.create.newAnswerId,sourceDeleted:journal.sourceState==='unknown'?null:journal.sourceState==='absent',destinationCreated:journal.create.status==='verified'?true:['not-dispatched','rejected'].includes(journal.create.status)?false:null,snapshotPath,journalRef:store.reference,live,risk,journal,warnings:['delete-then-create-non-atomic','new-answer-id','no-automatic-retry-or-rollback',...(live.state==='unknown'?['current-player-state-unknown']:[])]};
  }

  async updateGameSettings(input:{gameId:number;fields:Record<string,unknown>;confirmed?:boolean}):Promise<unknown>{
    this.ensureWritesEnabled();if(!this.api.authoringPort)throw new Error('Engine-bound authoring port required');
    const api=await this.api.authoringPort(input.gameId),binding=api.metadata.binding;
    if(binding.gameId!==input.gameId||binding.domain!==this.profile.domain||!api.metadata.capabilities['game-settings-update']?.available)throw new Error('Game settings scope/capability unavailable');
    const fields=validateGameSettingsPatch(binding.engine,input.fields),before=await readGameSettings(api);checkGameSettingsBefore(binding.engine,before,fields);
    const live:LiveContext={state:'unknown',currentCount:0,passedCount:0,checkedAt:new Date().toISOString()},risk=enforceRisk('update-game-settings',live,input.confirmed===true);
    const snapshotPath=await this.writeSnapshot('update-game-settings',input.gameId,0,{binding,fields,before,dispatchIntent:'one-game-write-no-automatic-retry'},live);
    const permitted=async()=>{this.ensureWritesEnabled();const current=await this.api.authoringPort!(input.gameId);this.ensureWritesEnabled();if(!sameAuthoringBinding(binding,current.metadata.binding)||!current.metadata.capabilities['game-settings-update']?.available)throw new Error('Game settings binding/capability changed');};
    await permitted();if(JSON.stringify(await readGameSettings(api))!==JSON.stringify(before))return {operation:'update-game-settings',status:'conflict',changed:false,snapshotPath};
    await permitted();let dispatched=false;
    const guarded:AuthoringApiPort={metadata:api.metadata,invalidate:()=>api.invalidate(),request:async(path,init={})=>{if((init.method??'GET').toUpperCase()!=='GET'){await permitted();dispatched=true;}return api.request(path,init);}};
    try{
      const response=await gameSettingsRequest(guarded,fields,before);
      if(!response.ok)return {operation:'update-game-settings',status:[400,401,403,404,405,409,422,428].includes(response.status)?'rejected':'unknown',changed:[400,401,403,404,405,409,422,428].includes(response.status)?false:null,httpStatus:response.status,snapshotPath};
      await permitted();const after=await readGameSettings(api);await permitted();const verified=verifyGameSettingsChange(binding.engine,before,after,fields);
      return {operation:'update-game-settings',status:verified?'applied':'unknown',changed:verified?true:null,before,after,snapshotPath,risk,warnings:['no-server-cas','no-automatic-retry']};
    }catch(error){if(!dispatched)throw error;throw Object.assign(new Error('Game settings outcome unknown; reconcile read-only before another action'),{code:'unknown-after-dispatch',details:{snapshotPath,operation:'update-game-settings',gameId:input.gameId,noAutomaticRetry:true}});}
  }

  async createLevel(input:{gameId:number;count?:number;confirmed?:boolean}):Promise<unknown>{return this.structuralLevel('create-level',input.gameId,validateLevelOperation({action:'create',count:input.count??1}),input.confirmed===true);}
  async deleteLevel(input:{gameId:number;levelId:number;confirmed?:boolean}):Promise<unknown>{return this.structuralLevel('delete-level',input.gameId,validateLevelOperation({action:'delete',levelId:input.levelId}),input.confirmed===true);}
  async copyLevel(input:{gameId:number;levelId:number;count?:number;confirmed?:boolean}):Promise<unknown>{return this.structuralLevel('copy-level',input.gameId,validateLevelOperation({action:'copy',levelId:input.levelId,count:input.count??1}),input.confirmed===true);}
  private async structuralLevel(operation:'create-level'|'delete-level'|'copy-level',gameId:number,args:LevelOperation,confirmed:boolean):Promise<unknown>{
    this.ensureWritesEnabled();if(!Number.isSafeInteger(gameId)||gameId<1)throw new Error('Positive game ID required');
    if(!this.api.authoringPort)throw new Error('Bound authoring port unavailable');
    const api=await this.api.authoringPort(gameId),binding=api.metadata.binding,capability=args.action==='create'?'level-create':args.action==='copy'?'level-copy':'level-delete';
    if(binding.gameId!==gameId||binding.domain!==this.profile.domain||!api.metadata.capabilities[capability]?.available)throw new Error('Structural operation scope/capability unavailable');
    const before=await readLevelOperationIndex(api);checkLevelOperation(before,args,binding.engine);
    const source=before.levels.find(row=>row.level_id===args.levelId),live:LiveContext=source?await this.getLiveLevelState(gameId,source.level_number):{state:'unknown',currentCount:0,passedCount:0,checkedAt:new Date().toISOString()};
    const risk=enforceRisk(operation,live,confirmed),sourceEditor=args.action==='create'?undefined:await this.getLevel(gameId,args.levelId);
    const snapshotPath=await this.writeSnapshot(operation,gameId,args.levelId,{binding,args,index:before,...(sourceEditor?{sourceEditor}:{}),dispatchIntent:'one-native-operation-no-automatic-retry'},live);
    const permitted=async()=>{this.ensureWritesEnabled();const current=await this.api.authoringPort!(gameId);this.ensureWritesEnabled();if(!sameAuthoringBinding(binding,current.metadata.binding)||!current.metadata.capabilities[capability]?.available)throw new Error('Structural binding/capability changed');};
    await permitted();if((await readLevelOperationIndex(api)).version!==before.version)return {operation,status:'conflict',changed:false,snapshotPath,live,risk};
    let dispatched=false;const guarded:AuthoringApiPort={metadata:api.metadata,invalidate:()=>api.invalidate(),request:async(path,init={})=>{if((init.method??'GET').toUpperCase()!=='GET'){await permitted();dispatched=true;}return api.request(path,init);}};
    try{
      const response=await requestLevelOperation(guarded,args,before);
      if(!response.ok)return {operation,status:response.status===409?'conflict':[400,401,403,404,405,422,428].includes(response.status)?'rejected':'unknown',changed:[400,401,403,404,405,409,422,428].includes(response.status)?false:null,httpStatus:response.status,snapshotPath,live,risk,warnings:['no-automatic-retry']};
      const receipt=response.status===204?{}:await response.json();await permitted();const after=await readLevelOperationIndex(api);await permitted();
      const verified=verifyLevelOperation(before,after,args),created=after.levels.filter(row=>!before.levels.some(prior=>prior.level_id===row.level_id));
      return {operation,status:verified?'applied':'unknown',changed:verified?true:null,verification:{inventory:verified,content:args.action==='copy'?'native-copy-not-independently-verified':'not-applicable'},created,before,after,snapshotPath,live,risk,response:redactValue(receipt),warnings:['structural-no-server-cas','no-automatic-retry',...(args.action==='copy'?['native-copy-content-requires-review']:[])]};
    }catch(error){if(!dispatched)throw error;throw Object.assign(new Error('Structural level outcome is unknown; reconcile read-only before any new action'),{code:'unknown-after-dispatch',details:{snapshotPath,operation,gameId,levelId:args.levelId,noAutomaticRetry:true}});}
  }

  async dismissLevel(input: { gameId: number; levelId: number; confirmed?: boolean }): Promise<unknown> {
    return this.toggleLevel("dismiss-level", input.gameId, input.levelId, true, input.confirmed === true);
  }

  async restoreLevel(input: { gameId: number; levelId: number; confirmed?: boolean }): Promise<unknown> {
    return this.toggleLevel("restore-level", input.gameId, input.levelId, false, input.confirmed === true);
  }

  async deleteSector(input: { gameId: number; levelId: number; sectorId: number; confirmed?: boolean }): Promise<unknown> {
    this.ensureWritesEnabled();
    const beforeEditor = await this.getLevel(input.gameId, input.levelId);
    const legacy=await this.legacyPort(input.gameId,'sector-delete');
    const inventory=legacy?asObject(await this.api.request('GET',`/admin/games/${input.gameId}/levels/${input.levelId}/sectors`),'sector inventory'):undefined;
    if(inventory&&(inventory.game_id!==input.gameId||inventory.level_id!==input.levelId||typeof inventory.version!=='string'||!Array.isArray(inventory.sectors)||!Array.isArray(inventory.answers)||!Array.isArray(inventory.sector_proofs)))throw new Error('Exact sector/code inventory revision required');
    const before = findEntity(inventory??beforeEditor, "sectors", "sector_id", input.sectorId);
    const live = await this.getLiveLevelState(input.gameId, levelNumber(beforeEditor));
    const risk = legacy?enforceLegacySectorDeletion(live,input.confirmed===true):enforceRisk("delete-sector", live, input.confirmed === true);
    const snapshotPath = await this.writeSnapshot("delete-sector", input.gameId, input.levelId, inventory??beforeEditor, live);
    const response = await this.api.request(
      "DELETE",
      `/admin/games/${input.gameId}/levels/${input.levelId}/sectors/${input.sectorId}`,
      inventory?{headers:{'If-Match':String(inventory.version)}}:undefined,
    );
    const afterEditor = inventory?asObject(await this.api.request('GET',`/admin/games/${input.gameId}/levels/${input.levelId}/sectors`),'sector read-back'):await this.getLevel(input.gameId, input.levelId);
    const remains = asArray(afterEditor.sectors).some((sector) => Number(sector.sector_id) === input.sectorId);
    this.verify(!remains, "sector is still present after delete", { sectorId: input.sectorId });
    if(inventory){
      const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
      this.verify(afterEditor.game_id===input.gameId&&afterEditor.level_id===input.levelId&&same(asArray(inventory.sectors).filter(row=>row.sector_id!==input.sectorId),afterEditor.sectors)&&same(asArray(inventory.answers).filter(row=>row.sector_id!==input.sectorId),afterEditor.answers)&&same(asArray(inventory.sector_proofs).filter(row=>row.sector_id!==input.sectorId),afterEditor.sector_proofs),'Native sector deletion changed sibling sector/code inventory',{after:afterEditor});
    }
    return {
      operation: "delete-sector",
      changed: true,
      before,
      after: null,
      snapshotPath,
      live,
      risk,
      ...(legacy?{warnings:['native-sector-deletion-removes-linked-codes',...(live.state==='unknown'?['current-player-state-unknown']:[]) ]}:{}),
      response: redactValue(response),
    };
  }

  private async toggleLevel(
    operation: "dismiss-level" | "restore-level",
    gameId: number,
    levelId: number,
    expectedDismissed: boolean,
    confirmed: boolean,
  ): Promise<unknown> {
    this.ensureWritesEnabled();
    const legacy=await this.legacyPort(gameId,expectedDismissed?'level-dismiss':'level-restore');
    if(legacy){
      const before=asObject(await this.listLevels(gameId),'manager inventory'),action=expectedDismissed?'dismiss':'restore';
      const from=expectedDismissed?'not_dismissed_level_ids':'dismissed_level_ids',to=expectedDismissed?'dismissed_level_ids':'not_dismissed_level_ids';
      const valid=(index:JsonObject)=>index.game_id===gameId&&index.level_state_complete===true&&typeof index.version==='string'&&index.version.startsWith('legacy-observed:level-index-v1:')&&Array.isArray(index.levels)&&Array.isArray(index.not_dismissed_level_ids)&&Array.isArray(index.dismissed_level_ids);
      if(!valid(before)||!(before[from]as number[]).includes(levelId))throw new Error('Complete native source-state inventory required');
      const level=findEntity(before,'levels','level_id',levelId),live=await this.getLiveLevelState(gameId,Number(level.level_number));
      const risk=enforceRisk(operation,live,confirmed),snapshotPath=await this.writeSnapshot(operation,gameId,levelId,before,live);
      const response=await this.api.request('POST',`/admin/games/${gameId}/levels/${levelId}/${action}`,{headers:{'X-Authoring-Expected-Revision':String(before.version)}});
      const after=asObject(await this.listLevels(gameId),'manager read-back');
      this.verify(valid(after)&&JSON.stringify(before.levels)===JSON.stringify(after.levels)&&JSON.stringify((before[from]as number[]).filter(id=>id!==levelId))===JSON.stringify(after[from])&&JSON.stringify([...(before[to]as number[]),levelId].sort((a,b)=>a-b))===JSON.stringify(after[to]),'Native level state or sibling inventory was not preserved',{after});
      return {operation,changed:true,before,after,snapshotPath,live,risk,response:redactValue(response)};
    }
    const beforeEditor = await this.getLevel(gameId, levelId);
    const live = await this.getLiveLevelState(gameId, levelNumber(beforeEditor));
    const risk = enforceRisk(operation, live, confirmed);
    const snapshotPath = await this.writeSnapshot(operation, gameId, levelId, beforeEditor, live);
    const action = expectedDismissed ? "dismiss" : "restore";
    const response = await this.api.request("POST", `/admin/games/${gameId}/levels/${levelId}/${action}`);
    const afterEditor = await this.getLevel(gameId, levelId);
    this.verify(levelDismissed(afterEditor) === expectedDismissed, `level dismissed state was not ${expectedDismissed}`, {
      level: afterEditor.level,
    });
    return {
      operation,
      changed: true,
      before: beforeEditor.level,
      after: afterEditor.level,
      snapshotPath,
      live,
      risk,
      response: redactValue(response),
    };
  }

  private async writeSnapshot(
    operation: RiskOperation,
    gameId: number,
    levelId: number,
    editor: JsonObject,
    live: LiveContext,
  ): Promise<string> {
    return this.host.saveSnapshot({ version: 1, operation, gameId, levelId, capturedAt: new Date().toISOString(), editor, live });
  }

  private changeResult(
    operation: RiskOperation,
    before: JsonObject,
    after: JsonObject,
    live: LiveContext,
    risk: RiskDecision,
    response: unknown,
  ): unknown {
    return { operation, changed: true, before, after, live, risk, response: redactValue(response) };
  }

  private ensureWritesEnabled(): void {
    if (!this.host.writesEnabled()) {
      throw new Error("Writes are disabled by ENCOUNTER_WRITES_DISABLED=1");
    }
  }

  private verify(condition: boolean, message: string, details: unknown): asserts condition {
    if (!condition) {
      const error = new Error(message) as Error & { code: string; details: unknown };
      error.code = "POST_WRITE_VERIFICATION_FAILED";
      error.details = redactValue(details);
      throw error;
    }
  }
}
