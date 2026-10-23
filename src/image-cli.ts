#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { inspectImage, readLocalImage, transformImageFile, type ImageFormat } from './images.ts';

const help = `en-image inspect --input photo.png
 en-image convert --input photo.png --out photo-small.jpg --format jpeg [--max-width 1600] [--max-height 1600] [--quality 82] [--background '#ffffff'] [--preserve-metadata] [--detail-critical]
Local files only. Outputs are new files; nothing is uploaded. JSON stdout, JSON errors stderr.
No dimensions means keep resolution. PNG is lossless encoding; JPEG/WebP are lossy.
`;
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    input: { type: 'string' }, out: { type: 'string' }, format: { type: 'string' },
    'max-width': { type: 'string' }, 'max-height': { type: 'string' }, quality: { type: 'string' },
    background: { type: 'string' }, 'preserve-metadata': { type: 'boolean' }, 'detail-critical': { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help || !positionals.length) { process.stdout.write(help); return; }
  if (positionals.length !== 1 || !['inspect', 'convert'].includes(positionals[0])) throw new Error('Expected inspect or convert');
  if (!values.input) throw new Error('Missing --input');
  let report;
  if (positionals[0] === 'inspect') {
    if (Object.keys(values).some(key => key !== 'input')) throw new Error('inspect accepts only --input');
    report = await inspectImage(await readLocalImage(values.input));
  } else {
    if (!values.out || !values.format) throw new Error('convert requires --out and --format');
    const number = (value: string | undefined) => value === undefined ? undefined : /^\d+$/.test(value) ? Number(value) : NaN;
    report = await transformImageFile(values.input, values.out, {
      format: values.format as ImageFormat, maxWidth: number(values['max-width']), maxHeight: number(values['max-height']),
      quality: number(values.quality), background: values.background, preserveMetadata: values['preserve-metadata'], detailCritical: values['detail-critical'],
    });
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
main().catch(error => { process.stderr.write(JSON.stringify({ error: error.message }) + '\n'); process.exitCode = 1; });
