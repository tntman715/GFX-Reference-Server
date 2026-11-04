import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api/app.js';
import type { BotBridge } from '../src/context.js';
import { alice, bob, file, makeContext, makeImage } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof makeContext>>;
let ctx: Ctx;
let app: ReturnType<typeof createApi>;
const dms: { userId: string; refId: number }[] = [];

const fakeBot: BotBridge = {
  isOnline: () => true,
  sendOriginalDm: async (userId, ref) => {
    dms.push({ userId, refId: ref.id });
  },
  inviteInfo: () => ({ guildName: 'GFX References', botName: 'GFX Bot' }),
};

beforeEach(async () => {
  dms.length = 0;
  ctx = await makeContext({}, fakeBot);
  app = createApi(ctx);
});
afterEach(async () => {
  await ctx.db.close();
});

async function seed() {
  const a = await ctx.refs.create({
    file: file(await makeImage('#050505', '#ff2030'), '레드 썸네일.png'),
    category: 'gm_thumbnail',
    mapName: '블러드배스',
    creatorName: '제작자A',
    tags: ['glow'],
    uploader: alice,
  });
  const b = await ctx.refs.create({
    file: file(await makeImage('#0a0a30', '#3060ff', { shape: 'stripes' })),
    category: 'non_gm',
    title: 'Blue',
    tags: ['modern'],
    uploader: bob,
  });
  return { a, b };
}

async function login(user = alice, label: 'web' | 'plugin' = 'plugin') {
  return ctx.community.createSession(user, label);
}

const json = async (res: Response) => (await res.json()) as any;

describe('공개 API', () => {
  it('/api/meta', async () => {
    await seed();
    const m = await json(await app.request('/api/meta'));
    expect(m.categories.map((c: any) => c.key)).toEqual(['gm_thumbnail', 'gm_artwork', 'non_gm']);
    expect(m.categories[0]).toMatchObject({ label: '지메 썸네일', requiresMapName: true });
    expect(m.tags).toHaveLength(11);
    expect(m.tags.find((t: any) => t.name === 'glow').count).toBe(1);
    expect(m.reactions).toEqual(['⭐', '🔥', '👍']);
    expect(m.scoring.reactionPoints).toEqual({ '⭐': 2, '🔥': 1.5, '👍': 1 });
    expect(m.colors).toHaveLength(11);
    expect(m.stats.total).toBe(2);
    expect(m.bot.online).toBe(true);
    expect(m.auth).toEqual({ oauth: false, deviceCode: true });
  });

  it('/api/refs 검색과 페이지', async () => {
    const { a, b } = await seed();
    let r = await json(await app.request('/api/refs'));
    expect(r.total).toBe(2);
    expect(r.items.map((i: any) => i.id)).toEqual([b.id, a.id]);
    const item = r.items[1];
    expect(item).toMatchObject({
      title: '블러드배스',
      mapName: '블러드배스',
      categoryLabel: '지메 썸네일',
      creator: { name: '제작자A' },
      uploader: { id: alice.id, name: '앨리스' },
      tags: ['glow'],
    });
    expect(item.preview.url).toMatch(/^http:\/\/localhost:3000\/api\/previews\/previews\/.+\.webp$/);
    expect(item.thumbUrl).toBe(`http://localhost:3000/api/refs/${a.id}/thumb`);
    expect(item.siteUrl).toBe(`http://localhost:3000/#/ref/${a.id}`);
    expect(item).not.toHaveProperty('colorHist');
    expect(item).not.toHaveProperty('dhash');
    expect(item.myReactions).toBeUndefined();

    r = await json(await app.request('/api/refs?limit=1&page=2'));
    expect(r.items.map((i: any) => i.id)).toEqual([a.id]);
    expect(r.hasMore).toBe(false);

    r = await json(await app.request(`/api/refs?q=${encodeURIComponent('블러드')}`));
    expect(r.items.map((i: any) => i.id)).toEqual([a.id]);
    r = await json(await app.request('/api/refs?tags=modern&category=non_gm'));
    expect(r.items.map((i: any) => i.id)).toEqual([b.id]);
    r = await json(await app.request('/api/refs?color=red'));
    expect(r.items.map((i: any) => i.id)).toEqual([a.id]);
    r = await json(await app.request(`/api/refs?hex=${encodeURIComponent('#ff2030')}`));
    expect(r.items[0].id).toBe(a.id);
    r = await json(await app.request(`/api/refs?similar=${a.id}`));
    expect(r.items.map((i: any) => i.id)).not.toContain(a.id);
    r = await json(await app.request('/api/refs/random?category=non_gm'));
    expect(r.item.id).toBe(b.id);
  });

  it('미리보기 / JPEG 썸네일 / 상세', async () => {
    const { a } = await seed();
    const detail = await json(await app.request(`/api/refs/${a.id}`));
    const previewPath = new URL(detail.item.preview.url).pathname;
    const prev = await app.request(previewPath);
    expect(prev.status).toBe(200);
    expect(prev.headers.get('content-type')).toBe('image/webp');

    const thumb = await app.request(`/api/refs/${a.id}/thumb?w=200`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('content-type')).toBe('image/jpeg');
    const bytes = new Uint8Array(await thumb.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);

    expect((await app.request('/api/refs/99999')).status).toBe(404);
    expect((await app.request('/api/refs/abc')).status).toBe(404);
    // 인코딩된 경로 탈출 시도는 저장소 키 검사에서 막힘
    expect((await app.request('/api/previews/..%2F..%2Fetc%2Fpasswd')).status).toBe(404);
    expect((await app.request('/api/previews/previews%2F..%2F..%2Fconfig')).status).toBe(404);
    expect((await app.request('/api/nope')).status).toBe(404);
  });

  it('랭킹 / 프로필 / 색상 / 제작자', async () => {
    const { a } = await seed();
    await ctx.refs.toggleReaction(a.id, bob, '⭐');
    const lb = await json(await app.request('/api/leaderboard'));
    expect(lb.rows[0]).toMatchObject({ userId: alice.id, score: 12, rank: 1 }); // 업로드 10 + ⭐ 2
    expect(lb.scoring.reactionPoints['⭐']).toBe(2);
    const p = await json(await app.request(`/api/users/${alice.id}`));
    expect(p.user.username).toBe('alice');
    expect(p.recent).toHaveLength(1);
    expect(p.top[0].id).toBe(a.id);
    const colors = await json(await app.request('/api/colors'));
    expect(colors.colors.find((c: any) => c.key === 'red').count).toBe(1);
    const creators = await json(await app.request(`/api/creators?q=${encodeURIComponent('제작')}`));
    expect(creators.creators).toEqual(['제작자A']);
  });
});

