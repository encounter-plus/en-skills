import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSheetContext, createSheetImport, prepareSheetImport, validateSheetImport, validateSheetProposal } from '../src/sheet-import.ts';
import type { SheetMappingEntry, SheetMappingProposal } from '../src/sheet-import.ts';
import type { SheetTable } from '../src/sheet-table.ts';

const table: SheetTable = { source: { kind: 'google', spreadsheetId: 'test_spreadsheet_123', sheet: 'Tasks', range: 'B7:D9', startRow: 7, startColumn: 2 }, rows: [['Level 01', '001;002', '00:05'], ['<b>Task</b>\nline', 'Hint', 'Penalty'], ['Bonus', 'Sector', 'Comment']] };
function entry(overrides: Partial<SheetMappingEntry> = {}): SheetMappingEntry {
  return { id: 'item1', entity: 'task', group: 'Level 01', field: 'task text', cells: ['B8'], value: '<b>Task</b>\nline', note: '', ...overrides };
}
function proposal(entries = [entry()]): SheetMappingProposal { return { entries, issues: [] }; }

test('arbitrary cells form semantic entries across rows and columns with shared references', () => {
  const input = proposal([entry(), entry({id:'item2',entity:'penalty_hint',cells:['C8','D8'],field:'penalty hint',value:'Hint\nPenalty'}),entry({id:'item3',entity:'level',cells:['D7'],field:'time limit',value:'00:05'}),entry({id:'item4',entity:'answer',cells:['C7','B8'],field:'codes',value:'001;002'})]);
  assert.deepEqual(validateSheetProposal(input, table), input);
  const prepared = prepareSheetImport({...createSheetImport(table), proposal: input});
  assert.deepEqual(prepared.draft, input);
  assert.notEqual(prepared.draft, prepared.proposal);
  assert.equal(prepared.draft!.entries[3].value, '001;002');
});

test('incomplete model interpretations are retained for review but cannot be prepared', () => {
  const uncertain = proposal([entry({group:'',field:'',cells:[]})]);
  uncertain.issues.push('Target level unclear');
  assert.deepEqual(validateSheetProposal(uncertain, table), uncertain);
  assert.throws(() => prepareSheetImport({table,proposal:uncertain}));
  assert.throws(() => prepareSheetImport({table}));
  assert.throws(() => prepareSheetImport({table,proposal:proposal([])}));
  const unresolved = {table,proposal:{...proposal(),issues:['Check penalty units']}};
  assert.deepEqual(prepareSheetImport(unresolved).draft!.issues, ['Check penalty units']);
});

test('blank literal values require an explanatory note for preparation and never imply deletion', () => {
  assert.throws(() => prepareSheetImport({table,proposal:proposal([entry({value:''})])}));
  const result = prepareSheetImport({table,proposal:proposal([entry({value:'',note:'Blank source; no deletion intended'})])});
  assert.equal(result.draft!.entries[0].value, '');
});

test('cell references must be explicit absolute A1 cells inside the loaded table', () => {
  for (const cells of [['A7'],['B6'],['E7'],['B10'],['B7:C8'],['Sheet!B7'],['$B$7'],['b7'],['B07']]) assert.throws(() => validateSheetProposal(proposal([entry({cells})]),table));
  const offset = {...table,source:{...table.source,kind:'google' as const,spreadsheetId:'test_spreadsheet_123',sheet:'Tasks',range:'AA12:AC14',startRow:12,startColumn:27}};
  assert.deepEqual(validateSheetProposal(proposal([entry({cells:['AA12','AC14']})]),offset).entries[0].cells,['AA12','AC14']);
});

test('sanitizes unknown persisted fields and invalidates a draft after proposal edits', () => {
  const original = prepareSheetImport({table,proposal:proposal()});
  const changed = {...original,proposal:proposal([entry({value:'Edited'})]),token:'SECRET'};
  const clean = validateSheetImport(changed);
  assert.equal(clean.draft,undefined);
  assert.equal(JSON.stringify(clean).includes('SECRET'),false);
  assert.deepEqual(validateSheetImport(original),original);
  assert.equal(validateSheetImport({table,draft:proposal()}).draft,undefined);
  const secretProposal = {...proposal(),token:'SECRET',entries:[{...entry(),token:'SECRET'}]};
  assert.equal(JSON.stringify(validateSheetProposal(secretProposal,table)).includes('SECRET'),false);
});

test('rejects invalid persisted shapes and all proposal resource caps', () => {
  for (const invalid of [null,{},[],{entries:[],issues:'bad'},{entries:[entry({entity:'unknown' as never})],issues:[]},proposal([entry(),entry()]),proposal([entry({cells:Array(21).fill('B7')})]),proposal([entry({value:'x'.repeat(12001)})]),proposal([entry({field:'x'.repeat(81)})]),proposal([entry({group:'x'.repeat(81)})]),proposal([entry({note:'x'.repeat(1001)})]),{entries:[],issues:['x'.repeat(501)]},{entries:[],issues:Array(31).fill('issue')},proposal(Array.from({length:101},(_,i)=>entry({id:String(i)}))),proposal(Array.from({length:5},(_,i)=>entry({id:String(i),value:'x'.repeat(11000)})))]) assert.throws(()=>validateSheetProposal(invalid,table));
  assert.throws(()=>validateSheetImport({table:{rows:[[123]],source:{}}}));
});

test('model context includes arbitrary raw cells with safe draft-only interpretation instructions', () => {
  const context = JSON.parse(buildSheetContext({table}));
  assert.deepEqual(context.table.rows,table.rows);
  assert.deepEqual(context.table.source,table.source);
  assert.equal(context.untrustedData,true);
  assert.equal(context.draftOnly,true);
  assert.ok(context.policy.includes('draft-only'));
  assert.ok(context.policy.includes('instructions'));
  assert.ok(context.policy.includes('deletion'));
});

test('model context rejects oversize without silently truncating exact cell values', () => {
  const longTable:SheetTable={source:{kind:'file',filename:'tasks.csv',startRow:1,startColumn:1},rows:[['x'.repeat(60000)]]};
  assert.throws(()=>buildSheetContext({table:longTable}),/limit/);
  longTable.rows=[['001\n'+ 'x'.repeat(19000)]];
  assert.equal(JSON.parse(buildSheetContext({table:longTable})).table.rows[0][0],longTable.rows[0][0]);
});

 test('valid literal mapping remains available for subsequent model refinement', () => {
  const table: SheetTable = {source:{kind:'file',filename:'long.csv',startRow:1,startColumn:1},rows:[['x'.repeat(12000)]]};
  const value = {table,proposal:proposal([entry({cells:['A1'],value:table.rows[0][0]})])};
  const context = JSON.parse(buildSheetContext(value));
  assert.equal(context.proposal.entries[0].value, context.table.rows[0][0]);
 });
