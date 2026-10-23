import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderScriptPage} from '../harness/render.mjs';
test('a local shell cannot be reported as the native Encounter runtime',()=>{
 assert.throws(()=>renderScriptPage('engine','',{},null,null),/native \/preview runtime/);
});
test('EN+ snapshot no longer distributes an engine API adapter',async()=>{
 const manifest=JSON.parse(await readFile('harness/snapshot/manifest.json','utf8'));
 assert.ok(!manifest.outputs.includes('engine-api.js'));
});
