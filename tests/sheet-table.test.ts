import test from 'node:test';
import assert from 'node:assert/strict';
import { SheetsError, parseGoogleSheetUrl, parseDelimited, validateSheetTable } from '../src/sheet-table.ts';

const id = 'test_spreadsheet_123';
test('Google URL parser accepts only exact trusted sheet URLs and extracts gid', () => {
  assert.deepEqual(parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing#gid=42`), { spreadsheetId: id, gid: 42 });
  for (const url of [`https://evil.test/spreadsheets/d/${id}`, `https://docs.google.com:443/spreadsheets/d/${id}`, `https://me@docs.google.com/spreadsheets/d/${id}`, `http://docs.google.com/spreadsheets/d/${id}`, `https://docs.google.com/spreadsheets/d/${id}%2Fedit`]) assert.throws(() => parseGoogleSheetUrl(url), SheetsError);
});
test('CSV and TSV preserve quotes, embedded newlines, formulas, leading zeros and empty rows', () => {
  const table = parseDelimited('\uFEFFcode,name\r\n001,"a,""b""\nnext"\r\n,\r\n=1+2,end\r\n', ',', 'sample.csv');
  assert.deepEqual(table.rows, [['code','name'], ['001','a,"b"\nnext'],['',''],['=1+2','end']]);
  assert.deepEqual(parseDelimited('01\t0\n', '\t', 'x.tsv').rows, [['01','0']]);
  assert.throws(() => parseDelimited('"unfinished', ',', 'x.csv'), SheetsError);
  assert.throws(() => parseDelimited('a'.repeat(60_001), ',', 'x.csv'), SheetsError);
  assert.throws(() => parseDelimited(Array(502).fill('x').join('\n'), ',', 'x.csv'), SheetsError);
});
test('table validation strips unrecognized metadata and rejects invalid provenance or oversized cells', () => {
  const value = {source:{kind:'file',filename:'x.csv',startRow:1,startColumn:1,token:'private-secret'},rows:[['001']],secret:'private-secret'};
  assert.equal(JSON.stringify(validateSheetTable(value)).includes('private-secret'),false);
  assert.throws(()=>validateSheetTable({...value,rows:[[23]]}),SheetsError);
  assert.throws(()=>validateSheetTable({...value,source:{...value.source,startRow:2}}),SheetsError);
});