describe('로그인이 필요한 API', () => {
  it('원본 다운로드는 디스코드 로그인 필요', async () => {
    const { a } = await seed();
    const anon = await app.request(`/api/refs/${a.id}/original`);
    expect(anon.status).toBe(401);
    expect((await json(anon)).error).toMatch(/디스코드 로그인/);

    const token = await login();
    const res = await app.request(`/api/refs/${a.id}/original`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const cd = res.headers.get('content-disposition')!;
    expect(cd).toContain('attachment;');
    expect(cd).toContain(`filename*=UTF-8''${encodeURIComponent(`${a.id} 블러드배스 - 제작자A.png`)}`);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(1, 4).toString()).toBe('PNG');

    // 쿠키로도 인증 가능 (웹사이트)
    const webToken = await login(bob, 'web');
    const viaCookie = await app.request(`/api/refs/${a.id}/original?inline=1`, { headers: { Cookie: `gfx_token=${webToken}` } });
    expect(viaCookie.status).toBe(200);
    expect(viaCookie.headers.get('content-disposition')).toMatch(/^inline;/);
  });

  it('디스코드 DM 으로 받기', async () => {
    const { b } = await seed();
    const token = await login(bob);
    const res = await app.request(`/api/refs/${b.id}/dm`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(dms).toEqual([{ userId: bob.id, refId: b.id }]);
  });

  it('반응 토글', async () => {
    const { a } = await seed();
    const token = await login(bob);
    const post = (emoji: string) =>
      app.request(`/api/refs/${a.id}/reactions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      });
    expect((await app.request(`/api/refs/${a.id}/reactions`, { method: 'POST' })).status).toBe(401);
    let r = await json(await post('⭐'));
    expect(r).toMatchObject({ active: true, reactions: { '⭐': 1 }, myReactions: ['⭐'] });
    r = await json(await post('⭐'));
    expect(r).toMatchObject({ active: false, reactions: {}, myReactions: [] });
    expect((await post('🍕')).status).toBe(400);

    await post('🔥');
    const list = await json(await app.request('/api/refs', { headers: { Authorization: `Bearer ${token}` } }));
    expect(list.items.find((i: any) => i.id === a.id).myReactions).toEqual(['🔥']);
  });

  it('기기 연동 흐름 (플러그인)', async () => {
    const res = await json(
      await app.request('/api/auth/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: 'plugin' }),
      }),
    );
    expect(res.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(res.command).toBe(`/연동 코드:${res.userCode}`);
    const poll = () =>
      app.request('/api/auth/device/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceCode: res.deviceCode }),
      });
    expect((await json(await poll())).status).toBe('pending');
    await ctx.community.approveDeviceCode(res.userCode, alice);
    const ok = await json(await poll());
    expect(ok.status).toBe('approved');
    expect(ok.user).toMatchObject({ id: alice.id, username: 'alice' });
    const me = await json(await app.request('/api/auth/me', { headers: { Authorization: `Bearer ${ok.token}` } }));
    expect(me.user.id).toBe(alice.id);

    const out = await app.request('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${ok.token}` } });
    expect(out.status).toBe(200);
    expect((await json(await app.request('/api/auth/me', { headers: { Authorization: `Bearer ${ok.token}` } }))).user).toBeNull();
  });

  it('기기 연동 흐름 (웹) 은 토큰 대신 쿠키를 설정', async () => {
    const res = await json(await app.request('/api/auth/device', { method: 'POST' }));
    await ctx.community.approveDeviceCode(res.userCode, bob);
    const poll = await app.request('/api/auth/device/poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode: res.deviceCode }),
    });
    const body = await json(poll);
    expect(body.status).toBe('approved');
    expect(body.token).toBeUndefined();
    const cookie = poll.headers.get('set-cookie')!;
    expect(cookie).toMatch(/gfx_token=[^;]+; Max-Age=\d+; Path=\/; HttpOnly; SameSite=Lax/);
  });
});

