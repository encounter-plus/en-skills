import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

test('browser recalculation bundle stays below 200 KB without unused SDK APIs', async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/recalculation-browser.ts', import.meta.url))],
    bundle: true, platform: 'browser', target: 'es2022', format: 'esm',
    minify: true, legalComments: 'none', write: false,
  });
  const bytes = result.outputFiles[0]!.contents.byteLength;
  assert.ok(bytes < 200_000, `Recalculation bundle is ${bytes} bytes; budget is 200,000`);
});
