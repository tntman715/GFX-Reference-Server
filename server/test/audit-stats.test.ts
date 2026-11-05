import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api/app.js';
import type { BotBridge } from '../src/context.js';
import { auditRepo } from '../src/repos/audit.js';
import { referrerOf, SiteStats } from '../src/services/site-stats.js';
import { alice, bob, carol, file, makeContext, makeImage } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof makeContext>>;
let ctx: Ctx;
const admin = { id: alice.id, isAdmin: true };
const adminBot: BotBridge = {
  isOnline: () => true,
  sendOriginalDm: async () => undefined,
  isGuildAdmin: async (id) => id === alice.id,
  isGuildMember: async () => true,
};
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

beforeEach(async () => {
  ctx = await makeContext({}, adminBot);
});
afterEach(async () => {
  await ctx.db.close();
});

describe('방문 통계 (합계만)', () => {
  it('하루 합계 숫자만 남고 IP · 브라우저 정보 · 계정은 어디에도 저장되지 않음', async () => {
    const stats = new SiteStats(ctx.db, { timezone: 'Asia/Seoul', now: () => new Date('2026-11-06T03:00:00Z') });
    stats.record({ page: 'explore', lang: 'ko', first: true, referrer: 'https://discord.com/channels/1/2' }, { ip: '203.0.113.7', ua: CHROME });
    stats.record({ page: 'showcase', lang: 'ko' }, { ip: '203.0.113.7', ua: CHROME }); // 같은 사람
    stats.record({ page: 'showcase', lang: 'en', first: true }, { ip: '198.51.100.9', ua: IPHONE, userId: bob.id });
    stats.record({ page: 'explore' }, { ip: '198.51.100.10', ua: 'Discordbot/2.0' }); // 봇은 안 셈
    stats.record({ page: '../../etc/passwd' }, { ip: '198.51.100.11', ua: CHROME }); // 모르는 페이지 → other
    await stats.flush();

    const rows = await ctx.db.query<{ day: string; metric: string; key: string; count: number }>(
      'SELECT day::text AS day, metric, key, count FROM site_stats_daily ORDER BY metric, key',
    );
    const dump = JSON.stringify(rows);
    for (const secret of ['203.0.113.7', '198.51.100.9', 'Mozilla', 'iPhone', bob.id, 'discord.com/channels']) expect(dump).not.toContain(secret);
    const get = (metric: string, key = '') => rows.find((r) => r.metric === metric && r.key === key)?.count ?? 0;
    expect(rows.every((r) => String(r.day).startsWith('2026-11-06'))).toBe(true);
    expect(get('visitors')).toBe(3);
    expect(get('views')).toBe(4);
    expect(get('members')).toBe(1);
    expect(get('page', 'showcase')).toBe(2);
    expect(get('page', 'other')).toBe(1);
    expect(get('device', 'mobile')).toBe(1);
    expect(get('referrer', 'discord')).toBe(1);
    expect(get('referrer', 'direct')).toBe(1);

    const s = await stats.summary(7);
    expect(s.to).toBe('2026-11-06');
    expect(s.daily).toHaveLength(7);
    expect(s.totals).toEqual({ views: 4, visitors: 3, members: 1 });
  });

  it('날짜가 바뀌면 방문자 구분용 값을 버리고 다시 셈', async () => {
    let now = new Date('2026-11-06T03:00:00Z');
    const stats = new SiteStats(ctx.db, { timezone: 'Asia/Seoul', now: () => now });
    stats.record({ page: 'feed' }, { ip: '203.0.113.7', ua: CHROME });
    now = new Date('2026-11-06T16:00:00Z'); // 한국 시간 11월 7일 새벽 1시
    stats.record({ page: 'feed' }, { ip: '203.0.113.7', ua: CHROME });
    await stats.flush();
    const rows = await ctx.db.query<{ day: string; count: number }>(`SELECT day::text AS day, count FROM site_stats_daily WHERE metric = 'visitors' ORDER BY day`);
    expect(rows.map((r) => [String(r.day).slice(0, 10), Number(r.count)])).toEqual([
      ['2026-11-06', 1],
      ['2026-11-07', 1],
    ]);
  });

  it('들어온 곳은 정해진 분류로만', () => {
    expect(referrerOf('https://www.google.co.kr/search?q=gd')).toBe('google');
    expect(referrerOf('https://ptb.discord.com/x')).toBe('discord');
    expect(referrerOf('https://someone-blog.example/post/123')).toBe('other');
    expect(referrerOf('')).toBe('direct');
  });

  it('API: 누구나 보낼 수 있지만 통계 화면은 관리자만', async () => {
    const app = createApi(ctx);
    const view = await app.request('/api/stats/view', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': CHROME, 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify({ page: 'colors', lang: 'ko', first: true }),
    });
    expect(view.status).toBe(204);
    const as = async (user: typeof alice) =>
      app.request('/api/admin/stats?days=7', { headers: { authorization: `Bearer ${await ctx.community.createSession(user, 'plugin')}` } });
    expect((await as(bob)).status).toBe(403);
    const res = await as(alice);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.totals.views).toBe(1);
    expect(body.pages).toEqual([{ key: 'colors', count: 1 }]);
    expect(body.activity.totals).toMatchObject({ uploads: 0, reactions: 0 });
  });
});