describe('보안', () => {
  it('쿠키 인증 POST 는 다른 출처에서 막힘', async () => {
    const { a } = await seed();
    const webToken = await login(bob, 'web');
    const req = (origin?: string) =>
      app.request(`/api/refs/${a.id}/reactions`, {
        method: 'POST',
        headers: { Cookie: `gfx_token=${webToken}`, 'Content-Type': 'text/plain', ...(origin ? { Origin: origin } : {}) },
        body: JSON.stringify({ emoji: '⭐' }),
      });
    expect((await req('https://evil.example')).status).toBe(403);
    expect((await req('http://localhost:3000')).status).toBe(200);
    expect((await req()).status).toBe(200); // Origin 없는 요청(같은 출처 또는 도구)
    // 토큰(Bearer) 인증은 Origin 과 무관 (플러그인)
    const token = await login(bob);
    const bearer = await app.request(`/api/refs/${a.id}/reactions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji: '🔥' }),
    });
    expect(bearer.status).toBe(200);
  });
});

describe('봇 오프라인', () => {
  it('원본 다운로드/코드 연동은 503', async () => {
    const offline = await makeContext({}, { ...fakeBot, isOnline: () => false });
    const offApp = createApi(offline);
    expect((await offApp.request('/api/auth/device', { method: 'POST' })).status).toBe(503);
    const meta = await json(await offApp.request('/api/meta'));
    expect(meta.auth.deviceCode).toBe(false);
    await offline.db.close();
  });
});

describe('정적 웹사이트', () => {
  it('index.html 을 제공하고 경로 탈출은 막음', async () => {
    const res = await app.request('/');
    // web/ 폴더가 아직 없으면 404 메시지
    expect([200, 404]).toContain(res.status);
    expect((await app.request('/../server/package.json')).status).not.toBe(200);
    const encoded = await app.request('/%2e%2e/server/package.json');
    expect(encoded.status).not.toBe(200);
    expect(await encoded.text()).not.toContain('gfx-reference-server');
    const passwd = await app.request('/..%2F..%2F..%2Fetc%2Fpasswd');
    expect(await passwd.text()).not.toContain('root:');
  });
});
