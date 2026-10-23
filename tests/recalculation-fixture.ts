import { EncounterClient } from '../src/encounter.ts';
import { readRecalculationEvidence } from '../src/recalculation-evidence.ts';
import type { CorrectionHost, CorrectionJournal } from '../src/correction-executor.ts';

export const gameId = '900001', levelId = '900002', bonusId = 930001;
export const team = (index: number) => 910000 + index;
export const key = (index: number) => 'team:' + team(index);
export const at = (seconds: number) => new Date(Date.UTC(2026, 9, 14) + seconds * 1000).toISOString();
export const units = ['слон1', 'тигр2', 'лев3', 'кот4', 'мышь5'].map((answer, i) => ({ id: String(i), answers: [answer] }));
export class FixtureApi {
  durations = [50, 50]; passTypes = [0, 0]; finished = true; writes = 0; failWrite = false; loseWriteResponse = false; failReadBack = false;
  items: Record<string, unknown>[] = []; events: Record<string, unknown>[] = []; bonusEvents: Record<string, unknown>[] = [];
  version = 'synthetic-v1'; dismissed = false; token = 'synthetic-token'; pages = 1; omitPage = false;
  nextAction = 1;
  constructor() {
    this.order(1, ['тигр2', 'лев3', 'слон1', 'мышь5', 'кот4']);
    this.order(2, ['мышь5', 'кот4', 'лев3', 'слон1', 'тигр2']);
  }
  order(index: number, answers: string[]) {
    this.events = this.events.filter(row => row.team_id !== team(index));
    answers.forEach((answer, i) => this.events.push(this.event(index, answer, (i + 1) * 10, true)));
  }
  event(index: number, answer: string, seconds: number, correct: boolean, actionId = this.nextAction++) {
    return { action_id: 950000 + actionId, answer, answer_date_time: at(seconds), is_correct: correct,
      game_player_id: 920000 + index, level_id: Number(levelId), level_number: 5, team_id: team(index), user_id: 0, sector_id: 0 };
  }
  stats() { return this.durations.map((spent_seconds, i) => ({ game_player_id: 920001 + i, level_id: Number(levelId), level_num: 5,
    team_id: team(i + 1), user_id: 0, enter_date_time: at(spent_seconds), spent_seconds, pass_type_id: this.passTypes[i] ?? 0 })); }
  fetch: typeof fetch = async (url, init) => {
    const parsed = new URL(String(url)), path = parsed.pathname, method = init?.method ?? 'GET';
    let body: unknown;
    if (method === 'POST' && path.endsWith('/corrections')) {
      this.writes++; if (this.failWrite) return new Response('{}', { status: 403 });
      const payload = JSON.parse(String(init?.body));
      const correct_id = 940000 + this.items.length + 1;
      this.items.push({ ...payload, correct_id, game_id: Number(gameId), team_id: payload.player_id, user_id: 0,
        correction_value: payload.is_bonus ? payload.seconds : -payload.seconds, correction_type: 4 });
      if (this.loseWriteResponse) throw new Error('Synthetic lost response');
      body = { correct_id };
    } else if (method === 'POST' && path.endsWith('/dismiss')) { this.dismissed = true; return new Response(null, { status: 204 }); }
    else if (path.includes('/corrections/')) {
      if (this.failReadBack) return new Response('{}', { status: 404 });
      body = this.items.find(row => row.correct_id === Number(path.split('/').at(-1)));
    } else if (path.endsWith('/editor')) body = { game_id: Number(gameId), version: this.version, block_type_id: 2,
      level: { level_id: Number(levelId), level_number: 5, dismissed: this.dismissed }, answers: units.map((u, i) => ({ answer_id: i + 1, answer_text: u.answers[0] })), sectors: [],
      bonuses: [{ bonus_id: bonusId, negative: false, answers: ['бонус1'] }] };
    else if (path.endsWith('/monitoring')) {
      const tab = Number(parsed.searchParams.get('tab')), page = Number(parsed.searchParams.get('page'));
      const all = tab === 0 ? this.events : this.bonusEvents;
      const selected = this.pages === 1 ? all : page === 1 ? all.slice(0, 2) : all.slice(2);
      body = { game_id: Number(gameId), can_view: true, mode: tab === 0 ? 'main' : 'bonus', finished: this.finished,
        page, total_pages: this.pages, total_rows: all.length, [tab === 0 ? 'actions' : 'bonus_actions']: this.omitPage && page === 2 ? [] : selected };
    } else if (path.includes('/levels/') && path.endsWith('/statistics')) body = { game_id: Number(gameId), level_num: 5, current_page: 1, total_pages: 1, stat_items: this.stats() };
    else if (path.endsWith('/statistics')) body = { game_id: Number(gameId), can_view_stats: true, needs_confirm: false, current_page: 1, total_pages: 1, level_stats: { '5': this.stats() }, level_corrections: this.items.map(row => ({ team_id: row.team_id, user_id: 0, level_id: Number(levelId), correction_value: row.correction_value })) };
    else if (path.endsWith('/players')) body = { game_id: Number(gameId), can_view: true, finished: this.finished, page: 1, total_pages: 1, total_rows: this.durations.length,
      players: this.durations.map((_, i) => ({ team_id: team(i + 1), user_id: 0, status_id: 1, is_approved: true, game_entry_date_time: at(0) })) };
    else if (path.endsWith('/corrections')) body = { game_id: Number(gameId), can_add: true, is_admin: true, use_score_value: false, items: this.items,
      players: this.durations.map((_, i) => ({ id: team(i + 1), game_player_id: 920001 + i, label: `Синтетическая команда ${i + 1}` })) };
    else throw new Error('Unexpected synthetic route: ' + path);
    return new Response(JSON.stringify(body), { status: 200 });
  };
  client() { return new EncounterClient({ domain: 'demo.en.cx', token: () => this.token, fetch: this.fetch }); }
  read(client = this.client()) { return readRecalculationEvidence(client, 'demo.en.cx', gameId, levelId); }
}
export function memoryHost(approved = true): CorrectionHost & { journal: CorrectionJournal | null; approvedValue: boolean } {
  return { approvedValue: approved, journal: null, approved: async function () { return this.approvedValue; },
    withLock: async (_key, action) => action(), load: async function () { return this.journal ? structuredClone(this.journal) : null; },
    save: async function (journal) { this.journal = structuredClone(journal); } };
}
