import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  analyzeColors,
  classifyPixel,
  colorSimilarity,
  hexMatchScore,
  hexToLab,
  HIST_SIZE,
  labToRgb,
  parseHex,
  rgbToLab,
} from '../src/services/color.js';
import { computeDHash, hammingDistance, processImage } from '../src/services/image.js';
import { makeImage } from './helpers.js';

async function analyze(buf: Buffer) {
  const { data, info } = await sharp(buf).resize(96, 96, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return analyzeColors(new Uint8Array(data), info.channels);
}

describe('색상 분류', () => {
  it.each([
    [[230, 30, 40], 'red'],
    [[250, 140, 10], 'orange'],
    [[255, 220, 20], 'yellow'],
    [[40, 180, 60], 'green'],
    [[0, 190, 210], 'cyan'],
    [[40, 90, 240], 'blue'],
    [[130, 50, 230], 'purple'],
    [[255, 60, 160], 'pink'],
    [[255, 190, 200], 'pink'],
    [[10, 10, 12], 'black'],
    [[128, 128, 130], 'gray'],
    [[245, 245, 245], 'white'],
  ])('%j → %s', (rgb, family) => {
    expect(classifyPixel(...(rgb as [number, number, number]))).toBe(family);
  });

  it('hex 파싱과 Lab 왕복 변환', () => {
    expect(parseHex('#f04')).toEqual([255, 0, 68]);
    expect(parseHex('ff0044')).toEqual([255, 0, 68]);
    expect(parseHex('nope')).toBeNull();
    const lab = rgbToLab(12, 200, 99);
    expect(labToRgb(...lab)).toEqual([12, 200, 99]);
  });
});

describe('이미지 색상 분석', () => {
  it('검은 배경 + 빨간 원 → 대표색은 빨강, 검정 비율이 큼', async () => {
    const res = await analyze(await makeImage('#050505', '#e01020'));
    expect(res.primaryColor).toBe('red');
    expect(res.colorShares.black).toBeGreaterThan(0.4);
    expect(res.colorShares.red).toBeGreaterThan(0.2);
    expect(res.colorHist).toHaveLength(HIST_SIZE);
    expect(res.colorHist.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
    expect(res.palette.length).toBeGreaterThanOrEqual(2);
    expect(res.palette[0].share).toBeGreaterThan(res.palette[1].share);
  });

  it('회색 이미지는 무채색이 대표색', async () => {
    const res = await analyze(await makeImage('#777777'));
    expect(res.primaryColor).toBe('gray');
  });

  it('비슷한 색감은 유사도가 높고, 다른 색감은 낮음', async () => {
    const a = await analyze(await makeImage('#0a0a30', '#3060ff'));
    const b = await analyze(await makeImage('#0b0b2c', '#2a58f0', { shape: 'stripes' }));
    const c = await analyze(await makeImage('#ffe000', '#ff5000'));
    expect(colorSimilarity(a, b)).toBeGreaterThan(0.6);
    expect(colorSimilarity(a, c)).toBeLessThan(0.25);
  });

  it('hex 검색 점수', async () => {
    const red = await analyze(await makeImage('#000000', '#ff0000'));
    const blue = await analyze(await makeImage('#000000', '#0000ff'));
    const target = hexToLab('#f01010')!;
    expect(hexMatchScore(target, red.palette)).toBeGreaterThan(0.3);
    expect(hexMatchScore(target, blue.palette)).toBeLessThan(0.05);
  });
});

describe('지각 해시 (중복 검사)', () => {
  it('같은 이미지의 크기만 다른 버전은 거리가 작음', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
      <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#101040"/><stop offset="1" stop-color="#ff8800"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/><circle cx="400" cy="360" r="200" fill="#ffffff"/></svg>`;
    const big = await sharp(Buffer.from(svg)).png().toBuffer();
    const small = await sharp(big).resize(320).jpeg({ quality: 60 }).toBuffer();
    const other = await makeImage('#ffffff', '#0022ff', { shape: 'text' });
    const [h1, h2, h3] = await Promise.all([computeDHash(big), computeDHash(small), computeDHash(other)]);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
    expect(hammingDistance(h1, h2)).toBeLessThanOrEqual(5);
    expect(hammingDistance(h1, h3)).toBeGreaterThan(10);
  });
});

describe('processImage', () => {
  it('큰 이미지는 WebP 미리보기로 줄어듦', async () => {
    const buf = await makeImage('#202040', '#ff00aa', { w: 1920, h: 1080 });
    const out = await processImage(buf, { previewMaxSize: 720, previewQuality: 72 });
    expect(out.format).toBe('png');
    expect(out.width).toBe(1920);
    expect(out.height).toBe(1080);
    expect(out.preview.width).toBe(720);
    expect(out.preview.height).toBe(405);
    expect(out.preview.data.subarray(8, 12).toString()).toBe('WEBP');
    expect(out.preview.size).toBeLessThan(buf.length);
  });

  it('이미지가 아니면 친절한 오류', async () => {
    await expect(processImage(Buffer.from('hello world'), { previewMaxSize: 720, previewQuality: 72 })).rejects.toThrow(
      /이미지 파일을 읽을 수 없습니다/,
    );
  });
});
