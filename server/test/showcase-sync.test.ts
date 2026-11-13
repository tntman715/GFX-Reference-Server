import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api/app.js';
import type { BotBridge } from '../src/context.js';
import type { PlaylistItem } from '../src/services/showcase.js';
import { alice, bob, carol, makeContext, testPlaylists } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof makeContext>>;
let ctx: Ctx;
const admin = { id: alice.id, isAdmin: true };

const video = (n: number, extra: Partial<PlaylistItem> = {}): PlaylistItem => ({
  videoId: `syn${String(n).padStart(8, '0')}`,
  title: `작업 ${n}`,
  channelName: '나',
  channelId: 'UCabc',
  publishedAt: `2025-01-${String((n % 28) + 1).padStart(2, '0')}T00:00:00Z`,
  ...extra,
});

afterEach(async () => {
  await ctx.db.close();
  testPlaylists.clear();
});

describe('쇼케이스 정렬', () => {
  beforeEach(async () => {
    ctx = await makeContext({ YOUTUBE_API_KEY: 'test-key' });
    for (const id of ['aaaaaaaaaa1', 'aaaaaaaaaa2', 'aaaaaaaaaa3', 'aaaaaaaaaa4', 'aaaaaaaaaa5', 'aaaaaaaaaa6', 'aaaaaaaaaa7']) {
      await ctx.showcase.submit(`https://youtu.be/${id}`, carol);
    }
  });

  it('랜덤은 seed 가 같으면 페이지를 넘겨도 순서가 같고 빠짐 · 중복이 없다', async () => {
    const page = async (seed: number, offset: number) =>
      (await ctx.showcase.list({ sort: 'random', seed, limit: 3, offset })).items.map((s) => s.id);
    const all = [...(await page(42, 0)), ...(await page(42, 3)), ...(await page(42, 6))];
    expect(all).toHaveLength(7);
    expect(new Set(all).size).toBe(7);
    expect([...(await page(42, 0)), ...(await page(42, 3)), ...(await page(42, 6))]).toEqual(all);
    // seed 를 바꾸면 (거의 언제나) 다른 순서
    const orders = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) orders.add((await ctx.showcase.list({ sort: 'random', seed, limit: 10 })).items.map((s) => s.id).join(','));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('최신순 · 오래된순, API 는 모르는 정렬을 최신순으로', async () => {
    const ids = async (sort: 'new' | 'old') => (await ctx.showcase.list({ sort, limit: 10 })).items.map((s) => s.id);
    expect(await ids('new')).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(await ids('old')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const app = createApi(ctx);
    const res = (await (await app.request('/api/showcase?sort=weird&limit=3')).json()) as any;
    expect(res.items.map((s: any) => s.id)).toEqual([7, 6, 5]);
    const rnd = (await (await app.request('/api/showcase?sort=random&seed=9&limit=10')).json()) as any;
    expect(rnd.total).toBe(7);
  });
});

describe('쇼케이스 재생목록 자동 연동', () => {
  beforeEach(async () => {
    ctx = await makeContext({ YOUTUBE_API_KEY: 'test-key', POINTS_PER_SHOWCASE: '3' });
  });

  async function importPlaylist(syncHours: number | null) {
    testPlaylists.set('PLsync1234567', { title: '연동 목록', items: [video(1), video(2)] });
    const res = await ctx.showcase.submit('https://www.youtube.com/playlist?list=PLsync1234567', carol);
    const req = res.kind === 'request' ? res.request : null!;
    await ctx.showcase.decide(req.id, true, admin, { syncHours });
    await ctx.showcase.waitForImports();
    return req.id;
  }

  it('승인할 때 연동을 켜면, 주기가 지나야 새 영상을 확인하고 요청한 사람에게 점수', async () => {
    const id = await importPlaylist(6);
    const done = (await ctx.showcase.getRequest(id))!;
    expect(done).toMatchObject({ status: 'done', imported: 2, syncHours: 6, syncAdded: 0 });
    expect(done.syncedAt).not.toBeNull();

    // 재생목록에 새 영상 2개가 올라옴
    testPlaylists.get('PLsync1234567')!.items.push(video(3), video(4));
    // 주기(6시간)가 안 지났으면 확인하지 않음
    expect(await ctx.showcase.syncDue()).toBe(0);
    await ctx.db.query(`UPDATE showcase_requests SET synced_at = now() - interval '7 hours' WHERE id = $1`, [id]);
    expect(await ctx.showcase.syncDue()).toBe(2);
    expect((await ctx.showcase.getRequest(id))!).toMatchObject({ syncAdded: 2, syncError: null });
    expect((await ctx.showcase.list({ addedBy: carol.id })).total).toBe(4);
    expect((await ctx.community.score(carol.id))?.score).toBe(4 * 3);
    // 방금 확인했으니 다시 묻지 않음
    expect(await ctx.showcase.syncDue()).toBe(0);
  });

  it('쇼케이스에서 지운 영상은 연동이 다시 넣지 않고, 누가 직접 올리면 다시 들어간다', async () => {
    const id = await importPlaylist(1);
    const first = (await ctx.showcase.list({ addedBy: carol.id, sort: 'old' })).items[0];
    await ctx.showcase.remove(first.id, admin);
    const r = await ctx.showcase.syncNow(id, admin);
    expect(r.added).toBe(0);
    expect((await ctx.showcase.list()).total).toBe(1);

    await ctx.showcase.submit(`https://youtu.be/${first.youtubeId}`, bob);
    expect((await ctx.showcase.list()).total).toBe(2);
  });

  it('연동은 관리자만, 끝난 재생목록만, 정해진 주기만', async () => {
    const id = await importPlaylist(null);
    expect((await ctx.showcase.getRequest(id))!.syncHours).toBeNull();
    await expect(ctx.showcase.setSync(id, 6, { id: bob.id, isAdmin: false })).rejects.toThrow(/관리자만/);
    await expect(ctx.showcase.setSync(id, 5, admin)).rejects.toMatchObject({ code: 'bad_sync_hours' });
    expect((await ctx.showcase.setSync(id, 24, admin)).syncHours).toBe(24);
    expect((await ctx.showcase.setSync(id, null, admin)).syncHours).toBeNull();
    await expect(ctx.showcase.syncNow(id, { id: bob.id, isAdmin: false })).rejects.toThrow(/관리자만/);

    testPlaylists.set('PLpend1234567', { title: '대기', items: [video(9)] });
    const res = await ctx.showcase.submit('https://www.youtube.com/playlist?list=PLpend1234567', carol);
    const pending = res.kind === 'request' ? res.request : null!;
    await expect(ctx.showcase.setSync(pending.id, 6, admin)).rejects.toMatchObject({ code: 'not_done' });
    await expect(ctx.showcase.decide(pending.id, true, admin, { syncHours: 2 })).rejects.toMatchObject({ code: 'bad_sync_hours' });
  });

  it('유튜브 오류는 기록만 하고 다음 주기까지 기다린다', async () => {
    const id = await importPlaylist(1);
    const api = { info: async () => null, pages: async function* (): AsyncIterable<PlaylistItem[]> { throw new Error('유튜브 API 오류 (403) quota'); } };
    (ctx.showcase as any).opts.playlistApi = () => api;
    await ctx.db.query(`UPDATE showcase_requests SET synced_at = now() - interval '2 hours' WHERE id = $1`, [id]);
    expect(await ctx.showcase.syncDue()).toBe(0);
    expect((await ctx.showcase.getRequest(id))!.syncError).toMatch(/quota/);
    expect(await ctx.showcase.syncDue()).toBe(0); // synced_at 이 갱신돼서 바로 다시 묻지 않음
  });

  it('API: 연동 목록 · 주기 바꾸기 · 지금 확인 (관리자만)', async () => {
    await ctx.db.close();
    const adminBot: BotBridge = {
      isOnline: () => true,
      sendOriginalDm: async () => undefined,
      isGuildAdmin: async (uid) => uid === alice.id,
      isGuildMember: async () => true,
    };
    ctx = await makeContext({ YOUTUBE_API_KEY: 'test-key' }, adminBot);
    const id = await importPlaylist(null);
    const app = createApi(ctx);
    const as = async (user: typeof alice, path: string, body?: unknown) => {
      const token = await ctx.community.createSession(user, 'plugin');
      return app.request(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    };
    expect((await as(bob, '/api/admin/showcase-links')).status).toBe(403);
    const links = (await (await as(alice, '/api/admin/showcase-links')).json()) as any;
    expect(links).toMatchObject({ hours: [1, 3, 6, 12, 24], enabled: true });
    expect(links.items.map((r: any) => r.id)).toEqual([id]);

    expect((await as(bob, `/api/admin/showcase-requests/${id}/sync`, { hours: 6 })).status).toBe(403);
    const set = (await (await as(alice, `/api/admin/showcase-requests/${id}/sync`, { hours: 6 })).json()) as any;
    expect(set.request.syncHours).toBe(6);

    testPlaylists.get('PLsync1234567')!.items.push(video(5));
    const now = (await (await as(alice, `/api/admin/showcase-requests/${id}/sync-now`, {})).json()) as any;
    expect(now.added).toBe(1);
    expect(now.request.syncAdded).toBe(1);
  });
});
