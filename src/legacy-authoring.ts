import {LegacyStatistics} from './legacy-statistics.ts';
import {parseLegacyRecipientOptions,legacyRecipientKind,legacyRecipientFields,resolveLegacyRecipient,type LegacyRecipientOption} from './legacy-recipients.ts';
import {parse, Parser, type DefaultTreeAdapterMap} from 'parse5';
import {AuthoringApiError, authoringMetadata, sameAuthoringBinding, type AuthoringApiPort, type AuthoringBinding, type AuthoringMetadata} from './authoring-api.ts';
import {LegacyObservations} from './legacy-observations.ts';
import {LegacyHints} from './legacy-hints.ts';
import {LegacyLevels} from './legacy-levels.ts';
import {LegacyGame} from './legacy-game.ts';
import {LegacyTasks} from './legacy-tasks.ts';
import {LegacyLevelExtras} from './legacy-level-extras.ts';
import {LegacyFiles} from './legacy-files.ts';
import {LegacyAnswers} from './legacy-answers.ts';
import {LegacyBonuses} from './legacy-bonuses.ts';
import {LegacySectors} from './legacy-sectors.ts';

export interface LegacyRecipe {
  readonly kind: 'file-upload' | 'statistics-json' | 'statistics-final' | 'players-read' | 'message-view-read' | 'hint-view-read' | 'answer-create' | 'bonus-form-read' | 'bonus-write' | 'bonus-delete' | 'sector-form-read' | 'sector-write' | 'sector-delete' | 'answer-list-read' | 'answer-edit-read' | 'answer-write' | 'file-inventory-read' | 'scenario-export-read' | 'hint-add-read' | 'hint-create' | 'hint-delete' | 'level-extra-read' | 'level-extra-update' | 'message-form' | 'message-write' | 'message-delete' | 'game-editor-read' | 'game-update' | 'game-read' | 'level-index' | 'level-create' | 'level-names-update' | 'level-copy' | 'level-delete' | 'level-move' | 'level-state-confirm-read' | 'level-dismiss' | 'level-restore' | 'level-editor-read' | 'task-edit-read' | 'task-update' | 'task-add-read' | 'task-create' | 'task-delete' | 'hint-edit-read' | 'hint-update' | 'monitoring-read' | 'correction-list' | 'correction-form' | 'correction-write' | 'correction-delete';
  readonly effect: 'read' | 'mutation'; readonly method: 'GET' | 'POST'; readonly path: string; readonly body?: string;
  readonly upload?: {field:string;filename:string;mime:string;base64:string;controls:[string,string][]};
}
export interface LegacyPage {status: number; url: string; html: string}
/** Host owns cookies/account checks, pinned document, write permit and durable dispatch intent. */
export interface LegacySessionPort {
  readonly supportsFileUpload?: boolean;
  readonly binding: AuthoringBinding;
  currentBinding(): Promise<AuthoringBinding>;
  dispatch(recipe: Readonly<LegacyRecipe>, signal?: AbortSignal): Promise<LegacyPage>;
}
type Node = DefaultTreeAdapterMap['node'];
const attr = (node: Node, name: string) => 'attrs' in node ? node.attrs.find(a => a.name === name)?.value : undefined;
const tag = (node: Node) => 'tagName' in node ? node.tagName : '';
export function legacyNodes(node: Node): Node[] { return [node, ...('childNodes' in node ? node.childNodes.flatMap(legacyNodes) : [])]; }
const nodes = legacyNodes;
function text(node: Node): string { return 'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(text).join('') : ''; }
export function legacyText(value: string): string { return value.replace(/\r\n|\r/g,'\n'); }
/** Capture real form tokens; tree repair can detach controls from malformed tables. */
export function sourceFormRanges(html: string): {start: number; end: number}[] {
  const parser = new Parser({sourceCodeLocationInfo:true});
  const ranges: {start:number;end:number}[] = []; let start: number | undefined;
  const starts = new Set<number>(), ends = new Set<number>();
  const onStart = parser.onStartTag.bind(parser), onEnd = parser.onEndTag.bind(parser);
  parser.onStartTag = token => { if (token.tagName === 'form' && token.location && !starts.has(token.location.startOffset)) { starts.add(token.location.startOffset); if (start !== undefined) return fail('nested-form-token'); start = token.location.endOffset; } onStart(token); };
  parser.onEndTag = token => { if (token.tagName === 'form' && token.location && !ends.has(token.location.startOffset)) { ends.add(token.location.startOffset); if (start === undefined) return fail('unmatched-form-end-token'); ranges.push({start,end:token.location.startOffset}); start = undefined; } onEnd(token); };
  parser.tokenizer.write(html,true);
  if (start !== undefined) return fail();
  return ranges;
}
function fail(stage?: string): never { const error = new AuthoringApiError('incomplete-read'); if (stage) Object.defineProperty(error,'stage',{value:stage,enumerable:true}); throw error; }
function positive(value: string | undefined): number { if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) return fail(); return Number(value); }
export function legacyDocument(page: LegacyPage, binding: AuthoringBinding, path: string): Node {
  const expected = new URL(path, `https://${binding.domain}`), actual = new URL(page.url);
  if (page.status !== 200 || actual.origin !== expected.origin || actual.pathname !== expected.pathname || actual.search !== expected.search || page.html.length > 2_000_000) return fail();
  const root = parse(page.html,{sourceCodeLocationInfo:true});
  if (nodes(root).some(node => tag(node) === 'input' && ['password','login'].includes((attr(node,'name') ?? '').toLowerCase()))) return fail();
  return root;
}
const tree = legacyDocument;
export function parseLegacyLevelIndex(page: LegacyPage, binding: AuthoringBinding) {
  const root = tree(page, binding, `/Administration/Games/LevelManager.aspx?gid=${binding.gameId}`), all = nodes(root);
  if (!all.some(node => tag(node) === 'form' && (attr(node,'name') === 'LevelsCreateForm' || attr(node,'id') === 'LevelsCreateForm'))) return fail();
  const levels: {level_id: number; level_number: number; level_name: string}[] = [];
  for (const input of all.filter(node => tag(node) === 'input' && /^txtLevelName_\d+$/.test(attr(node,'name') ?? ''))) {
    const levelId = positive(attr(input,'name')?.slice('txtLevelName_'.length));
    let row: Node | undefined = input;
    while (row && tag(row) !== 'tr') row = 'parentNode' in row ? row.parentNode ?? undefined : undefined;
    if (!row) return fail();
    const ordinals = new Set(nodes(row).filter(node => tag(node) === 'a').flatMap(node => {
      const href = attr(node,'href'); if (!href) return [];
      const url = new URL(href, `https://${binding.domain}`);
      if (url.origin !== `https://${binding.domain}` || url.pathname !== '/Administration/Games/LevelEditor.aspx') return [];
      if (url.searchParams.get('gid') !== String(binding.gameId) || [...url.searchParams.keys()].some(key => !['gid','level'].includes(key))) return fail();
      return [positive(url.searchParams.get('level') ?? undefined)];
    }));
    if (ordinals.size !== 1) return fail();
    levels.push({level_id: levelId, level_number: [...ordinals][0], level_name: attr(input,'value') ?? ''});
  }
  if (new Set(levels.map(row => row.level_id)).size !== levels.length || new Set(levels.map(row => row.level_number)).size !== levels.length || levels.length > 500) return fail();
  return levels.sort((a,b) => a.level_number - b.level_number);
}
export interface LegacyTextForm {text: string; controls: [string,string][]; replaceNewlines: boolean; recipient: number; names: string[]; controlCounts:Record<string,number>; checkboxValues:Record<string,string>;recipientOptions:LegacyRecipientOption[];recipientKind?:'user'|'team'|'unknown'}
/** Verify successful siblings, preserving repeated names and ordering. */
export function legacyFormPreserved(before:LegacyTextForm,after:LegacyTextForm,changed:string[]):boolean {
  const ignored=new Set([...changed,'btnUpdate.x','btnUpdate.y','__VIEWSTATE','__VIEWSTATEGENERATOR','__EVENTVALIDATION']);
  const siblings=(form:LegacyTextForm)=>form.controls.filter(([name])=>!ignored.has(name));
  return JSON.stringify(siblings(before))===JSON.stringify(siblings(after))&&JSON.stringify(before.checkboxValues)===JSON.stringify(after.checkboxValues)&&JSON.stringify(before.recipientOptions)===JSON.stringify(after.recipientOptions);
}
export async function legacyFormPreservationVersion(binding:AuthoringBinding,scope:string,form:LegacyTextForm,changed:string[]):Promise<string>{
  const ignored=new Set([...changed,'btnUpdate.x','btnUpdate.y','__VIEWSTATE','__VIEWSTATEGENERATOR','__EVENTVALIDATION']);
  const value=JSON.stringify({binding,scope,recipientOptions:form.recipientOptions,controls:form.controls.filter(([name])=>!ignored.has(name)),checkboxValues:form.checkboxValues});
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return 'legacy-preservation:v1:'+Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export function parseLegacyTextForm(page: LegacyPage, binding: AuthoringBinding, path: string, fields = {text:'inputTask',recipient:'forMemberID',submit:'btnUpdate'}): LegacyTextForm {
  const root = tree(page,binding,path), all = nodes(root), areas = all.filter(node => tag(node) === 'textarea' && attr(node,'name') === fields.text);
  if (areas.length !== 1) return fail('task-textarea-count');
  const area = areas[0];
  let form: Node | undefined;
  const formId = attr(area,'form');
  if (formId) { const forms = all.filter(node => tag(node) === 'form' && attr(node,'id') === formId); if (forms.length !== 1) return fail(); form = forms[0]; }
  else { form = 'parentNode' in area ? area.parentNode ?? undefined : undefined; while (form && tag(form) !== 'form') form = 'parentNode' in form ? form.parentNode ?? undefined : undefined; }
  const forms = all.filter(node => tag(node) === 'form');
  // The observed legacy popup uses malformed table markup: the HTML parser closes
  // its sole form before the controls. Only its exact known recipe may recover it.
  let sourceRange: {start:number;end:number} | undefined;
  if (!form && forms.length === 1 && !formId) {
    const ranges = sourceFormRanges(page.html); if (ranges.length !== 1) return fail('task-form-source-count'); sourceRange = ranges[0];
    const areaOffset = 'sourceCodeLocation' in area ? area.sourceCodeLocation?.startOffset : undefined;
    if (areaOffset === undefined || areaOffset < sourceRange.start || areaOffset >= sourceRange.end) return fail('task-textarea-outside-form');
    form = forms[0];
  }
  if (!form || (attr(form,'method') ?? 'get').toLowerCase() !== 'post') return fail('task-form-method');
  const action = new URL(attr(form,'action') || path, `https://${binding.domain}`), expected = new URL(path, `https://${binding.domain}`);
  if (action.href !== expected.href) return fail('task-form-action');
  const recovered = !nodes(form).includes(area);
  const belongs = (node: Node) => {
    if (recovered) {
      const offset = 'sourceCodeLocation' in node ? node.sourceCodeLocation?.startOffset : undefined;
      return offset !== undefined && !!sourceRange && offset >= sourceRange.start && offset < sourceRange.end;
    }
    if (attr(node,'form') !== undefined) return !!attr(form!,'id') && attr(node,'form') === attr(form!,'id');
    let parent = 'parentNode' in node ? node.parentNode : null;
    while (parent && tag(parent) !== 'form') parent = 'parentNode' in parent ? parent.parentNode : null;
    return parent === form;
  };
  const controls: [string,string][] = []; let replaceNewlines = false; let recipient: number | undefined; let recipientOptions:LegacyRecipientOption[]=[]; let submitters = 0;
  const names = new Map<string,number>();
  const checkboxValues:Record<string,string>={};
  for (const node of all.filter(node => ['input','select','textarea','button'].includes(tag(node)) && belongs(node))) {
    const name = attr(node,'name'); if (!name) continue;
    let ancestor = 'parentNode' in node ? node.parentNode : null;
    while (ancestor && ancestor !== form) { if (tag(ancestor) === 'fieldset' && attr(ancestor,'disabled') !== undefined) return fail(); ancestor = 'parentNode' in ancestor ? ancestor.parentNode : null; }
    if (attr(node,'disabled') !== undefined) { if ([fields.text,fields.recipient,'chkReplaceNlToBr',fields.submit].includes(name)) return fail(); continue; }
    names.set(name,(names.get(name) ?? 0)+1);
    const type = (attr(node,'type') ?? (tag(node) === 'button' ? 'submit' : 'text')).toLowerCase();
    if(type==='checkbox') {if(Object.hasOwn(checkboxValues,name))delete checkboxValues[name];else checkboxValues[name]=attr(node,'value')??'on';}
    if (['file','password'].includes(type)) return fail();
    if (['submit','image','button','reset'].includes(type)) {
      if (name === fields.submit && type === 'image') { submitters++; controls.push([name+'.x','1'],[name+'.y','1']); }
      continue;
    }
    if (['checkbox','radio'].includes(type) && attr(node,'checked') === undefined) continue;
    if (name === 'chkReplaceNlToBr') replaceNewlines = true;
    let values: string[];
    if (tag(node) === 'select') {
      const options = nodes(node).filter(option => tag(option) === 'option');
      const enabled=(option:Node)=>{if(attr(option,'disabled')!==undefined)return false;let parent='parentNode'in option?option.parentNode:null;while(parent&&parent!==node){if(tag(parent)==='optgroup'&&attr(parent,'disabled')!==undefined)return false;parent='parentNode'in parent?parent.parentNode:null;}return true;};
      const selected = options.filter(option => attr(option,'selected') !== undefined);
      const multiple=attr(node,'multiple')!==undefined;
      const chosen = selected.length ? multiple?selected:selected.slice(-1) : multiple?[]:options.filter(enabled).slice(0,1);
      values = chosen.filter(enabled).map(option => attr(option,'value') ?? text(option));
    } else values = [tag(node) === 'textarea' ? text(node) : attr(node,'value') ?? (['checkbox','radio'].includes(type) ? 'on' : '')];
    if (name === fields.recipient) { recipientOptions=parseLegacyRecipientOptions(node); if (values.length !== 1 || !recipientOptions.some(option=>String(option.member_id)===values[0])) return fail('task-recipient'); recipient = Number(values[0]); }
    for (const value of values) controls.push([name,value]);
  }
  if (submitters !== 1 || recipient === undefined || [fields.text,fields.recipient,'chkReplaceNlToBr',fields.submit].some(name => (names.get(name) ?? 0) > 1)) return fail('task-required-controls');
  return {text: legacyText(text(area)), controls, replaceNewlines, recipient, recipientOptions, names:[...names.keys()],controlCounts:Object.fromEntries(names),checkboxValues};
}
export function parseLegacyTaskForm(page: LegacyPage, binding: AuthoringBinding, path: string): LegacyTextForm { return parseLegacyTextForm(page,binding,path); }
async function revision(binding: AuthoringBinding, levelId: number, levelNumber: number, taskId: number, form: LegacyTextForm) {
  const value = JSON.stringify({profile: 'legacy-task-v1',binding,levelId,levelNumber,taskId,text: form.text,recipient: form.recipient,recipientOptions:form.recipientOptions,replaceNewlines: form.replaceNewlines,
    controls:form.controls.filter(([name])=>!['btnUpdate.x','btnUpdate.y'].includes(name))});
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return 'legacy-observed:task-v1:' + [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2,'0')).join('');
}
/** Supported initial vertical: level index and exact all-target task update. No fabricated editor arrays/live state. */
export class LegacyAuthoringAdapter implements AuthoringApiPort {
  readonly metadata: Readonly<AuthoringMetadata>; readonly #session: LegacySessionPort; #active = true;
  readonly #observations: LegacyObservations;
  readonly #statistics:LegacyStatistics;
  readonly #hints: LegacyHints;
  readonly #levelOperations: LegacyLevels;
  readonly #game: LegacyGame;
  readonly #tasks: LegacyTasks;
  readonly #extras: LegacyLevelExtras;
  readonly #files: LegacyFiles;
  readonly #answers:LegacyAnswers;
  readonly #bonuses:LegacyBonuses;
  readonly #sectors:LegacySectors;
  constructor(session: LegacySessionPort) {
    if (session.binding.engine !== 'legacy') throw new AuthoringApiError('invalid-scope');
    this.metadata = authoringMetadata(session.binding,[...(session.supportsFileUpload?['game-file-upload' as const]:[]),'game-read','game-settings-update','game-description-read','game-description-update','level-index','level-create','level-copy','level-delete','level-move','level-dismiss','level-restore','task-read','task-update','task-create','task-delete','sectors-read','sector-create','sector-update','sector-delete','bonuses-read','bonus-create','bonus-update','bonus-delete','answer-create','answers-read','answer-update','answer-delete','hint-read','hint-update','hint-create','hint-delete','level-settings-update','message-update','file-reference-read','scenario-export-read','monitoring-read','corrections','correction-ledger','correction-write']); this.#session = session;
    const wrappedSession={supportsFileUpload:session.supportsFileUpload,binding:this.metadata.binding,currentBinding:()=>session.currentBinding(),dispatch:(recipe:LegacyRecipe,signal?:AbortSignal)=>this.#dispatch(recipe,signal)};
    this.#observations = new LegacyObservations(wrappedSession);
    this.#statistics = new LegacyStatistics(wrappedSession);
    this.#levelOperations = new LegacyLevels({binding:this.metadata.binding,currentBinding:()=>session.currentBinding(),dispatch:(recipe,signal)=>this.#dispatch(recipe,signal)});
    this.#game = new LegacyGame({binding:this.metadata.binding,currentBinding:()=>session.currentBinding(),dispatch:(recipe,signal)=>this.#dispatch(recipe,signal)});
    this.#tasks = new LegacyTasks({binding:this.metadata.binding,level:async(id,signal)=>{const level=(await this.#levels(signal)).find(row=>row.level_id===id);if(!level)return fail();return level;},ids:(ordinal,signal)=>this.#taskIds(ordinal,signal),exact:(levelId,taskId,signal)=>this.#task(levelId,taskId,signal),dispatch:(recipe,signal)=>this.#dispatch(recipe,signal),recipientKind:signal=>this.#recipientKind(signal)});
    this.#extras=new LegacyLevelExtras(wrappedSession);this.#files=new LegacyFiles(wrappedSession);
    this.#answers=new LegacyAnswers(wrappedSession);this.#bonuses=new LegacyBonuses(wrappedSession);this.#sectors=new LegacySectors(wrappedSession);
    this.#hints = new LegacyHints({binding:this.metadata.binding,level:async(id,signal)=>{const level=(await this.#levels(signal)).find(row=>row.level_id===id);if(!level)return fail();return level;},editor:ordinal=>this.#dispatch({kind:'level-editor-read',effect:'read',method:'GET',path:`/Administration/Games/LevelEditor.aspx?gid=${session.binding.gameId}&level=${ordinal}`}),dispatch:(recipe,signal)=>this.#dispatch(recipe,signal)});
  }
  invalidate() { this.#active = false; }
  async #check() {
    if (!this.#active) throw new AuthoringApiError('session-changed');
    const binding = await this.#session.currentBinding();
    if (!this.#active || !sameAuthoringBinding(this.metadata.binding,binding)) throw new AuthoringApiError('session-changed');
  }
  async #dispatch(recipe: LegacyRecipe, signal?: AbortSignal) {
    await this.#check(); signal?.throwIfAborted();
    if (!this.#active) throw new AuthoringApiError('session-changed');
    const page = await this.#session.dispatch(Object.freeze(recipe),signal);
    await this.#check(); return page;
  }
  async #levels(signal?: AbortSignal) {
    const path = `/Administration/Games/LevelManager.aspx?gid=${this.metadata.binding.gameId}`;
    return parseLegacyLevelIndex(await this.#dispatch({kind:'level-index',effect:'read',method:'GET',path},signal),this.metadata.binding);
  }
  async #recipientKind(signal?:AbortSignal):Promise<'user'|'team'|'unknown'>{try{const path=`/GameDetails.aspx?gid=${this.metadata.binding.gameId}`;return legacyRecipientKind(await this.#dispatch({kind:'game-read',effect:'read',method:'GET',path},signal),this.metadata.binding);}catch(error){if(signal?.aborted||error instanceof AuthoringApiError&&error.code==='session-changed')throw error;return 'unknown';}}
  async #task(levelId: number, taskId: number, signal?: AbortSignal) {
    const recipientKind=await this.#recipientKind(signal);
    const matches = (await this.#levels(signal)).filter(row => row.level_id === levelId); if (matches.length !== 1) return fail();
    const level = matches[0];
    if (!(await this.#taskIds(level.level_number,signal)).includes(taskId)) throw Object.assign(new Error('Task ID is absent from this level. Read tasks first; create a new task with write_level_content(resource=tasks), or use an observed task_id for update_task.'),{code:'task-not-found',details:{gameId:this.metadata.binding.gameId,levelId,taskId,nextTool:'encounter_read_level_content',resource:'tasks',retrySameInput:false}});
    const path = `/Administration/Games/TaskEdit.aspx?level=${level.level_number}&gid=${this.metadata.binding.gameId}&action=TaskEdit&tid=${taskId}`;
    const form = parseLegacyTaskForm(await this.#dispatch({kind:'task-edit-read',effect:'read',method:'GET',path},signal),this.metadata.binding,path);
    form.recipientKind=recipientKind;
    return {level,form,path,version: await revision(this.metadata.binding,levelId,level.level_number,taskId,form),preservationVersion:await legacyFormPreservationVersion(this.metadata.binding,`task:${levelId}:${taskId}`,form,['inputTask']),literalPreservationVersion:await legacyFormPreservationVersion(this.metadata.binding,`task-literal:${levelId}:${taskId}`,form,['inputTask','forMemberID','chkReplaceNlToBr'])};
  }
  async #taskIds(ordinal: number, signal?: AbortSignal): Promise<number[]> {
    const binding = this.metadata.binding, path = `/Administration/Games/LevelEditor.aspx?gid=${binding.gameId}&level=${ordinal}`;
    const root = tree(await this.#dispatch({kind:'level-editor-read',effect:'read',method:'GET',path},signal),binding,path);
    const ids = new Set<number>();
    for (const node of nodes(root).filter(node => tag(node) === 'a')) {
      const href = attr(node,'href') ?? '';
      const add = href.match(/^javascript:GameEditor\(\s*(['"])([^'"]+)\1\s*\)\s*;?$/);
      if (add && /TaskEdit\.aspx/i.test(add[2])) {
        const url = new URL(add[2],`https://${binding.domain}/Administration/Games/`);
        if (url.origin !== `https://${binding.domain}` || url.pathname !== '/Administration/Games/TaskEdit.aspx' || url.searchParams.get('gid') !== String(binding.gameId) || url.searchParams.get('level') !== String(ordinal) || [...url.searchParams.keys()].some(key => !['gid','level'].includes(key))) return fail();
        continue;
      }
      const call = href.match(/^javascript:GameEditor\(\s*(['"])([^'"]+)\1\s*,\s*(['"])Task_(\d+)_(\d+)_(\d+)\3\s*\)\s*;?$/);
      if (!call) { if (/TaskEdit\.aspx/i.test(href)) return fail(); continue; }
      const url = new URL(call[2],`https://${binding.domain}/Administration/Games/`);
      if (call[4] !== String(binding.gameId) || call[5] !== String(ordinal) || url.origin !== `https://${binding.domain}` || url.pathname !== '/Administration/Games/TaskEdit.aspx' || url.searchParams.get('gid') !== String(binding.gameId) || url.searchParams.get('level') !== String(ordinal) || url.searchParams.get('tid') !== call[6] || [...url.searchParams.keys()].some(key => !['gid','level','tid'].includes(key))) return fail();
      ids.add(positive(call[6]));
    }
    if (ids.size > 200) return fail();
    return [...ids];
  }
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    await this.#check(); const method = (init.method ?? 'GET').toUpperCase(), game = this.metadata.binding.gameId;
    const gameResponse=await this.#game.request(path,init);if(gameResponse){await this.#check();return gameResponse;}
    const extraResponse=await this.#extras.request(path,init);if(extraResponse){await this.#check();return extraResponse;}
    const fileResponse=await this.#files.request(path,init);if(fileResponse){await this.#check();return fileResponse;}
    const bonusResponse=await this.#bonuses.request(path,init);if(bonusResponse){await this.#check();return bonusResponse;}
    const sectorResponse=await this.#sectors.request(path,init);if(sectorResponse){await this.#check();return sectorResponse;}
    const answerResponse=await this.#answers.request(path,init);if(answerResponse){await this.#check();return answerResponse;}
    if (path === `/admin/games/${game}` && method === 'GET') {
      const legacyPath = `/GameDetails.aspx?gid=${game}`;
      const root = tree(await this.#dispatch({kind:'game-read',effect:'read',method:'GET',path:legacyPath},init.signal ?? undefined),this.metadata.binding,legacyPath);
      const titles = nodes(root).filter(node => tag(node) === 'a' && attr(node,'id') === 'lnkGameTitle');
      if (titles.length !== 1 || !text(titles[0]).trim() || text(titles[0]).length > 2000) return fail();
      return Response.json({game:{id:game,title:text(titles[0])}});
    }
    const editor = path.match(new RegExp(`^/admin/games/${game}/levels/([1-9]\\d*)/editor$`));
    if (editor && method === 'GET') {
      const level = (await this.#levels(init.signal ?? undefined)).find(row => row.level_id === Number(editor[1])); if (!level) return fail();
      const taskIds = await this.#taskIds(level.level_number,init.signal ?? undefined);
      const tasks = [];
      for (const id of taskIds) { const task = await this.#task(level.level_id,id,init.signal ?? undefined); tasks.push({task_id:id,task_text:task.form.text,replace_nl_to_br:task.form.replaceNewlines,...legacyRecipientFields(task.form.recipient,task.form.recipientOptions,task.form.recipientKind),_authoring_revision:task.version,_authoring_preservation:task.preservationVersion}); }
      const collections:Record<string,string>={tasks:'observed'},parts:Record<string,unknown>={};
      const partial=async(name:string,read:()=>Promise<Record<string,unknown>>)=>{try{Object.assign(parts,await read());collections[name]='observed';}catch(error){if(init.signal?.aborted||error instanceof AuthoringApiError&&error.code==='session-changed')throw error;collections[name]='unavailable';}};
      await partial('hints',()=>this.#hints.read(level.level_id,init.signal??undefined));
      await partial('answers',async()=>{const read=await this.#answers.read(level.level_id,init.signal??undefined);return {answers:read.body.answers,sectors:read.body.sectors};});
      await partial('bonuses',async()=>{const response=await this.#bonuses.request(`/admin/games/${game}/levels/${level.level_id}/bonuses`,{signal:init.signal});if(!response?.ok)return fail();const value=await response.json();if(!Array.isArray(value.bonuses))return fail();return {bonuses:value.bonuses.map((row:Record<string,unknown>)=>({...row,task:row.bonus_text,bonus_help:row.help_text,bonus_time:row.reward_seconds,negative:row.is_negative,for_member_id:row.recipient_member_id,...(row.recipient_member_id===0?{user_id:0,team_id:0}:{}),answers:Array.isArray(row.answers)?row.answers.map((answer:{answer_id:number;answer_text:string})=>answer.answer_text):fail()}))};});
      await this.#check();
      return Response.json({game_id:game,level,tasks,...parts,_authoring:{complete:false,collections,uncovered:['messages','level-settings','files','atomic-editor-version']}});
    }
    const levelOperation=await this.#levelOperations.request(path,init);
    if(levelOperation){await this.#check();return levelOperation;}
    const statistics = await this.#statistics.request(path,init);if(statistics)return statistics;
    const observed = await this.#observations.request(path,init);
    if (observed) { await this.#check(); return observed; }
    const hint = await this.#hints.request(path,init);
    if (hint) { await this.#check(); return hint; }
    const taskOperation=await this.#tasks.request(path,init);if(taskOperation){await this.#check();return taskOperation;}
    const exact = path.match(new RegExp(`^/admin/games/${game}/levels/([1-9]\\d*)/tasks/([1-9]\\d*)$`));
    if (exact && method === 'GET') {
      const task = await this.#task(positive(exact[1]),positive(exact[2]),init.signal ?? undefined);
      return Response.json({game_id:game,level:task.level,version:task.version,tasks:[{task_id:Number(exact[2]),task_text:task.form.text,replace_nl_to_br:task.form.replaceNewlines,...legacyRecipientFields(task.form.recipient,task.form.recipientOptions,task.form.recipientKind)}],_authoring_task_preservation:task.preservationVersion,_authoring_task_update:{available:true,replace_nl_to_br:task.form.replaceNewlines}});
    }
    if(exact&&method==='PUT') {
      let fields:any;try{fields=JSON.parse(String(init.body));}catch{throw new AuthoringApiError('unsupported');}
      if(!fields||typeof fields!=='object'||Object.keys(fields).some(key=>!['task_text','for_member_id','for_user_id','for_team_id','replace_nl_to_br'].includes(key))||fields.task_text!==undefined&&typeof fields.task_text!=='string'||fields.task_text===undefined&&fields.replace_nl_to_br===undefined&&!['for_member_id','for_user_id','for_team_id'].some(key=>fields[key]!==undefined)||fields.replace_nl_to_br!==undefined&&typeof fields.replace_nl_to_br!=='boolean')throw new AuthoringApiError('unsupported');
      const expected=new Headers(init.headers).get('X-Authoring-Expected-Revision');if(!expected)return new Response(null,{status:409});
      return this.request(`/admin/games/${game}/levels/${exact[1]}/apply`,{...init,method:'POST',body:JSON.stringify({base_version:expected,ops:[{entity:'task',op:'update',id:Number(exact[2]),fields:{task_text:fields.task_text,...Object.fromEntries(['for_member_id','for_user_id','for_team_id'].filter(key=>fields[key]!==undefined).map(key=>[key,fields[key]])),...(fields.replace_nl_to_br!==undefined?{replace_nl_to_br:fields.replace_nl_to_br}:{})}}]})});
    }
    const apply = path.match(new RegExp(`^/admin/games/${game}/levels/([1-9]\\d*)/apply$`));
    if (!apply || method !== 'POST' || typeof init.body !== 'string') throw new AuthoringApiError('unsupported');
    let payload: any; try { payload = JSON.parse(init.body); } catch { throw new AuthoringApiError('unsupported'); }
    const op = payload?.ops?.[0];
    if (Object.keys(payload ?? {}).some(key => !['base_version','ops'].includes(key)) || typeof payload.base_version !== 'string' || !Array.isArray(payload.ops) || payload.ops.length !== 1 || op?.entity !== 'task' || op?.op !== 'update' || !Number.isSafeInteger(op.id) || op.id < 1 || Object.keys(op).some(key => !['entity','op','id','fields'].includes(key)) || Object.keys(op.fields ?? {}).some(key=>!['task_text','for_member_id','for_user_id','for_team_id','replace_nl_to_br'].includes(key)) || !op.fields || typeof op.fields!=='object' || Array.isArray(op.fields) || op.fields.task_text!==undefined&&(typeof op.fields.task_text!=='string'||op.fields.task_text.length>100_000) || op.fields.task_text===undefined&&op.fields.replace_nl_to_br===undefined&&!['for_member_id','for_user_id','for_team_id'].some(key=>op.fields[key]!==undefined)||op.fields.replace_nl_to_br!==undefined&&typeof op.fields.replace_nl_to_br!=='boolean') throw new AuthoringApiError('unsupported');
    const levelId = positive(apply[1]), before = await this.#task(levelId,op.id,init.signal ?? undefined);
    const recipient=resolveLegacyRecipient(op.fields,before.form.recipientOptions,before.form.recipient,before.form.recipientKind);
    if (before.version !== payload.base_version) return new Response(null,{status:409});
    const desiredText=op.fields.task_text??before.form.text;
    const replaceNewlines=op.fields.replace_nl_to_br??before.form.replaceNewlines;
    if(op.fields.replace_nl_to_br!==undefined&&(before.form.controlCounts.chkReplaceNlToBr!==1||before.form.checkboxValues.chkReplaceNlToBr===undefined))throw new AuthoringApiError('unsupported');
    // Resolve stable ID -> ordinal again immediately before the single form dispatch.
    const fresh = (await this.#levels(init.signal ?? undefined)).filter(row => row.level_id === levelId);
    if (fresh.length !== 1 || fresh[0].level_number !== before.level.level_number) return new Response(null,{status:409});
    const controls = before.form.controls.filter(([name])=>name!=='chkReplaceNlToBr'||op.fields.replace_nl_to_br===undefined).map(([name,value]):[string,string] => [name,name === 'inputTask' ? desiredText : name==='forMemberID'?String(recipient):value]);
    if(op.fields.replace_nl_to_br===true)controls.push(['chkReplaceNlToBr',before.form.checkboxValues.chkReplaceNlToBr]);
    const body = new URLSearchParams(controls.map(([name,value]) => [name,value.replace(/\r\n|\r|\n/g,'\r\n')])).toString();
    let uncertainAcknowledgment = false;
    try { await this.#dispatch({kind:'task-update',effect:'mutation',method:'POST',path:before.path,body},init.signal ?? undefined); }
    catch { uncertainAcknowledgment = true; }
    try {
      // A redirect/network error can follow a successful legacy write. Read safely,
      // without repeating the mutation, and retain unknown if verification fails.
      const after = await this.#task(levelId,op.id,init.signal ?? undefined);
      if (after.form.text !== legacyText(desiredText) || after.form.recipient !== recipient || after.form.replaceNewlines !== replaceNewlines || after.level.level_number !== before.level.level_number || !legacyFormPreserved(before.form,after.form,['inputTask','forMemberID',...(op.fields.replace_nl_to_br!==undefined?['chkReplaceNlToBr']:[])])) throw new AuthoringApiError('unknown-after-dispatch');
      return Response.json({version:after.version,results:[{index:0,status:'ok',id:op.id}],warnings:['legacy-no-server-cas',...(uncertainAcknowledgment ? ['legacy-dispatch-acknowledgment-unknown-state-verified'] : [])]});
    } catch { throw new AuthoringApiError('unknown-after-dispatch'); }
  }
}
