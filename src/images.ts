import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { open, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

export const IMAGE_LIMITS = { bytes: 50 * 1024 * 1024, pixels: 60_000_000 } as const;
export type ImageFormat = 'jpeg' | 'png' | 'webp';
export interface ImageOptions {
  format: ImageFormat;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  background?: string;
  preserveMetadata?: boolean;
  detailCritical?: boolean;
}
function checked(input: Uint8Array): Buffer {
  if (!input.byteLength || input.byteLength > IMAGE_LIMITS.bytes) throw new Error('Image must be 1 byte to 50 MiB');
  return Buffer.from(input);
}
function decoder(input: Buffer) {
  return sharp(input, { limitInputPixels: IMAGE_LIMITS.pixels, failOn: 'warning' });
}
export async function inspectImage(input: Uint8Array) {
  const bytes = checked(input), meta = await decoder(bytes).metadata();
  if (!['jpeg', 'png', 'webp', 'gif', 'tiff', 'avif', 'heif'].includes(meta.format ?? '') || !meta.width || !meta.height) {
    throw new Error('Unsupported raster image');
  }
  const swaps = [5, 6, 7, 8].includes(meta.orientation ?? 1);
  const width = swaps ? meta.height : meta.width, height = swaps ? meta.width : meta.height;
  const pages = meta.pages ?? 1;
  return {
    format: meta.format, bytes: bytes.length, width, height, pages,
    hasAlpha: meta.hasAlpha ?? false, orientation: meta.orientation ?? 1,
    hasMetadata: !!(meta.exif || meta.icc || meta.iptc || meta.xmp),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    reviewSuggested: bytes.length > 500 * 1024 || Math.max(width, height) > 1920,
    warnings: [
      ...(pages > 1 ? ['Multi-frame/page image: conversion is not supported; preserve all frames.'] : []),
      ...(bytes.length > 500 * 1024 ? ['Heavy image for weak mobile connectivity; review purpose before compression.'] : []),
      ...(Math.max(width, height) > 1920 ? ['High resolution: check whether fine details are part of the puzzle.'] : []),
    ],
    pixelContentVerified: false,
  };
}
function validateOptions(options: ImageOptions) {
  const allowed = ['format', 'maxWidth', 'maxHeight', 'quality', 'background', 'preserveMetadata', 'detailCritical'];
  if (!options || Object.keys(options).some(key => !allowed.includes(key))) throw new Error('Unknown image option');
  if (!['jpeg', 'png', 'webp'].includes(options.format)) throw new Error('Choose jpeg, png or webp');
  for (const key of ['maxWidth', 'maxHeight'] as const) {
    const value = options[key];
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 32768)) throw new Error(`Invalid ${key}`);
  }
  if (options.quality !== undefined && (!Number.isInteger(options.quality) || options.quality < 1 || options.quality > 100 || options.format === 'png')) throw new Error('Quality is 1..100 for JPEG/WebP only');
  if (options.background !== undefined && (options.format !== 'jpeg' || !/^#[0-9a-f]{6}$/i.test(options.background))) throw new Error('JPEG background must be #RRGGBB');
  for (const key of ['preserveMetadata', 'detailCritical'] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') throw new Error(`Invalid ${key}`);
  }
  if (options.detailCritical) throw new Error('Detail-critical image: preserve original; agree a separate derivative with the author first');
}
export async function transformImage(input: Uint8Array, options: ImageOptions) {
  validateOptions(options);
  const source = checked(input), before = await inspectImage(source);
  if (before.pages > 1) throw new Error('Multi-frame/page conversion is not supported');
  if (before.hasAlpha && options.format === 'jpeg' && !options.background) throw new Error('JPEG loses transparency: choose PNG/WebP or explicitly supply background');
  let pipeline = decoder(source).autoOrient();
  if (options.maxWidth !== undefined || options.maxHeight !== undefined) {
    pipeline = pipeline.resize({ width: options.maxWidth, height: options.maxHeight, fit: 'inside', withoutEnlargement: true });
  }
  if (options.format === 'jpeg') {
    if (options.background) pipeline = pipeline.flatten({ background: options.background });
    pipeline = pipeline.jpeg({ quality: options.quality ?? 82, mozjpeg: true, chromaSubsampling: '4:4:4' });
  } else if (options.format === 'webp') pipeline = pipeline.webp({ quality: options.quality ?? 82 });
  else pipeline = pipeline.png({ compressionLevel: 9, palette: false });
  if (options.preserveMetadata) pipeline = pipeline.keepMetadata();
  const data = await pipeline.toBuffer(), after = await inspectImage(data);
  const savedBytes = before.bytes - after.bytes;
  return { data, report: {
    before, after, savedBytes, savedPercent: Math.round(savedBytes / before.bytes * 10000) / 100,
    smaller: savedBytes > 0, applied: false, visualReviewRequired: true,
    settings: { ...options, quality: options.format === 'png' ? null : options.quality ?? 82, preserveMetadata: options.preserveMetadata ?? false },
    warnings: [
      ...(savedBytes <= 0 ? ['Output is not smaller; do not replace merely for size reduction.'] : []),
      ...(!options.preserveMetadata && before.hasMetadata ? ['Metadata removed; check that it is not puzzle evidence.'] : []),
      ...(options.format !== 'png' ? ['Lossy encoding: visual quality and puzzle solvability require author review.'] : []),
    ],
  } };
}
export async function readLocalImage(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > IMAGE_LIMITS.bytes) throw new Error('Expected a local image file up to 50 MiB');
    // Bound the read even if another process grows the file after stat.
    const buffer = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== stat.size) throw new Error('Image changed during read');
    return buffer.subarray(0, offset);
  } finally { await handle.close(); }
}
export async function transformImageFile(input: string, output: string, options: ImageOptions) {
  if (resolve(input) === resolve(output)) throw new Error('Output must differ from input');
  const extensions: Record<ImageFormat, string[]> = { jpeg: ['.jpg', '.jpeg'], png: ['.png'], webp: ['.webp'] };
  validateOptions(options);
  if (!extensions[options.format].includes(extname(output).toLowerCase())) throw new Error('Output extension must match format');
  const result = await transformImage(await readLocalImage(input), options);
  await writeFile(output, result.data, { flag: 'wx' });
  return { ...result.report, written: resolve(output) };
}
