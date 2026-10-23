import type { EncounterClient } from './encounter.ts';
import {resolveEngineProfile} from './engine-profile.ts';
import {legacyLocalTime,type LegacyStatistics} from './legacy-statistics.ts';
import type {LegacyAnswerEvent} from './legacy-observations.ts';

export function requireData(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function record(value: unknown): Record<string, unknown> {
  requireData(value && typeof value === 'object' && !Array.isArray(value), 'Expected evidence object');
  return value as Record<string, unknown>;
}
export function integer(value: unknown, min = 0): number {
  requireData(Number.isSafeInteger(value) && Number(value) >= min, 'Expected safe integer'); return Number(value);
}
export function timestamp(value: unknown): number {
  requireData(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value), 'Timestamp needs ISO date and explicit timezone');
  const result = Date.parse(value); requireData(Number.isSafeInteger(result), 'Invalid timestamp');
  const zone = /([+-])(\d\d):(\d\d)$/.exec(value);
  const offset = zone ? (Number(zone[2]) * 60 + Number(zone[3])) * 60_000 * (zone[1] === '+' ? 1 : -1) : 0;
  requireData(new Date(result + offset).toISOString().slice(0, 19) === value.slice(0, 19), 'Invalid calendar timestamp');
  return result;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  requireData(value !== undefined && (typeof value !== 'number' || Number.isFinite(value)), 'Non-JSON evidence');
  return JSON.stringify(value);
}
export async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export interface Participant {
  key: string; id: number; gamePlayerId: number; label: string; eligible: boolean; enteredAt: string | null;
}
export interface LevelTime { key: string; startMs: number; endMs: number; rawSeconds: number; passType: number }
export interface AnswerEvent {
  tab: 0 | 1; actionId: number; key: string; answer: string; at: number; correct: boolean | null;
  sectorId: number | null; bonusId: number | null;
}
export interface RecalculationEvidence {
  schemaVersion: 1; scope: { domain: string; gameId: string; levelId: string; levelNumber: number };
  sessionKey: string; capturedAt: string; complete: true; finished: boolean; mode: 'team' | 'user';
  canWrite: boolean; levelVersion: string; participants: Participant[]; times: LevelTime[]; events: AnswerEvent[];
  legacy?: {eventIdentity:'snapshot-local-index';timezoneOffsetMinutes:number;finalTotals:unknown;atomic:false};
  raw: { editor: Record<string, unknown>; statistics: Record<string, unknown>[]; gameStatistics: Record<string, unknown>[];
    main: Record<string, unknown>[]; bonus: Record<string, unknown>[]; players: Record<string, unknown>[]; corrections: Record<string, unknown> };
}
async function pages(read: (page: number) => Promise<Record<string, unknown>>, collection: string, pageField: string, scope: (body: Record<string, unknown>) => void) {
  const result: Record<string, unknown>[] = []; let count = 0, total = 0, expectedRows: number | undefined;
  for (let page = 1; ; page++) {
    const body = await read(page); scope(body);
    requireData(integer(body[pageField], 1) === page, 'Page number mismatch');
    const limit = integer(body.total_pages, 1); requireData(limit <= 1000, 'Too many pages');
    if (page === 1) { total = limit; if (body.total_rows !== undefined) expectedRows = integer(body.total_rows); }
    requireData(total === limit && (expectedRows === undefined || body.total_rows === expectedRows), 'Pagination changed during read');
    requireData(Array.isArray(body[collection]), 'Missing page collection');
    count += body[collection].length; requireData(count <= 200_000, 'Evidence exceeds event limit');
    result.push(body);
    if (page === total) break;
  }
  requireData(expectedRows === undefined || count === expectedRows, 'Incomplete paginated evidence');
  return result;
}
/** Read through the SDK, retain complete raw JSON and normalize only proven fields. */
export async function readRecalculationEvidence(client: EncounterClient, domain: string, gameId: string, levelId: string, signal?: AbortSignal): Promise<RecalculationEvidence> {
  requireData(client.domain === domain, 'Evidence tenant mismatch');
  if(resolveEngineProfile(domain).engine==='legacy')return readLegacyRecalculationEvidence(client,domain,gameId,levelId,signal);
  const sessionKey = await client.identity();
  const editor = (await client.level(gameId, levelId)).data;
  let byteBudget = 0;
  const checkGame = (body: Record<string, unknown>) => { requireData(body.game_id === Number(gameId), 'Evidence game mismatch');
    byteBudget += new TextEncoder().encode(JSON.stringify(body)).length; requireData(byteBudget <= 64 * 1024 * 1024, 'Evidence exceeds 64 MiB'); };
  checkGame(editor);
  const level = record(editor.level); requireData(level.level_id === Number(levelId), 'Evidence level mismatch');
  const levelNumber = integer(level.level_number, 1);
  requireData(editor.block_type_id === 1 || editor.block_type_id === 2, 'Unknown participant mode');
  const mode = editor.block_type_id === 2 ? 'team' : 'user';
  requireData(typeof editor.version === 'string' && editor.version.length > 0, 'Missing level version');
  for (const field of ['answers', 'sectors', 'bonuses']) requireData(Array.isArray(editor[field]), 'Missing editor ' + field);
  const main = await pages(p => client.monitoringPage(gameId, levelId, 0, p, signal), 'actions', 'page', body => {
    checkGame(body); requireData(body.can_view === true && body.mode === 'main', 'Monitoring unavailable');
  });
  const bonus = await pages(p => client.monitoringPage(gameId, levelId, 1, p, signal), 'bonus_actions', 'page', body => {
    checkGame(body); requireData(body.can_view === true && body.mode === 'bonus', 'Bonus monitoring unavailable');
  });
  const statistics = await pages(p => client.statisticsPage(gameId, levelNumber, p, signal), 'stat_items', 'current_page', body => {
    checkGame(body); requireData(body.level_num === levelNumber, 'Statistics level mismatch');
  });
  // Full game statistics include correction sums; load all pages without flattening level_stats.
  const gameStatistics: Record<string, unknown>[] = [];
  for (let page = 1, total = 1; page <= total; page++) {
    const body = await client.gameStatisticsPage(gameId, page, signal); checkGame(body);
    requireData(body.can_view_stats === true && body.needs_confirm !== true && body.mask_passed !== true && body.mask_more !== true, 'Statistics hidden or requires viewing confirmation');
    requireData(integer(body.current_page, 1) === page, 'Statistics page mismatch');
    const pagesCount = integer(body.total_pages, 1); requireData(pagesCount <= 1000 && (page === 1 || pagesCount === total), 'Statistics pagination changed');
    total = pagesCount; record(body.level_stats); requireData(Array.isArray(body.level_corrections), 'Missing correction sums');
    gameStatistics.push(body);
  }
  const players = await pages(p => client.playersPage(gameId, p, signal), 'players', 'page', body => {
    checkGame(body); requireData(body.can_view === true, 'Roster unavailable');
  });
  const corrections = await client.corrections(gameId, signal); checkGame(corrections);
  requireData(Array.isArray(corrections.items) && Array.isArray(corrections.players), 'Incomplete corrections');
  requireData(corrections.use_score_value === false, 'Only confirmed time mode is supported');
  const key = (row: Record<string, unknown>) => mode + ':' + integer(row[mode === 'team' ? 'team_id' : 'user_id'], 1);
  const roster = players.flatMap(body => (body.players as unknown[]).map(record));
  const participants = (corrections.players as unknown[]).map(record).map(row => {
    const id = integer(row.id, 1), entry = roster.find(item => item[mode === 'team' ? 'team_id' : 'user_id'] === id);
    requireData(entry, 'Correction recipient missing from roster');
    return { key: mode + ':' + id, id, gamePlayerId: integer(row.game_player_id, 1),
      label: typeof row.label === 'string' ? row.label : String(id), eligible: entry.status_id === 1 && entry.is_approved === true,
      enteredAt: typeof entry.game_entry_date_time === 'string' ? entry.game_entry_date_time : null };
  });
  requireData(new Set(participants.map(row => row.key)).size === participants.length, 'Duplicate correction recipients');
  const known = new Set(participants.map(row => row.key));
  const statRows = statistics.flatMap(body => (body.stat_items as unknown[]).map(record));
  requireData(new Set(statRows.map(key)).size === statRows.length, 'Duplicate participant statistic rows');
  const times = statRows.flatMap(row => {
    requireData(row.level_id === Number(levelId) && row.level_num === levelNumber, 'Statistic row level mismatch');
    const participantKey = key(row); requireData(known.has(participantKey), 'Unknown statistics participant');
    // The app represents absent/.NET-zero completion dates as uncompleted. They cannot be donors
    // or supply a guessed baseline for a correction.
    if (row.enter_date_time == null || row.enter_date_time === '' || typeof row.enter_date_time === 'string' && row.enter_date_time.startsWith('0001-01-01T')) return [];
    const endMs = timestamp(row.enter_date_time), rawSeconds = integer(row.spent_seconds);
    const startMs = endMs - rawSeconds * 1000; requireData(Number.isSafeInteger(startMs), 'Time overflow');
    const passType = integer(row.pass_type_id); requireData(passType <= 2, 'Unknown completion type');
    return [{ key: participantKey, startMs, endMs, rawSeconds, passType }];
  });
  requireData(new Set(times.map(row => row.key)).size === times.length, 'Duplicate participant times');
  const events: AnswerEvent[] = [];
  for (const tab of [0, 1] as const) for (const body of tab === 0 ? main : bonus) {
    for (const row of (body[tab === 0 ? 'actions' : 'bonus_actions'] as unknown[]).map(record)) {
      requireData(row.level_id === Number(levelId) && row.level_number === levelNumber, 'Monitoring row level mismatch');
      const participantKey = key(row); requireData(known.has(participantKey), 'Unknown monitoring participant');
      requireData(typeof row.answer === 'string', 'Missing literal answer');
      events.push({ tab, actionId: integer(row.action_id, 1), key: participantKey, answer: row.answer,
        at: timestamp(row[tab === 0 ? 'answer_date_time' : 'enter_date_time']), correct: typeof row.is_correct === 'boolean' ? row.is_correct : null,
        sectorId: Number.isSafeInteger(row.sector_id) && Number(row.sector_id) > 0 ? Number(row.sector_id) : null,
        bonusId: tab === 1 ? integer(row.bonus_id, 1) : null });
    }
  }
  requireData(new Set(events.map(row => row.tab + ':' + row.actionId)).size === events.length, 'Monitoring changed: duplicate events across pages');
  requireData([...main, ...bonus, ...players].every(body => body.finished === true || body.finished === false), 'Unknown finished state');
  const finished = [...main, ...bonus, ...players].every(body => body.finished === true);
  requireData(await client.identity() === sessionKey, 'Session changed while reading evidence');
  return { schemaVersion: 1, scope: { domain, gameId, levelId, levelNumber }, sessionKey, capturedAt: new Date().toISOString(), complete: true,
    finished, mode, canWrite: corrections.can_add === true && corrections.is_admin === true,
    levelVersion: editor.version, participants, times, events, raw: { editor, main, bonus, statistics, gameStatistics, players, corrections } };
}
type LegacyContext=Awaited<ReturnType<LegacyStatistics['read']>>;
/** The HTML/JSON sources are individually projected and cross-checked before complete:true exists. */
async function readLegacyRecalculationEvidence(client:EncounterClient,domain:string,gameId:string,levelId:string,signal?:AbortSignal):Promise<RecalculationEvidence>{
  const sessionKey=await client.identity(),context=await client.legacyRecalculationContext(gameId,signal) as unknown as LegacyContext;
  requireData(context.complete===true&&context.statistics.coverage.complete,'Incomplete legacy statistics/roster');
  const statistics=context.statistics,mode=statistics.mode;requireData(statistics.gameId===Number(gameId),'Legacy context game mismatch');
  const level=statistics.levels.find(row=>row.levelId===Number(levelId));requireData(level,'Unknown legacy level');
  const editor=(await client.level(gameId,levelId)).data,collections=record(editor._authoring).collections,manager=(await client.levels(gameId)).data;
  requireData(manager.level_state_complete===true&&typeof manager.version==='string','Legacy complete level-state inventory unavailable');
  requireData(Array.isArray(manager.levels)&&canonical(manager.levels.map(raw=>{const row=record(raw);return [row.level_id,row.level_number];}))===canonical(statistics.levels.map(row=>[row.levelId,row.levelNumber])),'Legacy level inventories differ');
  for(const name of ['answers','bonuses'])requireData(record(collections)[name]==='observed'&&Array.isArray(editor[name]),'Legacy editor '+name+' unavailable');
  requireData(Array.isArray(editor.sectors),'Legacy sectors unavailable');
  const participants=context.roster.map(row=>({...row})),known=new Set(participants.map(row=>row.key));
  requireData(participants.length>0&&known.size===participants.length,'Empty or duplicate legacy accepted roster');
  const participantKey=(row:{teamId:number|null;userId:number|null})=>mode+':'+(mode==='team'?row.teamId:row.userId);
  const times=statistics.rows.filter(row=>row.levelId===Number(levelId)).flatMap(row=>{
    const key=participantKey(row);requireData(known.has(key),'Legacy statistics recipient outside accepted roster');if(row.actionTime===null)return [];
    // Value is native milliseconds since year 1, with sub-millisecond float noise. Timestamp independently fixes epoch seconds.
    const milliseconds=Math.floor(row.actionTime.value%1000),endMs=row.actionTime.timestamp*1000+milliseconds;
    requireData(Number.isSafeInteger(endMs)&&Math.abs(Math.floor((row.actionTime.value-62135596800000)/1000)-row.actionTime.timestamp)<=1,'Legacy native clock mismatch');
    const cell=context.final.cells.find(cell=>cell.key===key&&cell.levelNumber===level.levelNumber);requireData(cell&&cell.spentSeconds===row.spentSeconds,'Legacy HTML/JSON level duration mismatch');
    // Displayed clocks can include correction effects; only the timestamp source defines raw completion.
    return [{key,startMs:endMs-row.spentSeconds*1000,endMs,rawSeconds:row.spentSeconds,passType:row.passType}];
  });
  const main:Record<string,unknown>[]=[],bonus:Record<string,unknown>[]=[],events:AnswerEvent[]=[];
  for(const tab of [0,1] as const){let total=1;for(let page=1;page<=total;page++){
    const body=await client.monitoringPage(gameId,levelId,tab,page,signal);requireData(body.game_id===Number(gameId)&&body.can_view===true&&body.page===page,'Legacy monitoring page mismatch');
    const count=integer(body.total_pages,1);requireData(count<=1000&&(page===1||count===total),'Legacy monitoring pagination changed');total=count;
    const rows=body[tab?'bonus_actions':'actions'];requireData(Array.isArray(rows),'Legacy monitoring rows unavailable');(tab?bonus:main).push(body);
    for(const raw of rows){const row=raw as LegacyAnswerEvent;requireData(row.tab===tab&&row.level_num===level.levelNumber&&row.server_action_id===null,'Legacy monitoring scope/identity mismatch');
      const key=mode+':'+(mode==='team'?row.team_id:row.user_id);requireData(known.has(key),'Legacy monitoring recipient outside accepted roster');
      if(row.event_kind==='timeout')continue;
      requireData(typeof row.answer_text==='string'&&typeof row.is_correct==='boolean','Unknown legacy answer/verdict');
      events.push({tab,actionId:events.length+1,key,answer:row.answer_text,at:legacyLocalTime(row.answer_date_time,context.timezone),correct:row.is_correct,sectorId:null,bonusId:row.bonus_id});
    }
  }
    // Reread every page, not just boundaries: changes in middle pages also invalidate the snapshot.
    for(const body of tab?bonus:main)requireData(canonical(body)===canonical(await client.monitoringPage(gameId,levelId,tab,Number(body.page),signal)),'Legacy monitoring changed during read');
  }
  const rawCorrections=await client.corrections(gameId,signal);requireData(Array.isArray(rawCorrections.items)&&record(rawCorrections.legacy_evidence).complete===true,'Legacy correction ledger incomplete');
  const corrections={...rawCorrections,items:rawCorrections.items.map(raw=>{const row=record(raw),number=row.level_num;
    const mapped=number===null?null:statistics.levels.find(level=>level.levelNumber===number)?.levelId;requireData(number===null||mapped!==undefined,'Unknown correction level ordinal');
    requireData(Number.isSafeInteger(row.correction_value),'Unknown legacy correction duration');const key=mode+':'+row[mode==='team'?'team_id':'user_id'],recipient=participants.find(p=>p.key===key);
    return {...row,level_id:mapped,game_player_id:recipient?.gamePlayerId??null};
  })};
  const fresh=await client.legacyRecalculationContext(gameId,signal);requireData(canonical(context)===canonical(fresh),'Legacy context changed during read');
  requireData(await client.identity()===sessionKey,'Session changed while reading legacy evidence');
  // The digest is an observed version over calculation-relevant fields, not server CAS.
  const projected={...editor,_legacy_manager:manager};
  const editorProjection={...projected,level:{...record(editor.level),dismissed:level.dismissed},version:'legacy-observed:recalculation:'+await digest(projected)};
  return {schemaVersion:1,scope:{domain,gameId,levelId,levelNumber:level.levelNumber},sessionKey,capturedAt:new Date().toISOString(),complete:true,finished:statistics.finished,mode,
    canWrite:context.canWrite,levelVersion:String(editorProjection.version),participants,times,events,legacy:{eventIdentity:'snapshot-local-index',timezoneOffsetMinutes:context.timezone,finalTotals:context.final,atomic:false},
    raw:{editor:editorProjection,statistics:[{game_id:Number(gameId),rows:statistics.rows}],gameStatistics:[{game_id:Number(gameId),final:context.final}],main,bonus,players:[{players:participants}],corrections}};
}
export function evidenceFingerprint(evidence: RecalculationEvidence): Promise<string> {
  const { capturedAt: _capturedAt, ...data } = evidence;
  return digest(data);
}
