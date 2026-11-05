import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api/app.js';
import type { BotBridge } from '../src/context.js';
import type { ReportNotice } from '../src/services/reports.js';
import { youtubeId } from '../src/services/resources.js';
import { tierFor } from '../src/tiers.js';
import { alice, bob, carol, file, makeContext, makeImage } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof makeContext>>;
let ctx: Ctx;
let app: ReturnType<typeof createApi>;
const notices: ReportNotice[] = [];

// alice 관리자, bob · alice 서버 멤버, carol 은 멤버 아님
const fakeBot: BotBridge = {
  isOnline: () => true,
  sendOriginalDm: async () => undefined,
  isGuildAdmin: async (id) => id === alice.id,
  isGuildMember: async (id) => id === alice.id || id === bob.id,
  postReport: async (n) => {
    notices.push(n);
  },
};

beforeEach(async () => {
  notices.length = 0;
  ctx = await makeContext({}, fakeBot);
  app = createApi(ctx);
});
afterEach(async () => {
  await ctx.db.close();
});

const json = async (res: Response) => (await res.json()) as any;
async function call(path: string, user: typeof alice | null, body?: unknown) {
  const headers: Record<string, string> = {};
  if (user) headers.authorization = `Bearer ${await ctx.community.createSession(user, 'plugin')}`;
  if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  return app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
}

describe('티어 (상대평가)', () => {
  it('5위 안은 다이아몬드, 그다음은 상위 % 로', () => {
    expect(tierFor(1, 3)).toBe('diamond');
    expect(tierFor(5, 100)).toBe('diamond');
    expect(tierFor(6, 100)).toBe('titanium');
    expect(tierFor(20, 100)).toBe('titanium');
    expect(tierFor(21, 100)).toBe('platinum');
    expect(tierFor(41, 100)).toBe('gold');
    expect(tierFor(61, 100)).toBe('silver');
    expect(tierFor(81, 100)).toBe('bronze');
    expect(tierFor(100, 100)).toBe('bronze');
  });
});

