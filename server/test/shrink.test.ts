import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api/app.js';
import { shrinkToFit } from '../src/services/image.js';
import { alice, bob, file, makeContext } from './helpers.js';

/** GFX 처럼 그라데이션에 잔 노이즈가 있는 이미지 (압축이 쉽지 않음) */
function gfx(w: number, h: number, channels: 3 | 4 = 3) {
  const raw = Buffer.alloc(w * h * channels);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 24);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      const n = rnd();
      raw[i] = (x / w) * 200 + n;
      raw[i + 1] = (y / h) * 180 + n;
      raw[i + 2] = 120 + n;
      if (channels === 4) raw[i + 3] = x < w / 2 ? 255 : 90; // 오른쪽 절반은 반투명
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels } });
}
const pixels = (b: Buffer) => sharp(b).ensureAlpha().raw().toBuffer();

let toClose: { db: { close(): Promise<void> } }[] = [];
afterEach(async () => {
  for (const c of toClose) await c.db.close();
  toClose = [];
});

describe('큰 원본 줄이기', () => {
  it('한도 이하면 그대로', async () => {
    const png = await gfx(200, 100).png().toBuffer();
    const r = await shrinkToFit(png, png.length);
    expect(r.compression).toBeNull();
    expect(r.buffer).toBe(png);
  });

  it('조금 넘으면 무손실 — 픽셀이 하나도 안 바뀜', async () => {
    const png = await gfx(600, 400).png({ compressionLevel: 0 }).toBuffer();
    const r = await shrinkToFit(png, Math.round(png.length * 0.8));
    expect(r.compression).toMatchObject({ method: 'lossless', fromBytes: png.length });
    expect(r.buffer.length).toBeLessThanOrEqual(png.length * 0.8);
    expect(Buffer.compare(await pixels(r.buffer), await pixels(png))).toBe(0);
  });

  it('많이 넘으면 아주 높은 품질 JPEG (색 번짐 없는 4:4:4), 해상도 그대로', async () => {
    const png = await gfx(1200, 800).png({ compressionLevel: 9 }).toBuffer();
    const max = Math.round(png.length * 0.45);
    const r = await shrinkToFit(png, max);
    expect(r.compression).toMatchObject({ method: 'lossy', quality: 95 });
    expect(r).toMatchObject({ format: 'jpeg', width: 1200, height: 800 });
    expect(r.buffer.length).toBeLessThanOrEqual(max);
    expect((await sharp(r.buffer).metadata()).chromaSubsampling).toBe('4:4:4');
  });

  it('그래도 안 들어가면 해상도를 필요한 만큼만 줄임', async () => {
    const png = await gfx(1200, 800).png().toBuffer();
    const max = Math.round(png.length * 0.1);
    const r = await shrinkToFit(png, max);
    expect(r.compression?.method).toBe('resized');
    expect(r.buffer.length).toBeLessThanOrEqual(max);
    expect(r.buffer.length).toBeGreaterThan(max * 0.8); // 필요 이상으로 줄이지 않음
    expect(r.width / r.height).toBeCloseTo(1.5, 1);
  });

  it('투명한 이미지는 투명도를 지킨 WebP', async () => {
    const png = await gfx(800, 600, 4).png().toBuffer();
    const max = Math.round(png.length * 0.4);
    const r = await shrinkToFit(png, max);
    expect(r.format).toBe('webp');
    expect(r.buffer.length).toBeLessThanOrEqual(max);
    const meta = await sharp(r.buffer).metadata();
    expect(meta.hasAlpha).toBe(true);
    const stats = await sharp(r.buffer).stats();
    expect(stats.isOpaque).toBe(false);
  });

  it('움직이는 GIF 는 줄이지 않고 안내', async () => {
    const a = await gfx(300, 200).png().toBuffer();
    const b = await gfx(300, 200).negate().png().toBuffer();
    const gif = await sharp([a, b], { join: { animated: true } }).gif().toBuffer();
    expect((await sharp(gif).metadata()).pages).toBe(2);
    await expect(shrinkToFit(gif, Math.round(gif.length / 2))).rejects.toThrow(/움직이는 이미지/);
  });
});

describe('레퍼런스 등록', () => {
  it('보관 한도를 넘으면 줄여서 보관하고, 원래 크기를 기록', async () => {
    const png = await gfx(1200, 800).png().toBuffer();
    const limitMb = (png.length * 0.4) / 1024 / 1024;
    const ctx = await makeContext({ MAX_UPLOAD_MB: String(limitMb) });
    toClose.push(ctx);
    const ref = await ctx.refs.create({ file: file(png, 'big-thumb.png'), category: 'non_gm', title: 'Big', uploader: bob });
    expect(ref.compressedFrom).toBe(png.length);
    expect(ref.originalSize).toBeLessThanOrEqual(ctx.config.upload.maxBytes);
    expect(ref).toMatchObject({ originalMime: 'image/jpeg', originalFilename: 'big-thumb.jpg', width: 1200, height: 800 });
    expect(ctx.refs.toPublic(ref)).toMatchObject({ compressedFrom: png.length, originalSize: ref.originalSize });

    const small = await ctx.refs.create(
      { file: file(await gfx(100, 80).png().toBuffer()), category: 'non_gm', title: 'Small', uploader: bob },
      { allowDuplicate: true },
    );
    expect(small.compressedFrom).toBeNull();
  });

  it('받을 수 있는 최대 크기를 넘으면 거절 (사이트는 413)', async () => {
    const ctx = await makeContext({ MAX_UPLOAD_MB: '0.001', MAX_INPUT_MB: '0.002' });
    toClose.push(ctx);
    const png = await gfx(800, 800).png().toBuffer();
    await expect(ctx.refs.create({ file: file(png), category: 'non_gm', uploader: alice })).rejects.toThrow(/너무 큽니다/);

    const app = createApi(ctx);
    const meta = (await (await app.request('/api/meta')).json()) as any;
    expect(meta.upload).toMatchObject({ maxBytes: ctx.config.upload.maxBytes, inputMaxBytes: ctx.config.upload.inputMaxBytes });
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'a.png');
    form.append('category', 'non_gm');
    const res = await app.request('/api/refs', {
      method: 'POST',
      headers: { authorization: `Bearer ${await ctx.community.createSession(bob, 'plugin')}` },
      body: form,
    });
    expect(res.status).toBe(413);
  });
});