describe('감사 로그', () => {
  const upload = async (uploader = bob) =>
    ctx.refs.create({ file: file(await makeImage('#050505', '#ff2030')), category: 'gm_artwork', title: 'Glow art', mapName: 'Map', tags: [], uploader });

  it('관리자 권한으로 한 일만 남고, 내 것을 내가 지운 건 안 남음', async () => {
    await ctx.community.addTag('neon', null, admin);
    await ctx.community.renameTag('neon', 'neon-glow', admin);
    await ctx.community.adjustScore(bob.id, 5, '이벤트 상품', admin);

    const mine = await upload(alice);
    await ctx.refs.delete(mine.id, admin); // 관리자라도 자기 것 → 기록 안 함
    const theirs = await upload(bob);
    await ctx.refs.update(theirs.id, { title: 'Fixed title' }, admin);
    await ctx.refs.delete(theirs.id, admin);

    const { items, total } = await auditRepo.list(ctx.db);
    expect(total).toBe(5);
    expect(items.map((e) => e.action)).toEqual(['ref.delete', 'ref.update', 'score.adjust', 'tag.rename', 'tag.add']);
    expect(items[0]).toMatchObject({ actor: { id: alice.id }, targetType: 'ref', targetId: String(theirs.id), detail: { uploaderId: bob.id } });
    expect(items[1].summary).toContain('title');
    expect(items[2]).toMatchObject({ targetId: bob.id, detail: { delta: 5, reason: '이벤트 상품' } });

    const tagsOnly = await auditRepo.list(ctx.db, { action: 'tag' });
    expect(tagsOnly.items.map((e) => e.action)).toEqual(['tag.rename', 'tag.add']);
  });

  it('올린 사람이 자기 레퍼런스에 온 제안을 받아들이면 기록 안 함, 관리자가 남의 것을 받아들이면 기록', async () => {
    const ref = await upload(bob);
    const p1 = await ctx.edits.submit(ref.id, { title: 'By carol' }, carol, false);
    expect(p1.mode).toBe('proposed');
    await ctx.edits.accept(p1.mode === 'proposed' ? p1.proposal.id : 0, { id: bob.id, isAdmin: false });
    expect((await auditRepo.list(ctx.db)).total).toBe(0);

    const p2 = await ctx.edits.submit(ref.id, { title: 'Again by carol' }, carol, false);
    await ctx.edits.accept(p2.mode === 'proposed' ? p2.proposal.id : 0, admin);
    const { items } = await auditRepo.list(ctx.db);
    expect(items.map((e) => e.action)).toEqual(['edit.accept']);
  });

  it('API: 관리자만 볼 수 있고, 유튜브 키는 마지막 4글자만 남음', async () => {
    const app = createApi(ctx);
    const req = async (user: typeof alice, path: string, body?: unknown) =>
      app.request(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${await ctx.community.createSession(user, 'plugin')}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const key = 'AIzaSyAuditTestKey_0123456789abcdQRST';
    expect((await req(alice, '/api/admin/youtube-key', { key })).status).toBe(200);
    expect((await req(bob, '/api/admin/audit')).status).toBe(403);
    const res = await req(alice, '/api/admin/audit');
    const text = await res.text();
    expect(text).not.toContain(key);
    const body = JSON.parse(text);
    expect(body.items[0]).toMatchObject({ action: 'youtube-key.set', summary: '유튜브 API 키 저장 (…QRST)' });
  });
});
