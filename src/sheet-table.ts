export interface GoogleSheetSource {
  kind: 'google'; spreadsheetId: string; sheet: string; range: string;
  startRow: number; startColumn: number; title?: string;
}
export interface FileSheetSource { kind: 'file'; filename: string; startRow: 1; startColumn: 1 }
export interface SheetTable { source: GoogleSheetSource | FileSheetSource; rows: string[][] }
export interface SpreadsheetMetadata { id: string; title: string; sheets: { id: number; title: string }[] }
export class SheetsError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, status?: number) {
    super(`Sheets: ${code}`); this.name = 'SheetsError'; this.code = code; this.status = status;
  }
}
const fail = (code = 'invalid_data'): never => { throw new SheetsError(code); };
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
};
function text(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u001f]/.test(value)) return fail();
  return value;
}
function spreadsheetId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(value)) return fail('invalid_spreadsheet');
  return value;
}
export function parseGoogleSheetUrl(input: string): { spreadsheetId: string; gid?: number } {
  // Check the raw authority too: URL normalizes away an explicit default port.
  if (!/^https:\/\/docs\.google\.com\//.test(input)) return fail('invalid_url');
  let url: URL;
  try { url = new URL(input); } catch { return fail('invalid_url'); }
  const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{10,200})(?:\/.*)?$/.exec(url.pathname);
  if (!match || url.origin !== 'https://docs.google.com' || url.username || url.password || url.port) return fail('invalid_url');
  const gidText = new URLSearchParams(url.hash.slice(1)).get('gid') ?? url.searchParams.get('gid');
  const result: { spreadsheetId: string; gid?: number } = { spreadsheetId: match[1] };
  if (gidText !== null) {
    if (!/^\d+$/.test(gidText) || !Number.isSafeInteger(Number(gidText))) return fail('invalid_gid');
    result.gid = Number(gidText);
  }
  return result;
}
export function rectangle(value: unknown) {
  if (typeof value !== 'string') return fail('invalid_range');
  const match = /^([A-Z]{1,3})([1-9]\d*):([A-Z]{1,3})([1-9]\d*)$/.exec(value.trim().toUpperCase());
  if (!match) return fail('invalid_range');
  const startRow = Number(match[2]), endRow = Number(match[4]);
  const columnNumber = (letters: string) => [...letters].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0);
  const startColumn = columnNumber(match[1]), endColumn = columnNumber(match[3]);
  const height = endRow - startRow + 1, width = endColumn - startColumn + 1;
  if (!Number.isSafeInteger(endRow) || !Number.isSafeInteger(startRow) || height < 1 || width < 1 || width > 26 || height > 500 || height * width > 5000) return fail('invalid_range');
  return { range: `${match[1]}${startRow}:${match[3]}${endRow}`, startRow, startColumn, height, width };
}
function cleanRows(value: unknown, maxRows = 500, maxColumns = 26): string[][] {
  if (!Array.isArray(value) || value.length > maxRows) return fail('table_limit');
  let width = 0;
  const rows = value.map(row => {
    if (!Array.isArray(row) || row.length > maxColumns || row.some(cell => typeof cell !== 'string')) return fail();
    width = Math.max(width, row.length);
    return [...row] as string[];
  });
  if (rows.length * width > 5000) return fail('table_limit');
  while (rows.length && rows.at(-1)!.every(cell => cell === '')) rows.pop();
  return rows.map(row => [...row, ...Array<string>(width - row.length).fill('')]);
}
export function validateSheetTable(value: unknown): SheetTable {
  const input = record(value), raw = record(input.source);
  let source: SheetTable['source'];
  let rows: string[][];
  if (raw.kind === 'google') {
    const rect = rectangle(raw.range);
    if (raw.startRow !== rect.startRow || raw.startColumn !== rect.startColumn) return fail();
    source = { kind: 'google', spreadsheetId: spreadsheetId(raw.spreadsheetId), sheet: text(raw.sheet,100), range: rect.range, startRow: rect.startRow, startColumn: rect.startColumn };
    if (raw.title !== undefined) source.title = text(raw.title,1000);
    rows = cleanRows(input.rows, rect.height, rect.width);
  } else if (raw.kind === 'file') {
    if (raw.startRow !== 1 || raw.startColumn !== 1) return fail();
    source = {kind:'file',filename:text(raw.filename,255),startRow:1,startColumn:1};
    rows = cleanRows(input.rows);
  } else return fail();
  const table = {source,rows};
  if (JSON.stringify(table).length > 60_000) return fail('table_limit');
  return table;
}
export function parseDelimited(input: string, delimiter: ',' | '\t', filename: string): SheetTable {
  if (typeof input !== 'string' || input.length > 2_097_152 || ![',','\t'].includes(delimiter)) return fail('table_limit');
  const value = input.replace(/^\uFEFF/,'');
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false;
  const pushCell = () => {row.push(cell); cell=''; closed=false; if(row.length>26) fail('table_limit');};
  const pushRow = () => {pushCell();rows.push(row);row=[];if(rows.length>500) fail('table_limit');};
  for(let i=0;i<value.length;i++) {
    const char = value[i];
    if(quoted) {
      if(char === '"') { if(value[i+1] === '"') {cell+='"';i++;} else {quoted=false;closed=true;} }
      else cell+=char;
    } else if(char === delimiter) pushCell();
    else if(char === '\r' || char === '\n') {if(char==='\r' && value[i+1]==='\n') i++;pushRow();}
    else if(char === '"' && cell === '' && !closed) quoted=true;
    else {if(closed || char === '"') fail('invalid_delimited');cell+=char;}
  }
  if(quoted) return fail('invalid_delimited');
  if(cell.length || row.length || closed) pushRow();
  return validateSheetTable({source:{kind:'file',filename,startRow:1,startColumn:1},rows});
}
