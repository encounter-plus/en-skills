import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('announcement shell preserves author HTML without injecting gameplay APIs',()=>{
 const r=spawnSync(process.execPath,['--input-type=module','-e',`
 import assert from 'node:assert/strict';
 import {makeAnnouncementPage} from './harness/announcement/page.mjs';
 const author='<section id="author">Hello</section><script>window.synthetic=1</script>';
 const html=await makeAnnouncementPage(author);
 assert.ok(html.includes(author));
 assert.match(html,/data-announcement-host/);
 assert.match(html,/От автора игры/);
 assert.doesNotMatch(html,/engine-api.js|enplus-injected.js|window.EN\\s*=/);
 assert.match(html,/announcement-assets/);
 `],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
});
