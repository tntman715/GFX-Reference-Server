import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api/app.js';
import type { BotBridge } from '../src/context.js';
import { normalizeCreators, splitCreatorNames } from '../src/services/references.js';
import { alice, bob, carol, file, makeContext, makeImage } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof makeContext>>;
let ctx: Ctx;
let app: ReturnType<typeof createApi>;
const dms: { userId: string; content: string }[] = [];

// alice 는 서버 관리자, bob 은 올린 사람, carol 은 일반 사용자
const fakeBot: BotBridge = {
  isOnline: () => true,
  sendOriginalDm: async () => undefined,
  isGuildAdmin: async (id) => id === alice.id,
  notifyUser: async (userId, content) => {
    dms.push({ userId, content });
  },
};

beforeEach(async () => {
  dms.length = 0;
  ctx = await makeContext({}, fakeBot);
  app = createApi(ctx);
});
afterEach(async () => {
  await ctx.db.close();
});

const json = async (res: Response) => (await res.json()) as any;

async function token(user = carol) {
  return ctx.community.createSession(user, 'plugin');
}

async function call(path: string, user: typeof alice | null, body?: unknown) {
  const headers: Record<string, string> = {};
  if (user) headers.Authorization = `Bearer ${await token(user)}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return app.request(path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function seedRef(uploader = bob) {
  return ctx.refs.create({
    file: file(await makeImage('#050505', '#ff2030')),
    category: 'gm_thumbnail',
    mapName: 'Voltage',
    creatorName: 'tntman',
    tags: ['glow'],
    uploader,
  });
}

describe('여러 제작자', () => {
  it('쉼표로 이어 쓴 이름을 나눔 (같은 이름은 한 번만)', () => {
    expect(splitCreatorNames(' A ,B,, a ,C ')).toEqual(['A', 'B', 'C']);
    expect(splitCreatorNames('')).toEqual([]);
    expect(normalizeCreators([{ name: 'A, B', id: '123456789' }, { name: 'b', id: '987654321' }])).toEqual([
      { name: 'A', id: '123456789' },
      { name: 'B', id: '987654321' },
    ]);
    expect(() => normalizeCreators([{ name: 'a,b,c,d,e,f,g,h,i' }])).toThrow(/최대 8명/);
  });

  it('등록할 때 여러 명, 검색/자동완성/공개 형태', async () => {
    const ref = await ctx.refs.create({
      file: file(await makeImage('#101010', '#20ff20')),
      category: 'non_gm',
      creatorName: 'Alpha, Beta',
      creatorId: '111111111111111111',
      uploader: bob,
    });
    expect(ref.creators).toEqual([
      { name: 'Alpha', id: '111111111111111111' },
      { name: 'Beta', id: null },
    ]);
    expect(ref.creatorName).toBe('Alpha, Beta');
    expect(ref.creatorId).toBe('111111111111111111');
    expect(ctx.refs.toPublic(ref).creators).toHaveLength(2);
    expect((await ctx.refs.search({ creator: 'beta' })).total).toBe(1);
    expect(await ctx.refs.creators('bet')).toEqual(['Beta']);

    const updated = await ctx.refs.update(ref.id, { creatorName: 'Beta, Gamma' }, { id: bob.id, isAdmin: false });
    expect(updated.creators.map((c) => c.name)).toEqual(['Beta', 'Gamma']);
    expect(updated.creatorName).toBe('Beta, Gamma');
  });

  it('가져오기 이름 통일은 여러 명 중 그 사람만 바꿈', async () => {
    await ctx.refs.create({
      file: file(await makeImage('#101010', '#20ff20')),
      category: 'non_gm',
      creatorName: 'tntman, Beta',
      uploader: bob,
    });
    const counts = await ctx.importer.nameCounts('creator');
    expect(counts.find((c) => c.name === 'Beta')?.count).toBe(1);
    await ctx.importer.renameAll('creator', ['tntman'], 'TNTMAN', { id: alice.id, isAdmin: true });
    const { items } = await ctx.refs.search({});
    expect(items[0].creators.map((c) => c.name)).toEqual(['TNTMAN', 'Beta']);
  });
});

describe('수정과 수정 제안', () => {
  it('올린 사람은 바로 고침 (점수 없음)', async () => {
    const ref = await seedRef();
    const res = await json(await call(`/api/refs/${ref.id}/edit`, bob, { tags: ['glow', 'grunge'], creators: 'tntman, Kim' }));
    expect(res.mode).toBe('applied');
    expect(res.item.tags).toEqual(['glow', 'grunge']);
    expect(res.item.creators.map((c: any) => c.name)).toEqual(['tntman', 'Kim']);
    expect((await ctx.community.score(bob.id))!.acceptedEdits).toBe(0);
  });

  it('관리자는 남이 올린 것도 바로 고침', async () => {
    const ref = await seedRef();
    const res = await json(await call(`/api/refs/${ref.id}/edit`, alice, { mapName: 'Voltage 2' }));
    expect(res.mode).toBe('applied');
    expect(res.item.mapName).toBe('Voltage 2');
  });

  it('다른 사람은 제안 → 올린 사람이 받아들이면 바뀌고 업로드 점수의 절반', async () => {
    const ref = await seedRef();
    const res = await json(await call(`/api/refs/${ref.id}/edit`, carol, { tags: ['grunge'], note: '글로우는 아닌 것 같아요' }));
    expect(res.mode).toBe('proposed');
    expect(res.proposal.changes).toEqual({ addTags: ['grunge'], removeTags: ['glow'] });
    expect(res.proposal.before.tags).toEqual(['glow']);
    // 아직은 그대로
    expect((await ctx.refs.require(ref.id)).tags).toEqual(['glow']);
    // 올린 사람에게 DM 알림
    expect(dms.find((d) => d.userId === bob.id)?.content).toMatch(/수정을 제안/);

    // 올린 사람 화면: 받은 제안 1개 / 메뉴 숫자
    const me = await json(await call('/api/auth/me', bob));
    expect(me.user.pendingEdits).toBe(1);
    const received = await json(await call('/api/edits/received', bob));
    expect(received.items).toHaveLength(1);
    expect(received.items[0].ref.id).toBe(ref.id);
    // 상세 화면: 올린 사람은 모든 제안, 다른 사람은 자기 것만
    expect((await json(await call(`/api/refs/${ref.id}/proposals`, bob))).proposals).toHaveLength(1);
    expect((await json(await call(`/api/refs/${ref.id}/proposals`, null))).proposals).toHaveLength(0);

    // 제안한 사람은 직접 받아들일 수 없음
    expect((await call(`/api/edits/${res.proposal.id}/accept`, carol, {})).status).toBe(403);

    const accepted = await json(await call(`/api/edits/${res.proposal.id}/accept`, bob, {}));
    expect(accepted.item.tags).toEqual(['grunge']);
    expect(accepted.proposal.status).toBe('accepted');
    expect(dms.find((d) => d.userId === carol.id)?.content).toMatch(/받아들여졌어요/);

    const score = (await ctx.community.score(carol.id))!;
    expect(score.acceptedEdits).toBe(1);
    expect(score.score).toBe(ctx.config.scoring.pointsPerUpload / 2);
    expect(ctx.config.scoring.pointsPerEdit).toBe(5);
    // 두 번 받아들일 수 없음
    expect((await call(`/api/edits/${res.proposal.id}/accept`, bob, {})).status).toBe(400);
  });

  it('거절 / 취소 / 다시 제안하면 예전 제안은 대체', async () => {
    const ref = await seedRef();
    const p1 = (await json(await call(`/api/refs/${ref.id}/edit`, carol, { mapName: 'Voltag' }))).proposal;
    const p2 = (await json(await call(`/api/refs/${ref.id}/edit`, carol, { mapName: 'Voltage!' }))).proposal;
    expect((await ctx.edits.require(p1.id)).status).toBe('cancelled');
    expect(await ctx.edits.pendingCount(bob.id)).toBe(1);

    // 관리자도 거절할 수 있음
    const rejected = await json(await call(`/api/edits/${p2.id}/reject`, alice, { reason: '원래 이름이 맞아요' }));
    expect(rejected.proposal.status).toBe('rejected');
    expect(dms.at(-1)?.content).toMatch(/원래 이름이 맞아요/);
    expect((await ctx.community.score(carol.id))?.acceptedEdits ?? 0).toBe(0);

    const p3 = (await json(await call(`/api/refs/${ref.id}/edit`, carol, { title: 'New title' }))).proposal;
    expect((await call(`/api/edits/${p3.id}/cancel`, bob, {})).status).toBe(403);
    expect((await json(await call(`/api/edits/${p3.id}/cancel`, carol, {}))).proposal.status).toBe('cancelled');
    expect((await json(await call('/api/edits/sent', carol))).items.map((p: any) => p.status)).toEqual(['rejected']);
  });

  it('바뀐 게 없거나 잘못된 값이면 거절', async () => {
    const ref = await seedRef();
    expect((await json(await call(`/api/refs/${ref.id}/edit`, carol, { tags: ['glow'] }))).code).toBe('no_changes');
    expect((await json(await call(`/api/refs/${ref.id}/edit`, carol, { tags: ['nope'] }))).code).toBe('unknown_tag');
    expect((await json(await call(`/api/refs/${ref.id}/edit`, carol, { mapName: '' }))).code).toBe('map_required');
    expect((await call(`/api/refs/${ref.id}/edit`, null, { title: 'x' })).status).toBe(401);
  });

  it('레퍼런스를 지우면 그 제안 점수도 빠짐', async () => {
    const ref = await seedRef();
    const p = (await json(await call(`/api/refs/${ref.id}/edit`, carol, { title: 'Better' }))).proposal;
    await call(`/api/edits/${p.id}/accept`, bob, {});
    expect((await ctx.community.score(carol.id))!.acceptedEdits).toBe(1);
    await ctx.refs.delete(ref.id, { id: bob.id, isAdmin: false });
    expect(await ctx.community.score(carol.id)).toBeNull();
  });
});

describe('보드', () => {
  it('만들기 · 넣기 · 빼기 · 이름 바꾸기 · 지우기', async () => {
    const ref = await seedRef();
    const created = (await json(await call('/api/boards', carol, { name: '  글로우  모음 ', refId: ref.id }))).item;
    expect(created).toMatchObject({ name: '글로우 모음', count: 1 });
    expect(created.covers[0].id).toBe(ref.id);
    expect((await json(await call('/api/boards', carol, { name: '글로우 모음' }))).code).toBe('board_exists');

    // 상세 화면에서 이 레퍼런스가 들어 있는 보드 표시
    const mine = (await json(await call(`/api/boards?ref=${ref.id}`, carol))).items;
    expect(mine).toHaveLength(1);
    expect(mine[0].has).toBe(true);

    // 누구나 볼 수 있음
    const page = await json(await call(`/api/boards/${created.id}/refs`, null));
    expect(page.items.map((r: any) => r.id)).toEqual([ref.id]);
    expect((await json(await call(`/api/boards?owner=${carol.id}`, null))).items).toHaveLength(1);

    // 남의 보드는 못 고침
    expect((await call(`/api/boards/${created.id}/items`, bob, { refId: ref.id, on: false })).status).toBe(403);

    const removed = (await json(await call(`/api/boards/${created.id}/items`, carol, { refId: ref.id, on: false }))).item;
    expect(removed.count).toBe(0);
    expect((await json(await call(`/api/boards/${created.id}`, carol, { name: 'Glow' }))).item.name).toBe('Glow');
    expect((await json(await call(`/api/boards/${created.id}/delete`, carol, {}))).ok).toBe(true);
    expect((await call(`/api/boards/${created.id}`, null)).status).toBe(404);
  });

  it('레퍼런스를 지우면 보드에서도 빠짐', async () => {
    const ref = await seedRef();
    const b = await ctx.boards.create(carol, 'x');
    await ctx.boards.setItem(b.id, carol.id, ref.id, true);
    await ctx.refs.delete(ref.id, { id: bob.id, isAdmin: false });
    expect((await ctx.boards.require(b.id)).count).toBe(0);
  });
});
