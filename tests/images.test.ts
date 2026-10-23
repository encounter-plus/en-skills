import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectImage, transformImage, transformImageFile } from '../src/images.ts';

const photo = () => sharp({ create: { width: 1200, height: 600, channels: 3, background: '#579ac1' } }).png().toBuffer();
test('image inspection reports actual bytes and oriented dimensions without claiming visual review', async () => {
  const data = await sharp(await photo()).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const info = await inspectImage(data);
  assert.equal(info.bytes, data.length); assert.equal(info.width, 600); assert.equal(info.height, 1200);
  assert.equal(info.pixelContentVerified, false);
  const result = await transformImage(data, { format: 'jpeg', maxWidth: 300, maxHeight: 300 });
  assert.equal(result.report.after.width, 150); assert.equal(result.report.after.height, 300);
  assert.equal(result.report.after.orientation, 1);
});
test('resize preserves aspect, avoids enlargement, and measures savings honestly', async () => {
  const input = await photo();
  const output = await transformImage(input, { format: 'jpeg', maxWidth: 400, maxHeight: 400 });
  assert.equal(output.report.after.width, 400); assert.equal(output.report.after.height, 200);
  assert.equal(output.report.savedBytes, input.length - output.data.length);
  assert.equal(output.report.smaller, output.data.length < input.length);
  assert.equal(output.report.applied, false); assert.equal(output.report.visualReviewRequired, true);
  const larger = await transformImage(input, { format: 'png', maxWidth: 3000 });
  assert.equal(larger.report.after.width, 1200);
  const originalSize = await transformImage(input, { format: 'webp' });
  assert.equal(originalSize.report.after.width, 1200);
});
test('transparency is preserved or flattened only onto explicit JPEG background', async () => {
  const input = await sharp({ create: { width: 20, height: 10, channels: 4, background: '#ff000080' } }).png().toBuffer();
  await assert.rejects(transformImage(input, { format: 'jpeg' }), /transparency/);
  const png = await transformImage(input, { format: 'png' });
  assert.equal(png.report.after.hasAlpha, true);
  assert.deepEqual(await sharp(png.data).raw().toBuffer(), await sharp(input).raw().toBuffer());
  const webp = await transformImage(input, { format: 'webp' }); assert.equal(webp.report.after.hasAlpha, true);
  const jpg = await transformImage(input, { format: 'jpeg', background: '#ffffff' });
  assert.equal(jpg.report.after.hasAlpha, false);
});
test('detail-critical, animation, corrupt data and bad parameters are not silently converted', async () => {
  const input = await photo();
  await assert.rejects(transformImage(input, { format: 'jpeg', detailCritical: true }), /Detail-critical/);
  for (const opts of [{ format: 'png', quality: 82 }, { format: 'jpeg', maxWidth: 0 }, { format: 'webp', quality: 101 }]) {
    await assert.rejects(transformImage(input, opts as Parameters<typeof transformImage>[1]));
  }
  await assert.rejects(inspectImage(Buffer.from('not an image')));
  const frame = '2c0000000001000100000202440100';
  const animated = Buffer.from('47494638396101000100800000000000ffffff' + frame + frame + '3b', 'hex');
  assert.equal((await inspectImage(animated)).pages, 2);
  await assert.rejects(transformImage(animated, { format: 'png' }), /Multi-frame/);
});
test('metadata retention is explicit and larger output is reported', async () => {
  const input = await sharp(await photo()).jpeg({ quality: 20 }).withMetadata().toBuffer();
  const kept = await transformImage(input, { format: 'png', preserveMetadata: true });
  assert.equal(kept.report.after.hasMetadata, true);
  const stripped = await transformImage(input, { format: 'png' });
  assert.equal(stripped.report.after.hasMetadata, false);
  assert.ok(stripped.report.warnings.some(s => s.includes('Metadata removed')));
  const tiny = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'red' } }).png().toBuffer();
  const larger = await transformImage(tiny, { format: 'jpeg' });
  assert.equal(larger.report.smaller, false);
  assert.ok(larger.report.warnings.some(s => s.includes('not smaller')));
});
test('file and CLI operations preserve originals, reject overwrites and validate output format', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'en-images-'));
  try {
    const input = join(dir, 'original.png'), output = join(dir, 'small.jpg'), bytes = await photo();
    await writeFile(input, bytes);
    await assert.rejects(transformImageFile(input, input, { format: 'png' }), /differ/);
    await assert.rejects(transformImageFile(input, output, { format: 'png' }), /extension/);
    const cli = new URL('../src/image-cli.ts', import.meta.url);
    const { fileURLToPath } = await import('node:url');
    const result = spawnSync(process.execPath, [fileURLToPath(cli), 'convert', '--input', input, '--out', output, '--format', 'jpeg', '--max-width', '300'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).after.width, 300);
    const saved = await readFile(output);
    await assert.rejects(transformImageFile(input, output, { format: 'jpeg' }), /EEXIST/);
    assert.deepEqual(await readFile(output), saved); assert.deepEqual(await readFile(input), bytes);
    const inspect = spawnSync(process.execPath, [fileURLToPath(cli), 'inspect', '--input', input], { encoding: 'utf8' });
    assert.equal(inspect.status, 0, inspect.stderr); assert.equal(JSON.parse(inspect.stdout).bytes, bytes.length);
    const invalid = spawnSync(process.execPath, [fileURLToPath(cli), 'inspect', '--input', input, '--quality', '70'], { encoding: 'utf8' });
    assert.equal(invalid.status, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