describe('인기순은 반응 점수로', () => {
  it('⭐ 하나(2점)가 👍 하나(1점)보다 위', async () => {
    const a = await ctx.refs.create({ file: file(await makeImage('#050505', '#ff2030')), category: 'non_gm', title: 'A', uploader: bob });
    const b = await ctx.refs.create({ file: file(await makeImage('#0a0a30', '#3060ff', { shape: 'stripes' })), category: 'non_gm', title: 'B', uploader: bob });
    await ctx.community.upsertUser(carol);
    await ctx.refs.toggleReaction(a.id, carol, '👍');
    await ctx.refs.toggleReaction(b.id, carol, '⭐');
    const { items } = await ctx.refs.popular({ period: 'all' });
    expect(items.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(items[0]).toMatchObject({ periodPoints: 2, periodReactions: 1 });
  });
});

describe('사이트에서 지우기', () => {
  it('관리자는 남이 올린 것도, 다른 사람은 못 지움', async () => {
    const ref = await ctx.refs.create({ file: file(await makeImage('#050505', '#ff2030')), category: 'non_gm', title: 'A', uploader: bob });
    expect((await call(`/api/refs/${ref.id}/delete`, carol, {})).status).toBe(403);
    expect((await json(await call(`/api/refs/${ref.id}/delete`, alice, {}))).ok).toBe(true);
    expect(await ctx.refs.get(ref.id)).toBeNull();
  });
});

describe('신고', () => {
  it('신고하면 관리자 채널 알림, 관리자가 처리', async () => {
    const ref = await ctx.refs.create({ file: file(await makeImage('#050505', '#ff2030')), category: 'non_gm', title: 'Red', uploader: bob });
    expect((await call('/api/reports', null, { targetType: 'ref', targetId: ref.id, reason: 'duplicate' })).status).toBe(401);
    expect((await json(await call('/api/reports', carol, { targetType: 'ref', targetId: ref.id, reason: 'nope' }))).error).toMatch(/이유/);
    expect((await json(await call('/api/reports', carol, { targetType: 'ref', targetId: ref.id, reason: 'other' }))).error).toMatch(/적어/);

    const r = await json(await call('/api/reports', carol, { targetType: 'ref', targetId: ref.id, reason: 'stolen', note: '제 작품이에요' }));
    expect(r.report).toMatchObject({ reason: 'stolen', status: 'open', note: '제 작품이에요' });
    expect(notices).toHaveLength(1);
    expect(notices[0].target).toMatchObject({ title: `#${ref.id} Red`, uploaderId: bob.id });
    expect((await json(await call('/api/reports', carol, { targetType: 'ref', targetId: ref.id, reason: 'duplicate' }))).code).toBe('already_reported');

    // 관리자만 목록 · 처리
    expect((await call('/api/admin/reports', bob)).status).toBe(403);
    const list = await json(await call('/api/admin/reports', alice));
    expect(list.items).toHaveLength(1);
    expect(list.items[0].target.title).toBe(`#${ref.id} Red`);
    expect((await json(await call('/api/auth/me', alice))).user.openReports).toBe(1);
    const closed = await json(await call(`/api/admin/reports/${r.report.id}`, alice, { status: 'dismissed' }));
    expect(closed.report.status).toBe('dismissed');
    expect(await ctx.reports.openCount()).toBe(0);
  });
});

describe('에셋 · 플러그인 · 텍스쳐팩', () => {
  it('유튜브 주소 읽기', () => {
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ?t=3')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('이미지 파일 에셋은 그 이미지가 미리보기, 제작자 없어도 됨, 점수는 종류별', async () => {
    await ctx.resources.addTag('asset', 'overlay', null, { id: alice.id, isAdmin: true });
    const form = new FormData();
    form.append('kind', 'asset');
    form.append('tags', 'overlay');
    form.append('file', new Blob([new Uint8Array(await makeImage('#ffffff', '#000000'))], { type: 'image/png' }), 'light_leak_01.png');
    const res = await call('/api/resources', bob, form);
    expect(res.status).toBe(200);
    const { item } = await res.json() as any;
    expect(item).toMatchObject({ kind: 'asset', title: 'light leak 01', creators: [], tags: ['overlay'], file: { name: 'light_leak_01.png' } });
    expect(item.preview.url).toContain('/api/previews/resources/');

    // 레퍼런스 태그는 에셋에 못 씀 (탭마다 태그가 따로)
    const bad = new FormData();
    bad.append('kind', 'asset');
    bad.append('tags', 'glow');
    bad.append('linkUrl', 'https://example.com/x.zip');
    expect((await json(await call('/api/resources', bob, bad))).code).toBe('unknown_tag');

    // 플러그인: 파일 + 미리보기 사진 + 유튜브
    const plugin = new FormData();
    plugin.append('kind', 'plugin');
    plugin.append('title', 'Glow Maker');
    plugin.append('creators', 'tntman, Kim');
    plugin.append('description', '한 번에 글로우를 만들어 줘요.\n두 줄째');
    plugin.append('file', new Blob([new Uint8Array([80, 75, 3, 4, 1, 2, 3])], { type: 'application/zip' }), 'glow-maker.zip');
    plugin.append('images', new Blob([new Uint8Array(await makeImage('#101010', '#20ff20'))], { type: 'image/png' }), 'shot1.png');
    plugin.append('images', new Blob([new Uint8Array(await makeImage('#202020', '#ff20ff'))], { type: 'image/png' }), 'shot2.png');
    plugin.append('youtube', 'https://youtu.be/dQw4w9WgXcQ');
    const p = (await json(await call('/api/resources', bob, plugin))).item;
    expect(p.media.map((m: any) => m.type)).toEqual(['image', 'image', 'youtube']);
    expect(p.creators.map((c: any) => c.name)).toEqual(['tntman', 'Kim']);
    expect(p.description).toBe('한 번에 글로우를 만들어 줘요.\n두 줄째');

    // 파일 받기 (로그인 필요) · 받은 횟수
    expect((await call(`/api/resources/${p.id}/file`, null)).status).toBe(401);
    const dl = await call(`/api/resources/${p.id}/file`, carol);
    expect(dl.status).toBe(200);
    expect(Buffer.from(await dl.arrayBuffer())).toEqual(Buffer.from([80, 75, 3, 4, 1, 2, 3]));
    expect((await json(await call(`/api/resources/${p.id}`, null))).item.downloads).toBe(1);

    // 점수: 에셋 10 + 플러그인 20
    const s = (await ctx.community.score(bob.id))!;
    expect(s).toMatchObject({ resourceUploads: 2, uploads: 0, score: 30 });

    // 목록 · 검색 · 태그 필터
    expect((await json(await call('/api/resources?kind=asset', null))).items.map((r: any) => r.id)).toEqual([item.id]);
    expect((await json(await call('/api/resources?kind=plugin&q=glow', null))).total).toBe(1);
    expect((await json(await call('/api/resources?kind=asset&tags=overlay', null))).total).toBe(1);
    expect((await json(await call('/api/resources/tags?kind=asset', null))).tags).toEqual([{ name: 'overlay', description: null, count: 1 }]);

    // 신고도 됨
    expect((await call('/api/reports', carol, { targetType: 'resource', targetId: p.id, reason: 'broken' })).status).toBe(200);
    expect(notices.at(-1)!.target.title).toBe(`플러그인 #${p.id} Glow Maker`);

    // 지우기: 다른 사람은 못 지움, 올린 사람은 됨 → 점수도 빠짐
    expect((await call(`/api/resources/${p.id}/delete`, carol, {})).status).toBe(403);
    expect((await json(await call(`/api/resources/${p.id}/delete`, bob, {}))).ok).toBe(true);
    expect((await ctx.community.score(bob.id))!.score).toBe(10);
  });

  it('입력 검사: 멤버만 · 파일이나 링크 필수 · 태그 관리는 관리자만', async () => {
    const empty = new FormData();
    empty.append('kind', 'texturepack');
    expect((await call('/api/resources', carol, empty)).status).toBe(403);
    expect((await json(await call('/api/resources', bob, empty))).error).toMatch(/파일을 고르거나/);
    const badLink = new FormData();
    badLink.append('kind', 'texturepack');
    badLink.append('linkUrl', 'ftp://x');
    expect((await json(await call('/api/resources', bob, badLink))).error).toMatch(/https/);
    const link = new FormData();
    link.append('kind', 'texturepack');
    link.append('title', 'Big pack');
    link.append('linkUrl', 'https://drive.example.com/pack.zip');
    const t = (await json(await call('/api/resources', bob, link))).item;
    expect(t).toMatchObject({ file: null, linkUrl: 'https://drive.example.com/pack.zip', preview: null });
    expect((await ctx.community.score(bob.id))!.score).toBe(20);

    expect((await call('/api/admin/resource-tags', bob, { kind: 'plugin', name: 'photoshop' })).status).toBe(403);
    expect((await call('/api/admin/resource-tags', alice, { kind: 'plugin', name: 'Photoshop' })).status).toBe(200);
    const renamed = await json(await call('/api/admin/resource-tags/rename', alice, { kind: 'plugin', from: 'photoshop', to: 'ps' }));
    expect(renamed).toMatchObject({ from: 'photoshop', to: 'ps' });
    expect((await call('/api/admin/resource-tags/delete', alice, { kind: 'plugin', name: 'ps' })).status).toBe(200);
  });
});

describe('제작과정(스피드아트) 영상', () => {
  it('남이 올린 레퍼런스에도 붙이면 +10점, speedart 태그 자동, 누가 붙였는지 표시', async () => {
    const ref = await ctx.refs.create({ file: file(await makeImage('#050505', '#ff2030')), category: 'non_gm', title: 'Red', tags: ['glow'], uploader: alice });
    expect((await call(`/api/refs/${ref.id}/videos`, null, { url: 'https://youtu.be/dQw4w9WgXcQ' })).status).toBe(401);
    expect((await call(`/api/refs/${ref.id}/videos`, carol, { url: 'https://youtu.be/dQw4w9WgXcQ' })).status).toBe(403);
    expect((await json(await call(`/api/refs/${ref.id}/videos`, bob, { url: 'https://example.com/x' }))).code).toBe('bad_url');
    expect((await json(await call(`/api/refs/${ref.id}/videos`, bob, { url: 'https://youtu.be/notfound000' }))).code).toBe('video_not_found');

    const res = await json(await call(`/api/refs/${ref.id}/videos`, bob, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }));
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ youtubeId: 'dQw4w9WgXcQ', title: '영상 dQw4w9WgXcQ', addedBy: { id: bob.id }, canRemove: true });
    expect(res.item.tags).toEqual(['glow', 'speedart']);
    expect(res.item.videoCount).toBe(1);
    expect((await ctx.community.score(bob.id))!).toMatchObject({ videos: 1, score: 10 });

    // 한 사람당 하나, 같은 영상 중복 안 됨
    expect((await json(await call(`/api/refs/${ref.id}/videos`, bob, { url: 'https://youtu.be/aaaaaaaaaaa' }))).code).toBe('one_per_user');
    expect((await json(await call(`/api/refs/${ref.id}/videos`, alice, { url: 'dQw4w9WgXcQ' }))).code).toBe('duplicate_video');
    await call(`/api/refs/${ref.id}/videos`, alice, { url: 'bbbbbbbbbbb' });

    // 누가 지울 수 있나: 다른 멤버 ✕, 붙인 사람 ✓, 레퍼런스 올린 사람 ✓
    const list = (await json(await call(`/api/refs/${ref.id}/videos`, null))).items;
    expect(list.map((v: any) => v.canRemove)).toEqual([false, false]);
    const bobVideo = list.find((v: any) => v.addedBy.id === bob.id);
    expect((await call(`/api/refs/${ref.id}/videos/${bobVideo.id}/delete`, carol, {})).status).toBe(403);
    const afterOne = await json(await call(`/api/refs/${ref.id}/videos/${bobVideo.id}/delete`, alice, {}));
    expect(afterOne.item.tags).toContain('speedart'); // 아직 영상이 하나 남음
    expect((await ctx.community.score(bob.id))?.videos ?? 0).toBe(0);
    const last = afterOne.items[0];
    const afterAll = await json(await call(`/api/refs/${ref.id}/videos/${last.id}/delete`, alice, {}));
    expect(afterAll.items).toEqual([]);
    expect(afterAll.item.tags).toEqual(['glow']); // 영상이 다 빠지면 태그도 빠짐
  });
});
