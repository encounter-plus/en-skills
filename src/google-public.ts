import { parse, defaultTreeAdapter as tree } from 'parse5';
import { parsePublicWorkbook } from './google-workbook.ts';
export const GOOGLE_SHARING_PROMPT = 'Откройте документ → Настройки доступа → Общий доступ → Все, у кого есть ссылка → Читатель. Нажмите «Готово» и пришлите ссылку повторно. Если доступ уже открыт, проверьте, разрешено ли читателям скачивание.';
export class GooglePublicAccessError extends Error {
  constructor() { super('Документ недоступен для чтения без входа. ' + GOOGLE_SHARING_PROMPT); this.name = 'GooglePublicAccessError'; }
}
export interface PublicGoogleSnapshot {
  schemaVersion: 1; source: 'google-docs-public' | 'google-sheets-public'; sourceId: string;
  sourceUrl: string; capturedAt: string; selection: string | null;
  format: 'text' | 'csv'; text: string; rows?: string[][]; limitations: string[];
  workbook?: ReturnType<typeof parsePublicWorkbook>;
}
export function publicGoogleLink(link: string) {
  const url = new URL(link);
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.port || url.username || url.password)
    throw new Error('Expected an HTTPS docs.google.com document or spreadsheet link');
  const match = /^\/(document|spreadsheets)\/d\/([A-Za-z0-9_-]+)(?:\/(?:edit|view|preview|export))?\/?$/.exec(url.pathname);
  if (!match || match[2] === 'e') throw new Error('Expected a regular Google sharing link: https://docs.google.com/spreadsheets/d/<id>/edit?gid=<numeric-sheet-id> (or /document/d/<id>/edit). gviz/tq and pubhtml are not supported; use the original sharing link and discover the sheet gid. Do not retry the same URL.');
  const kind = match[1], id = match[2];
  const fragment = new URLSearchParams(url.hash.slice(1));
  const selection = url.searchParams.get(kind === 'document' ? 'tab' : 'gid') ??
    fragment.get(kind === 'document' ? 'tab' : 'gid');
  if (selection !== null && !(kind === 'document' ? /^[A-Za-z0-9_.-]+$/ : /^\d+$/).test(selection))
    throw new Error('Invalid tab or sheet ID');
  const exportUrl = new URL(`https://docs.google.com/${kind}/d/${id}/export`);
  exportUrl.searchParams.set('format', kind === 'document' ? 'txt' : 'csv');
  if (selection !== null) exportUrl.searchParams.set(kind === 'document' ? 'tab' : 'gid', selection);
  const key = url.searchParams.get('resourcekey');
  if (key) {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error('Invalid resource key');
    exportUrl.searchParams.set('resourcekey', key);
  }
  return { kind, id, selection, exportUrl };
}
/** RFC-style CSV parsing with literal strings; never number-coerce answer codes. */
export function parsePublicCsv(text: string): string[][] {
  if (!text.length) return [];
  const rows: string[][] = []; let row: string[] = [], value = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i+1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } }
      else value += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(value); value = ''; closed = false;
      if (c !== ',') { rows.push(row); row = []; if (c === '\r' && text[i+1] === '\n') i++; }
    } else if (c === '"' && !value && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error('Malformed CSV export'); value += c; }
  }
  if (quoted) throw new Error('Unterminated CSV field');
  if (row.length || value || closed || text.endsWith(',')) { row.push(value); rows.push(row); }
  return rows;
}
export class PublicGoogleSources {
  /** Discover real tab IDs from public navigation, then fetch every discovered part. */
  async readAll(link:string) {
    const parsed=publicGoogleLink(link),parts: {id:string;name:string;url:string}[]=[];
    const limitations:string[]=[];
    if(parsed.kind==='spreadsheets')try {
      const exported=await this.read(link,false,true),sheets=exported.workbook!;
      const results=sheets.map(sheet=>({id:sheet.id,name:sheet.name,status:'read' as const,error:undefined,snapshot:{...exported,workbook:undefined,selection:sheet.id,rows:sheet.rows,text:JSON.stringify(sheet),limitations:sheet.limitations},hidden:sheet.hidden,hasDrawing:sheet.hasDrawing}));
      return {schemaVersion:1,sourceId:parsed.id,sourceUrl:link,parts:results,coverage:{inventoryVerified:true,discovered:results.length,read:results.length,allDiscoveredPartsRead:true,complete:false},limitations:['All exported workbook sheets, including hidden sheets, are retained. IDs here are workbook sheet IDs, not Google gid.','Cell values, cached formulas, number-format metadata, merges and hidden state are retained. Drawings are flagged but image contents and visual formatting have not been inspected.']};
    }catch {limitations.push('Whole-workbook export unavailable or unsupported; falling back to public tab navigation.');}
    let inventoryVerified=false;
    try {
      const inventory=await this.read(link,true),document=parse(inventory.text);
      const visit=(node:any)=>{
        if(tree.isElementNode(node)) {
          const attrs=Object.fromEntries(node.attrs.map((attr:any)=>[attr.name,attr.value]));
          const text=(value:any):string=>tree.isTextNode(value)?value.value:(value.childNodes??[]).map(text).join('');
          let id:string|undefined;
          if(parsed.kind==='spreadsheets')id=/^sheet-button-(\d+)$/.exec(attrs.id??'')?.[1];
          if(attrs.href)try{const candidate=publicGoogleLink(new URL(attrs.href,link).href);if(candidate.id===parsed.id&&candidate.kind===parsed.kind&&candidate.selection!==null)id=candidate.selection;}catch{/* Ignore unrelated navigation. */}
          if(id&&!parts.some(part=>part.id===id)) {
            const url=new URL(parsed.exportUrl);url.pathname=url.pathname.replace(/export$/,'edit');url.searchParams.delete('format');url.searchParams.set(parsed.kind==='spreadsheets'?'gid':'tab',id);
            parts.push({id,name:text(node).trim()||id,url:url.href});
          }
        }
        for(const child of node.childNodes??[])visit(child);
      };visit(document);
      // Google htmlview currently embeds its navigation as literal items.push data.
      // Decode only strings; never execute the page script or follow arbitrary URLs.
      if(parsed.kind==='spreadsheets')for(const match of inventory.text.matchAll(/items\.push\(\{name:\s*("(?:\\.|[^"\\])*"),\s*pageUrl:\s*("(?:\\.|[^"\\])*"),\s*gid:\s*"(\d+)"/g)) {
        try {
          const decode=(literal:string):string=>JSON.parse(literal.replace(/\\x([\da-f]{2})/gi,(_,hex:string)=>'\\u00'+hex));
          const name=decode(match[1]),observed=new URL(decode(match[2])),id=match[3];
          if(observed.origin!=='https://docs.google.com'||observed.pathname!==`/spreadsheets/d/${parsed.id}/htmlview/sheet`||observed.searchParams.get('gid')!==id||parts.some(part=>part.id===id))continue;
          const url=new URL(parsed.exportUrl);url.pathname=url.pathname.replace(/export$/,'edit');url.searchParams.delete('format');url.searchParams.set('gid',id);
          parts.push({id,name,url:url.href});
        }catch{/* Unsupported navigation literal remains a coverage limitation. */}
      }
      inventoryVerified=parts.length>0;
    }catch {limitations.push('Public tab inventory unavailable; selected-part fallback is not full-document coverage.');}
    if(!parts.length)parts.push({id:parsed.selection??'default',name:'Selected/default part',url:link});
    const results: {id:string;name:string;status:'read'|'failed';snapshot?:PublicGoogleSnapshot;error?:string}[]=[];
    let total=0;
    for(const part of parts.slice(0,100)) {
      if(total>=20_000_000){results.push({id:part.id,name:part.name,status:'failed',error:'aggregate_size_limit'});continue;}
      try {const snapshot=await this.read(part.url);total+=snapshot.text.length;results.push({id:part.id,name:part.name,status:'read',snapshot});}
      catch(error){results.push({id:part.id,name:part.name,status:'failed',error:error instanceof GooglePublicAccessError?'public_access_required':'public_read_failed'});}
    }
    return {schemaVersion:1,sourceId:parsed.id,sourceUrl:link,parts:results,coverage:{inventoryVerified,discovered:parts.length,read:results.filter(part=>part.status==='read').length,allDiscoveredPartsRead:inventoryVerified&&parts.length<=100&&results.every(part=>part.status==='read'),complete:false},limitations:[...limitations,'Public navigation may omit hidden or inaccessible tabs. Full original-document coverage is not certified.','Text/CSV exports omit formatting, formulas, images and attachments. Preserve these as unresolved coverage, not empty content.']};
  }
  #fetch: typeof fetch;
  #browserRedirects: boolean;
  constructor(options: { fetch?: typeof fetch; browserRedirects?: boolean } = {}) {
    this.#fetch = options.fetch ?? fetch;
    // Browser Fetch hides manual redirects as opaqueredirect. Public, credential-free
    // exports may follow them, then validate the final origin before accepting bytes.
    this.#browserRedirects = options.browserRedirects === true;
  }
  async read(link: string, inventory = false, workbook = false): Promise<PublicGoogleSnapshot> {
    const parsed = publicGoogleLink(link);
    let url = parsed.exportUrl;
    if(workbook){url.searchParams.set('format','xlsx');url.searchParams.delete('gid');}
    if(inventory){url=new URL(parsed.exportUrl);url.pathname=url.pathname.replace(/export$/,parsed.kind==='spreadsheets'?'htmlview':'edit');url.searchParams.delete('format');url.searchParams.delete('gid');url.searchParams.delete('tab');}
    const signal = AbortSignal.timeout(30_000);
    for (let redirects = 0; redirects <= 5; redirects++) {
      let response: Response;
      try { response = await this.#fetch(url.toString(), { credentials: 'omit', redirect: this.#browserRedirects?'follow':'manual', referrerPolicy:'no-referrer', signal }); }
      catch { throw new Error('Google public export transport failed; retry later'); }
      if(this.#browserRedirects) {
        const final=new URL(response.url);
        if(final.hostname==='accounts.google.com'){await response.body?.cancel();throw new GooglePublicAccessError();}
        if(final.protocol!=='https:'||final.port||final.username||final.password||!(final.hostname==='docs.google.com'||final.hostname.endsWith('.googleusercontent.com'))){await response.body?.cancel();throw new Error('Unexpected Google export redirect');}
      }
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('Google export redirect has no destination');
        const next = new URL(location,url);
        if (next.hostname === 'accounts.google.com') throw new GooglePublicAccessError();
        if (next.protocol !== 'https:' || next.port || next.username || next.password ||
            !(next.hostname === 'docs.google.com' || next.hostname.endsWith('.googleusercontent.com')))
          throw new Error('Unexpected Google export redirect');
        url = next; continue;
      }
      if ([401,403].includes(response.status)) { await response.body?.cancel(); throw new GooglePublicAccessError(); }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Google public export failed (HTTP ${response.status}); verify link or retry later`); }
      const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (type === 'text/html' && !inventory) { await response.body?.cancel(); throw new GooglePublicAccessError(); }
      if (!['text/plain','text/csv','application/csv','application/octet-stream',...(workbook?['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/zip']:[]),...(inventory?['text/html']:[])].includes(type)) {
        await response.body?.cancel(); throw new Error('Unexpected Google export content type');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Missing Google export body');
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.byteLength; if (size > (workbook ? 40 : 10) * 1024 * 1024) throw new Error(workbook ? 'Public export exceeds 40 MiB' : 'Public export exceeds 10 MiB');
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      if(workbook)return {schemaVersion:1,source:'google-sheets-public',sourceId:parsed.id,sourceUrl:link,capturedAt:new Date().toISOString(),selection:null,format:'text',text:'',limitations:[],workbook:parsePublicWorkbook(bytes)};
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!inventory && /^\s*(?:<!doctype\s+html|<html\b)/i.test(text)) throw new GooglePublicAccessError();
      const sheet = !inventory && parsed.kind === 'spreadsheets';
      return { schemaVersion: 1, source: sheet ? 'google-sheets-public' : 'google-docs-public',
        sourceId: parsed.id, sourceUrl: link, capturedAt: new Date().toISOString(), selection: parsed.selection,
        format: sheet ? 'csv' : 'text', text, ...(sheet ? { rows: parsePublicCsv(text) } : {}),
        limitations: sheet ? ['Only the selected sheet (first sheet if gid is absent).', 'CSV has no formulas, formatting or attachments.'] :
          ['Text export does not preserve layout, table structure or attachments.', 'Completeness across document tabs is not verified; provide separate tab links and verify coverage.'] };
    }
    throw new Error('Too many Google export redirects');
  }
}
