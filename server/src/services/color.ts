import { COLOR_FAMILY_KEYS, type ColorFamily, COLOR_FAMILIES } from '../constants.js';

/**
 * 색상 분석 (순수 함수만 모아둔 모듈)
 *
 * - 계열 비율(colorShares): 빨강/파랑/검정… 각 계열이 이미지에서 차지하는 비율
 * - 히스토그램(colorHist): 색상 유사도 비교용 40칸 벡터 (12 색상 × 3 명도 + 무채색 4칸)
 * - 팔레트(palette): k-means 로 뽑은 대표색 최대 6개
 */

export interface PaletteColor {
  hex: string;
  share: number;
}

export interface ColorAnalysis {
  palette: PaletteColor[];
  colorHist: number[];
  colorShares: Record<ColorFamily, number>;
  primaryColor: ColorFamily;
}

type RGB = [number, number, number];
type Lab = [number, number, number];

const HUE_BINS = 12;
const LIGHT_LEVELS = 3;
const NEUTRAL_BINS = 4;
export const HIST_SIZE = HUE_BINS * LIGHT_LEVELS + NEUTRAL_BINS;

// ── 색 공간 변환 ────────────────────────────────────────────

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, Math.min(1, s), l];
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  // D65
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb(L: number, a: number, bb: number): RGB {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - bb / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const x = inv(fx) * 0.95047;
  const y = inv(fy);
  const z = inv(fz) * 1.08883;
  const lin = [
    x * 3.2406 + y * -1.5372 + z * -0.4986,
    x * -0.9689 + y * 1.8758 + z * 0.0415,
    x * 0.0557 + y * -0.204 + z * 1.057,
  ];
  return lin.map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  }) as RGB;
}

