import sharp, { type Metadata, type OutputInfo } from 'sharp';
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

/** 상세 보기용 고화질 미리보기 (긴 변 maxSize 이하 WebP). 작은 원본은 키우지 않고 같은 크기로 만듭니다. */
export async function makeHqPreview(
  input: Buffer,
  opts: { maxSize: number; quality: number },
): Promise<{ data: Buffer; width: number; height: number }> {
  const out = await sharp(input, { failOn: 'none', animated: false, limitInputPixels: 268_402_689 })
    .rotate()
    .resize({ width: opts.maxSize, height: opts.maxSize, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: opts.quality, effort: 4, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });
  return { data: out.data, width: out.info.width, height: out.info.height };
}

// ── 큰 원본 줄이기 ─────────────────────────────────────────

const MAX_PIXELS = 268_402_689;
const WEBP_MAX_SIDE = 16383;

export interface ShrinkResult {
  buffer: Buffer;
  /** sharp 형식 이름 (png / webp / jpeg …) */
  format: string;
  width: number;
  height: number;
  /** null 이면 이미 작아서 그대로 둠 */
  compression: null | {
    fromBytes: number;
    /** lossless: 화질 그대로 · lossy: 아주 높은 품질로 저장 · resized: 그래도 커서 크기까지 줄임 */
    method: 'lossless' | 'lossy' | 'resized';
    quality: number | null;
    /** 줄인 비율 (resized 일 때만) */
    scale: number | null;
  };
}

// 큰 이미지를 여러 장 동시에 풀면 작은 서버의 메모리가 모자라므로 한 번에 하나씩
let shrinkQueue: Promise<unknown> = Promise.resolve();

/**
 * 원본이 maxBytes 보다 크면 화질을 최대한 지키면서 줄입니다. 순서:
 *  1. 무손실 — PNG 최대 압축, 그다음 무손실 WebP (화질 그대로)
 *  2. 아주 높은 품질 — 불투명하면 JPEG 95/90/85 (색 번짐 없는 4:4:4), 투명하면 WebP 95/90/85 (투명도는 무손실)
 *  3. 그래도 크면 가로세로를 필요한 만큼만 줄임 (품질 90)
 * 색 프로필(ICC)은 유지하고, 사진 회전값은 실제 픽셀에 반영합니다.
 */
export function shrinkToFit(input: Buffer, maxBytes: number): Promise<ShrinkResult> {
  const run = shrinkQueue.then(() => shrink(input, maxBytes));
  shrinkQueue = run.catch(() => undefined);
  return run;
}

async function shrink(input: Buffer, maxBytes: number): Promise<ShrinkResult> {
  const meta = await sharp(input, { failOn: 'error', limitInputPixels: MAX_PIXELS })
    .metadata()
    .catch(() => {
      throw new UserError('이미지 파일을 읽을 수 없습니다. PNG, JPG, WEBP, GIF 파일을 올려주세요.', { code: 'bad_image' });
    });
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = (rotated ? meta.height : meta.width) ?? 0;
  const height = (rotated ? meta.width : meta.height) ?? 0;
  if (input.length <= maxBytes) return { buffer: input, format: meta.format ?? '', width, height, compression: null };

  const mb = Math.round(maxBytes / 1024 / 1024);
  if ((meta.pages ?? 1) > 1) {
    throw new UserError(`움직이는 이미지는 압축할 수 없어요. ${mb}MB 이하로 올려 주세요.`, { code: 'too_large' });
  }

  const base = () => sharp(input, { failOn: 'none', animated: false, limitInputPixels: MAX_PIXELS }).rotate().keepIccProfile();
  const done = (out: { data: Buffer; info: OutputInfo }, method: 'lossless' | 'lossy' | 'resized', quality: number | null, scale: number | null): ShrinkResult => ({
    buffer: out.data,
    format: out.info.format,
    width: out.info.width,
    height: out.info.height,
    compression: { fromBytes: input.length, method, quality, scale },
  });

  // 1. 무손실 (조금만 넘을 때만 시도 — 많이 크면 어차피 안 들어가서 시간만 듦)
  if (meta.format === 'png' && input.length <= maxBytes * 1.5) {
    const out = await base().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer({ resolveWithObject: true });
    if (out.data.length <= maxBytes) return done(out, 'lossless', null, null);
  }
  const webpOk = width <= WEBP_MAX_SIDE && height <= WEBP_MAX_SIDE;
  if (meta.format !== 'jpeg' && webpOk && input.length <= maxBytes * 2) {
    const out = await base().webp({ lossless: true, effort: 4 }).toBuffer({ resolveWithObject: true });
    if (out.data.length <= maxBytes) return done(out, 'lossless', null, null);
  }

  // 2. 아주 높은 품질의 손실 압축
  const transparent = !!meta.hasAlpha && !(await base().stats()).isOpaque;
  if (transparent && !webpOk) {
    throw new UserError(`투명한 배경의 아주 큰 이미지는 압축할 수 없어요. ${mb}MB 이하로 올려 주세요.`, { code: 'too_large' });
  }
  const lossy = (quality: number, scale = 1) => {
    let s = base();
    if (scale < 1) s = s.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), fit: 'fill' });
    return (
      transparent
        ? s.webp({ quality, alphaQuality: 100, effort: 4, smartSubsample: true })
        : s.jpeg({ quality, chromaSubsampling: '4:4:4', optimiseCoding: true })
    ).toBuffer({ resolveWithObject: true });
  };
  let lastSize = Infinity;
  for (const q of [95, 90, 85]) {
    const out = await lossy(q);
    if (out.data.length <= maxBytes) return done(out, 'lossy', q, null);
    lastSize = out.data.length * (q === 95 ? 0.75 : 1); // 95 → 90 이면 대략 3/4
    if (q === 95 && out.data.length > maxBytes * 2) break; // 품질만 낮춰서는 안 들어감
  }

  // 3. 크기 줄이기 (필요한 만큼만 — 한도의 85~100% 가 되는 가장 큰 크기를 찾음)
  // 파일 크기 ≈ 비율^k 로 보고, 시도할 때마다 k 를 실제 결과에 맞춰 고침 (보통 4~6번 안에 끝남)
  const target = maxBytes * 0.93;
  let ref = { scale: 1, size: lastSize };
  let k = 2;
  let tooBig = 1; // 이 비율 이상은 안 들어감
  let best: { out: { data: Buffer; info: OutputInfo }; scale: number } | null = null;
  for (let i = 0; i < 6; i++) {
    let scale = ref.scale * Math.pow(target / ref.size, 1 / k);
    const floor = best?.scale ?? 0;
    if (!(scale > floor && scale < tooBig)) scale = (floor + tooBig) / 2;
    const out = await lossy(90, scale);
    const size = out.data.length;
    if (size <= maxBytes) {
      if (!best || scale > best.scale) best = { out, scale };
      if (size >= maxBytes * 0.85) break;
    } else {
      tooBig = scale;
    }
    if (scale !== ref.scale && size !== ref.size) k = Math.min(5, Math.max(1, Math.log(size / ref.size) / Math.log(scale / ref.scale)));
    ref = { scale, size };
  }
  if (best) return done(best.out, 'resized', 90, Math.round(best.scale * 1000) / 1000);
  throw new UserError(`이미지를 ${mb}MB 이하로 줄이지 못했어요.`, { code: 'too_large' });
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
