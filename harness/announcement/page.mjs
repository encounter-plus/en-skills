import {readFile} from 'node:fs/promises';
import {renderAnnouncementPage} from '../render.mjs';
export async function makeAnnouncementPage(author) {
  const [fixture,shell]=await Promise.all([readFile(new URL('./fixture.json',import.meta.url),'utf8'),readFile(new URL('./shell.html',import.meta.url),'utf8')]);
  return renderAnnouncementPage(author,JSON.parse(fixture),shell);
}