/** CIE76 색차 */
export function deltaE(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

export function parseHex(input: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function hexToLab(hex: string): Lab | null {
  const rgb = parseHex(hex);
  return rgb ? rgbToLab(...rgb) : null;
}

// ── 계열 분류 ────────────────────────────────────────────────

/** 채도(chroma) 0~1 : 0 이면 완전 무채색 */
function chromaOf(r: number, g: number, b: number): number {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/** 유채색으로 볼 가중치 (0 = 무채색, 1 = 확실한 유채색) */
function chromaticWeight(r: number, g: number, b: number): number {
  const v = Math.max(r, g, b) / 255;
  if (v < 0.12) return 0; // 거의 검정
  const c = chromaOf(r, g, b);
  return Math.min(1, Math.max(0, (c - 0.08) / 0.14));
}

function neutralFamily(l: number): ColorFamily {
  if (l < 0.18) return 'black';
  if (l > 0.86) return 'white';
  return 'gray';
}

export function hueFamily(h: number, l: number): ColorFamily {
  if (h >= 345 || h < 15) return l > 0.72 ? 'pink' : 'red';
  if (h < 40) return 'orange';
  if (h < 68) return 'yellow';
  if (h < 165) return 'green';
  if (h < 195) return 'cyan';
  if (h < 255) return 'blue';
  if (h < 290) return 'purple';
  return 'pink';
}

/** 픽셀 하나를 가장 가까운 색상 계열로 */
export function classifyPixel(r: number, g: number, b: number): ColorFamily {
  const [h, , l] = rgbToHsl(r, g, b);
  if (chromaticWeight(r, g, b) < 0.5) return neutralFamily(l);
  return hueFamily(h, l);
}

function neutralBin(l: number): number {
  if (l < 0.18) return 0;
  if (l < 0.5) return 1;
  if (l < 0.86) return 2;
  return 3;
}

function lightLevel(l: number): number {
  if (l < 0.35) return 0;
  if (l < 0.68) return 1;
  return 2;
}

// ── 분석 ────────────────────────────────────────────────────

/**
 * @param pixels raw 픽셀 버퍼 (RGB 또는 RGBA)
 * @param channels 3 또는 4
 */
export function analyzeColors(pixels: Uint8Array, channels: number): ColorAnalysis {
  const hist = new Array<number>(HIST_SIZE).fill(0);
  const shares = Object.fromEntries(COLOR_FAMILY_KEYS.map((k) => [k, 0])) as Record<ColorFamily, number>;
  const labs: Lab[] = [];
  let total = 0;

  for (let i = 0; i + 2 < pixels.length; i += channels) {
    if (channels === 4 && pixels[i + 3] < 128) continue; // 투명 픽셀 제외
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    total++;
    labs.push(rgbToLab(r, g, b));

    const [h, , l] = rgbToHsl(r, g, b);
    const w = chromaticWeight(r, g, b);

    // 계열 비율 (부드럽게 나눔)
    if (w > 0) shares[hueFamily(h, l)] += w;
    if (w < 1) shares[neutralFamily(l)] += 1 - w;

    // 히스토그램: 색상은 인접한 두 칸에 선형으로 나눠 담아 경계에서 튀지 않게
    if (w > 0) {
      const pos = (((h + 15) % 360) / 360) * HUE_BINS - 0.5;
      const lo = Math.floor(pos);
      const frac = pos - lo;
      const lv = lightLevel(l);
      const b0 = ((lo % HUE_BINS) + HUE_BINS) % HUE_BINS;
      const b1 = (b0 + 1) % HUE_BINS;
      hist[b0 * LIGHT_LEVELS + lv] += w * (1 - frac);
      hist[b1 * LIGHT_LEVELS + lv] += w * frac;
    }
    if (w < 1) hist[HUE_BINS * LIGHT_LEVELS + neutralBin(l)] += 1 - w;
  }

  if (total === 0) {
    return {
      palette: [],
      colorHist: hist,
      colorShares: shares,
      primaryColor: 'black',
    };
  }

  for (let i = 0; i < hist.length; i++) hist[i] = round4(hist[i] / total);
  for (const k of COLOR_FAMILY_KEYS) shares[k] = round4(shares[k] / total);

  return {
    palette: extractPalette(labs),
    colorHist: hist,
    colorShares: shares,
    primaryColor: pickPrimary(shares),
  };
}

/** 대표 계열: 유채색이 10% 이상이면 가장 많은 유채색, 아니면 가장 많은 무채색 */
export function pickPrimary(shares: Record<ColorFamily, number>): ColorFamily {
  const chromatic = COLOR_FAMILY_KEYS.filter((k) => COLOR_FAMILIES[k].chromatic);
  const neutral = COLOR_FAMILY_KEYS.filter((k) => !COLOR_FAMILIES[k].chromatic);
  const chromaTotal = chromatic.reduce((s, k) => s + shares[k], 0);
  const pool = chromaTotal >= 0.1 ? chromatic : neutral;
  return pool.reduce((best, k) => (shares[k] > shares[best] ? k : best), pool[0]);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** 재현 가능한 결과를 위한 시드 고정 난수 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lab 공간 k-means 로 대표색 추출 */
export function extractPalette(labs: Lab[], k = 6, iterations = 12): PaletteColor[] {
  if (labs.length === 0) return [];
  const rand = mulberry32(0x5eed);
  const n = labs.length;
  k = Math.min(k, n);

  // k-means++ 초기화
  const centers: Lab[] = [labs[Math.floor(rand() * n)]];
  const dist = new Float64Array(n).fill(Infinity);
  while (centers.length < k) {
    const last = centers[centers.length - 1];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d = deltaE(labs[i], last) ** 2;
      if (d < dist[i]) dist[i] = d;
      sum += dist[i];
    }
    if (sum === 0) break;
    let target = rand() * sum;
    let idx = 0;
    for (; idx < n - 1; idx++) {
      target -= dist[idx];
      if (target <= 0) break;
    }
    centers.push(labs[idx]);
  }

  const assign = new Int32Array(n);
  for (let it = 0; it < iterations; it++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = deltaE(labs[i], centers[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        changed = true;
      }
    }
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const s = sums[assign[i]];
      s[0] += labs[i][0];
      s[1] += labs[i][1];
      s[2] += labs[i][2];
      s[3]++;
    }
    for (let c = 0; c < centers.length; c++) {
      const s = sums[c];
      if (s[3] > 0) centers[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    }
    if (!changed && it > 0) break;
  }

  const counts = new Array(centers.length).fill(0);
  for (let i = 0; i < n; i++) counts[assign[i]]++;

  // 비슷한 색끼리 합치기
  let clusters = centers
    .map((lab, i) => ({ lab, count: counts[i] }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
  const merged: { lab: Lab; count: number }[] = [];
  for (const c of clusters) {
    const near = merged.find((m) => deltaE(m.lab, c.lab) < 10);
    if (near) {
      const t = near.count + c.count;
      near.lab = [
        (near.lab[0] * near.count + c.lab[0] * c.count) / t,
        (near.lab[1] * near.count + c.lab[1] * c.count) / t,
        (near.lab[2] * near.count + c.lab[2] * c.count) / t,
      ];
      near.count = t;
    } else merged.push({ ...c });
  }
  clusters = merged.sort((a, b) => b.count - a.count);

  return clusters
    .map((c) => ({ hex: rgbToHex(...labToRgb(...c.lab)), share: round4(c.count / n) }))
    .filter((c) => c.share >= 0.02);
}

// ── 유사도 ──────────────────────────────────────────────────

/** 히스토그램 교집합 (0~1) */
export function histogramSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i]);
  return s;
}

/** 한 팔레트의 각 색이 다른 팔레트에 얼마나 가까운 색을 가지고 있는지 (0~1) */
function paletteCoverage(a: PaletteColor[], b: PaletteColor[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bl = b.map((p) => hexToLab(p.hex)!);
  let total = 0;
  let weight = 0;
  for (const p of a) {
    const lab = hexToLab(p.hex)!;
    const best = Math.min(...bl.map((x) => deltaE(lab, x)));
    total += p.share * Math.max(0, 1 - best / 40);
    weight += p.share;
  }
  return weight ? total / weight : 0;
}

export function paletteSimilarity(a: PaletteColor[], b: PaletteColor[]): number {
  return (paletteCoverage(a, b) + paletteCoverage(b, a)) / 2;
}

/** 두 이미지의 색감 유사도 (0~1) */
export function colorSimilarity(
  a: { colorHist: number[]; palette: PaletteColor[] },
  b: { colorHist: number[]; palette: PaletteColor[] },
): number {
  return 0.65 * histogramSimilarity(a.colorHist, b.colorHist) + 0.35 * paletteSimilarity(a.palette, b.palette);
}

/** 특정 색(hex)이 이미지에 얼마나 들어있는지 점수 (0~1) */
export function hexMatchScore(target: Lab, palette: PaletteColor[]): number {
  let score = 0;
  for (const p of palette) {
    const lab = hexToLab(p.hex);
    if (!lab) continue;
    const closeness = Math.max(0, 1 - deltaE(target, lab) / 40);
    // 비율이 작은 포인트 컬러도 어느 정도 잡히도록 제곱근을 씌움
    score += Math.sqrt(p.share) * closeness;
  }
  return Math.min(1, score);
}
