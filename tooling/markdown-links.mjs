import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
// Preserve offsets while excluding fenced examples from link discovery.
export function prose(text) {
  let fence;
  return text.split(/(?<=\n)/).map(line => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && !fence) { fence = marker; return line.replace(/[^\r\n]/g, ' '); }
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      return line.replace(/[^\r\n]/g, ' ');
    }
    return line;
  }).join('');
}
export function markdownLinks(text) {
  const body = prose(text), links = [];
  const patterns = [/\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g,
    /^ {0,3}\[[^\]\n]+\]:\s*(?:<([^>]+)>|([^\s]+))/gm, /<(https?:\/\/[^>\s]+)>/g];
  for (const pattern of patterns) for (const match of body.matchAll(pattern)) {
    const url = match[1] ?? match[2];
    const start = match.index + match[0].indexOf(url);
    links.push({url, start, end: start + url.length});
  }
  return links.sort((a,b) => a.start-b.start);
}
export function markdownAnchors(text) {
  const body = prose(text), ids = new Set(), counts = new Map();
  for (const match of body.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) ids.add(match[1]);
  for (const match of body.matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const slug = match[1].replace(/<[^>]*>/g,'').toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu,'').replace(/ /g,'-');
    let id=slug, n=counts.get(slug) ?? 0;
    while(ids.has(id)) id=slug+'-'+(++n);
    counts.set(slug,n); ids.add(id);
  }
  return ids;
}
export async function validateMarkdown(file, boundary) {
  const text=await readFile(file,'utf8'), links=markdownLinks(text), external=[];
  const body=prose(text);
  const label=value=>value.trim().replace(/\s+/g,' ').toLowerCase();
  const definitions=new Set([...body.matchAll(/^ {0,3}\[([^\]\n]+)\]:/gm)].map(m=>label(m[1])));
  for(const match of body.matchAll(/\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
    if(!definitions.has(label(match[2]||match[1])))throw new Error('Undefined reference in '+file+': '+match[0]);
  }
  for (const {url} of links) {
    if (/^https?:\/\//.test(url)) { external.push(url); continue; }
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) throw new Error(`Unsupported link in ${file}: ${url}`);
    const [path,fragment]=url.split('#');
    const decoded=decodeURIComponent(path), target=path ? resolve(dirname(file),decoded) : file;
    const rel=relative(boundary,target);
    if(isAbsolute(decoded)||rel==='..'||rel.startsWith('../')||rel.startsWith('..\\')||isAbsolute(rel))
      throw new Error(`Nonportable link in ${file}: ${url}`);
    if(!(await stat(target)).isFile()) throw new Error(`Link is not a file in ${file}: ${url}`);
    if(fragment && !markdownAnchors(await readFile(target,'utf8')).has(decodeURIComponent(fragment)))
      throw new Error(`Missing anchor in ${file}: ${url}`);
  }
  // These prefixes denote portable resources, not host runtime commands.
  for(const match of prose(text).matchAll(/`((?:examples|docs|references|scripts)\/[\w./-]+\.(?:json|md|py|yaml))`/g)) {
    if(!links.some(link=>link.url.split('#')[0]===match[1]))
      throw new Error(`Unlinked resource in ${file}: ${match[1]}`);
  }
  return external;
}
