import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error — 크롬 익스텐션의 순수 JS 모듈 (타입 없음)
import { candidateUrls, cleanPageUrl, imageKey } from '../../chrome-extension/lib/box.js';
import { cleanSourceUrl } from '../src/services/references.js';
import { alice, file, makeContext, makeImage } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof makeContext>>;

describe('레퍼런스 출처 주소', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await makeContext();
  });
  afterEach(async () => {
    await ctx.db.close();
  });

  it('출처를 저장하고 공개 정보에 보여 줌', async () => {
    const r = await ctx.refs.create({
      file: file(await makeImage('#123456')),
      category: 'non_gm',
      uploader: alice,
      sourceUrl: ' https://www.pinterest.com/pin/123456789/ ',
    });
    expect(r.sourceUrl).toBe('https://www.pinterest.com/pin/123456789/');
    expect(ctx.refs.toPublic(r).sourceUrl).toBe('https://www.pinterest.com/pin/123456789/');
  });

  it('출처가 없으면 null', async () => {
    const r = await ctx.refs.create({ file: file(await makeImage('#654321')), category: 'non_gm', uploader: alice });
    expect(r.sourceUrl).toBeNull();
  });

  it('http(s) 가 아닌 주소는 거절', () => {
    expect(cleanSourceUrl('')).toBeNull();
    expect(cleanSourceUrl(null)).toBeNull();
    expect(() => cleanSourceUrl('javascript:alert(1)')).toThrow(/http/);
    expect(() => cleanSourceUrl('not a url')).toThrow();
    expect(() => cleanSourceUrl('https://a.com/' + 'x'.repeat(600))).toThrow(/너무/);
  });
});

describe('크롬 익스텐션 보관함 도우미', () => {
  it('핀터레스트 사진은 크기와 상관없이 같은 사진으로 봄', () => {
    const a = imageKey('https://i.pinimg.com/236x/ab/cd/ef/abcdef0123.jpg');
    expect(a).toBe('pinimg:ab/cd/ef/abcdef0123');
    expect(imageKey('https://i.pinimg.com/originals/ab/cd/ef/abcdef0123.png')).toBe(a);
    expect(imageKey('https://i.pinimg.com/75x75_RS/ab/cd/ef/abcdef0123.jpg')).toBe(a);
    expect(imageKey('https://example.com/a.png')).toBe('https://example.com/a.png');
  });

  it('원본 → 큰 크기 → 원래 주소 순서로 시도', () => {
    const list = candidateUrls('https://i.pinimg.com/236x/ab/cd/ef/abc.jpg');
    expect(list[0]).toBe('https://i.pinimg.com/originals/ab/cd/ef/abc.jpg');
    expect(list[1]).toBe('https://i.pinimg.com/originals/ab/cd/ef/abc.png');
    expect(list).toContain('https://i.pinimg.com/736x/ab/cd/ef/abc.jpg');
    expect(list[list.length - 1]).toBe('https://i.pinimg.com/236x/ab/cd/ef/abc.jpg');
    expect(new Set(list).size).toBe(list.length);
    expect(candidateUrls('https://example.com/a.png')).toEqual(['https://example.com/a.png']);
  });

  it('핀 주소는 깔끔하게 남김', () => {
    expect(cleanPageUrl('https://kr.pinterest.com/pin/12345/?mt=login#x')).toBe('https://kr.pinterest.com/pin/12345/');
    expect(cleanPageUrl('https://example.com/a?b=1#c')).toBe('https://example.com/a?b=1');
    expect(cleanPageUrl('chrome://newtab')).toBeNull();
  });

  it('익스텐션의 core.js 는 포토샵 플러그인 것과 똑같아야 함', () => {
    const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
    expect(read('../../chrome-extension/lib/core.js')).toBe(read('../../photoshop-plugin/gfx-ref/core.js'));
  });
});
