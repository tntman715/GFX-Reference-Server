import sharp, { type Metadata } from 'sharp';
import { EXT_BY_FORMAT, MIME_BY_FORMAT, SUPPORTED_IMAGE_FORMATS } from '../constants.js';
import { UserError } from '../util/errors.js';
import { analyzeColors, type ColorAnalysis } from './color.js';

sharp.cache(false);

export interface ProcessedImage {
  format: string;
  mime: string;
  ext: string;
  width: number;
  height: number;
  preview: { data: Buffer; width: number; height: number; size: number; mime: 'image/webp' };
  colors: ColorAnalysis;
  dhash: string;
}

export interface ProcessOptions {
  previewMaxSize: number;
  previewQuality: number;
}

/**
 * 업로드된 원본에서 미리보기(WebP)·색상 정보·지각 해시를 만듭니다.
 * 원본 자체는 건드리지 않고 디스코드 아카이브에 그대로 보관합니다.
 */
export async function processImage(input: Buffer, opts: ProcessOptions): Promise<ProcessedImage> {
  let meta: Metadata;
  try {
    meta = await sharp(input, { failOn: 'error', limitInputPixels: 268_402_689 }).metadata();
  } catch {
    throw new UserError('이미지 파일을 읽을 수 없습니다. PNG, JPG, WEBP, GIF 파일을 올려주세요.', { code: 'bad_image' });
  }
  const format = meta.format ?? '';
  if (!(SUPPORTED_IMAGE_FORMATS as readonly string[]).includes(format)) {
    throw new UserError(`지원하지 않는 이미지 형식입니다 (${format || '알 수 없음'}). PNG, JPG, WEBP, GIF 를 올려주세요.`, {
      code: 'bad_image',
    });
  }
  if (!meta.width || !meta.height) throw new UserError('이미지 크기를 알 수 없습니다.', { code: 'bad_image' });

  // EXIF 회전값(5~8)이면 가로세로가 뒤바뀜
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = rotated ? meta.height : meta.width;
  const height = rotated ? meta.width : meta.height;

  const base = () => sharp(input, { failOn: 'none', animated: false, limitInputPixels: 268_402_689 }).rotate();

  const preview = await base()
    .resize({
      width: opts.previewMaxSize,
      height: opts.previewMaxSize,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: opts.previewQuality, effort: 4, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });

  const sample = await base()
    .resize(96, 96, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const colors = analyzeColors(new Uint8Array(sample.data.buffer, sample.data.byteOffset, sample.data.length), sample.info.channels);

  const dhash = await computeDHash(input);

  return {
    format,
    mime: MIME_BY_FORMAT[format] ?? 'application/octet-stream',
    ext: EXT_BY_FORMAT[format] ?? 'bin',
    width,
    height,
    preview: {
      data: preview.data,
      width: preview.info.width,
      height: preview.info.height,
      size: preview.data.length,
      mime: 'image/webp',
    },
    colors,
    dhash,
  };
}

/** 64비트 difference hash (16자리 hex). 비슷한 이미지는 해밍 거리가 작습니다. */
export async function computeDHash(input: Buffer): Promise<string> {
  const { data, info } = await sharp(input, { failOn: 'none', animated: false })
    .rotate()
    .flatten({ background: '#808080' })
    .greyscale()
    .resize(9, 8, { fit: 'fill', kernel: 'cubic' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = data[(y * 9 + x) * ch];
      const right = data[(y * 9 + x + 1) * ch];
      bits = (bits << 1n) | (left > right ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

const POPCOUNT = Array.from({ length: 16 }, (_, i) => ((i >> 3) & 1) + ((i >> 2) & 1) + ((i >> 1) & 1) + (i & 1));

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POPCOUNT[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

/** 미리보기를 작은 JPEG 썸네일로 (WebP 를 못 읽는 포토샵 UXP 패널용) */
export async function toJpegThumb(preview: Buffer, width: number): Promise<Buffer> {
  return sharp(preview, { failOn: 'none' })
    .resize({ width, height: width * 2, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#1b1b1f' })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
}
