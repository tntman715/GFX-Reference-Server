import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuplicateError } from '../src/services/references.js';
import { alice, bob, carol, file, makeContext, makeImage } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof makeContext>>;
let ctx: Ctx;

beforeEach(async () => {
  ctx = await makeContext();
});
afterEach(async () => {
  await ctx.db.close();
});

const admin = { id: 'admin-1', isAdmin: true };

async function seed() {
  const a = await ctx.refs.create({
    file: file(await makeImage('#060606', '#e01020'), 'red_glow.png'),
    category: 'gm_thumbnail',
    mapName: 'Bloodbath',
    creatorName: 'Riot',
    tags: ['glow', 'complex'],
    uploader: alice,
  });
  const b = await ctx.refs.create({
    file: file(await makeImage('#0a0a30', '#3060ff', { shape: 'stripes' }), 'blue.png'),
    category: 'gm_artwork',
    title: 'Blue Poster',
    tags: ['poster-like', 'modern'],
    uploader: bob,
  });
  const c = await ctx.refs.create({
    file: file(await makeImage('#fff7e0', '#ffb000', { shape: 'text' }), 'sunny.png'),
    category: 'non_gm',
    creatorName: 'SunArtist',
    tags: ['paint'],
    uploader: alice,
  });
  return { a, b, c };
}

describe('레퍼런스 등록', () => {
  it('미리보기, 색상, 태그, 아카이브가 모두 저장됨', async () => {
    const { a } = await seed();
    expect(a.id).toBeGreaterThan(0);
    expect(a.title).toBe('Bloodbath'); // 썸네일은 제목이 없으면 맵 이름
    expect(a.mapName).toBe('Bloodbath');
    expect(a.creatorName).toBe('Riot');
    expect(a.tags).toEqual(['complex', 'glow']);
    expect(a.primaryColor).toBe('red');
    expect(a.archiveMessageId).toBe(`local-${a.id}`);
    expect(await ctx.storage.get(a.previewKey)).not.toBeNull();
    const orig = await ctx.refs.fetchOriginal(a);
    expect(orig.filename).toBe(`ref-${a.id}.png`);
    expect(ctx.refs.downloadFilename(a, orig)).toBe(`${a.id} Bloodbath - Riot.png`);
  });

  it('제작자를 비우면 올린 사람 이름, 제목을 비우면 파일 이름', async () => {
    const r = await ctx.refs.create({
      file: file(await makeImage('#123456'), 'my_cool-art.png'),
      category: 'non_gm',
      uploader: bob,
    });
    expect(r.creatorName).toBe('밥');
    expect(r.title).toBe('my cool art');
    expect(r.mapName).toBeNull();
  });

  it('지메 썸네일은 맵 이름 필수', async () => {
    await expect(
      ctx.refs.create({ file: file(await makeImage('#000')), category: 'gm_thumbnail', uploader: alice }),
    ).rejects.toThrow(/맵 이름/);
  });

  it('맵 이름이 없는 분류에서는 맵 이름이 무시됨', async () => {
    const r = await ctx.refs.create({ file: file(await makeImage('#333')), category: 'non_gm', mapName: 'X', uploader: alice });
    expect(r.mapName).toBeNull();
  });

  it('없는 태그는 거절하고 사용 가능한 태그를 알려줌', async () => {
    await expect(
      ctx.refs.create({ file: file(await makeImage('#000')), category: 'non_gm', tags: ['glow', 'nope'], uploader: alice }),
    ).rejects.toThrow(/없는 태그입니다: `nope`[\s\S]*`grunge`/);
  });

  it('비슷한 이미지는 중복으로 감지, 강제 등록 가능', async () => {
    const img = await makeImage('#060606', '#e01020');
    await ctx.refs.create({ file: file(img), category: 'non_gm', uploader: alice });
    const err = await ctx.refs.create({ file: file(img), category: 'non_gm', uploader: bob }).catch((e) => e);
    expect(err).toBeInstanceOf(DuplicateError);
    expect((err as DuplicateError).matches).toHaveLength(1);
    const forced = await ctx.refs.create({ file: file(img), category: 'non_gm', uploader: bob }, { allowDuplicate: true });
    expect(forced.id).toBeGreaterThan(0);
  });

  it('너무 큰 파일은 거절', async () => {
    const small = await makeContext({ MAX_UPLOAD_MB: '0.001' });
    await expect(
      small.refs.create({ file: file(await makeImage('#000', '#fff', { w: 800, h: 800, shape: 'stripes' })), category: 'non_gm', uploader: alice }),
    ).rejects.toThrow(/너무 큽니다/);
    await small.db.close();
  });
});

describe('검색', () => {
  it('텍스트 / 분류 / 태그 / 색상 / 번호', async () => {
    const { a, b, c } = await seed();
    const ids = (r: { items: { id: number }[] }) => r.items.map((i) => i.id);

    expect(ids(await ctx.refs.search({ q: 'blood' }))).toEqual([a.id]);
    expect(ids(await ctx.refs.search({ q: 'riot' }))).toEqual([a.id]);
    expect(ids(await ctx.refs.search({ q: 'poster' }))).toEqual([b.id]); // 태그도 텍스트 검색에 포함
    expect(ids(await ctx.refs.search({ q: `#${c.id}` }))).toEqual([c.id]);
    expect(ids(await ctx.refs.search({ category: 'gm_artwork' }))).toEqual([b.id]);
    expect(ids(await ctx.refs.search({ tags: ['glow', 'complex'] }))).toEqual([a.id]);
    expect(ids(await ctx.refs.search({ tags: ['glow', 'paint'] }))).toEqual([]);
    expect(ids(await ctx.refs.search({ color: 'red' }))).toEqual([a.id]);
    expect(ids(await ctx.refs.search({ color: 'blue' }))).toEqual([b.id]);
    expect(ids(await ctx.refs.search({ creator: 'sun' }))).toEqual([c.id]);
    expect(ids(await ctx.refs.search({ uploaderId: alice.id, sort: 'oldest' }))).toEqual([a.id, c.id]);
    expect((await ctx.refs.search({})).total).toBe(3);
    expect(ids(await ctx.refs.search({ sort: 'newest', limit: 2 }))).toEqual([c.id, b.id]);
    expect(ids(await ctx.refs.search({ sort: 'newest', limit: 2, offset: 2 }))).toEqual([a.id]);
    // LIKE 특수문자는 그대로 문자로 취급
    expect((await ctx.refs.search({ q: '%' })).total).toBe(0);
  });

  it('랜덤', async () => {
    const { a } = await seed();
    const r = await ctx.refs.random({ category: 'gm_thumbnail' });
    expect(r?.id).toBe(a.id);
    expect(await ctx.refs.random({ tags: ['grunge'] })).toBeNull();
  });

  it('비슷한 색 / hex 색상 검색', async () => {
    const { a, b } = await seed();
    const blue2 = await ctx.refs.create({
      file: file(await makeImage('#0b0b2c', '#2a58f0', { shape: 'text' }), 'blue2.png'),
      category: 'non_gm',
      uploader: carol,
    });
    const sim = await ctx.refs.similar(b.id);
    expect(sim.items[0].id).toBe(blue2.id);
    expect(sim.items.map((i) => i.id)).not.toContain(b.id);

    const red = await ctx.refs.byHex('#ff1020');
    expect(red.items[0].id).toBe(a.id);
    await expect(ctx.refs.byHex('zzz')).rejects.toThrow(/색상 코드/);
  });

  it('색상 계열별 개수', async () => {
    await seed();
    const stats = await ctx.refs.colorStats();
    expect(stats.red).toBe(1);
    expect(stats.blue).toBe(1);
    expect(stats.orange + stats.yellow).toBeGreaterThanOrEqual(1);
  });
});

describe('반응 / 인기 / 점수', () => {
  it('반응 토글과 인기순', async () => {
    const { a, b, c } = await seed();
    expect((await ctx.refs.toggleReaction(b.id, alice, '⭐')).active).toBe(true);
    await ctx.refs.toggleReaction(b.id, carol, '⭐');
    await ctx.refs.toggleReaction(b.id, carol, '🔥');
    await ctx.refs.toggleReaction(a.id, bob, '⭐');
    const off = await ctx.refs.toggleReaction(a.id, bob, '⭐');
    expect(off.active).toBe(false);
    await ctx.refs.toggleReaction(c.id, bob, '💎');
    await expect(ctx.refs.toggleReaction(c.id, bob, '🍕')).rejects.toThrow(/사용할 수 있는 반응/);

    const pop = await ctx.refs.popular({ period: 'week' });
    expect(pop.items.map((i) => i.id)).toEqual([b.id, c.id]); // 반응 없는 a 는 제외
    expect(pop.items[0].reactions).toEqual({ '⭐': 2, '🔥': 1 });
    expect(pop.items[0].periodReactions).toBe(3);

    const mine = await ctx.refs.myReactions([b.id], carol.id);
    expect(mine.get(b.id)?.sort()).toEqual(['⭐', '🔥'].sort());

    // 오래된 반응은 이번 주 인기에서 빠짐
    await ctx.db.query("UPDATE reactions SET created_at = now() - interval '20 days' WHERE ref_id = $1", [b.id]);
    expect((await ctx.refs.popular({ period: 'week' })).items.map((i) => i.id)).toEqual([c.id]);
    expect((await ctx.refs.popular({ period: 'month' })).items.map((i) => i.id)).toEqual([b.id, c.id]);
  });

  it('점수: 업로드 + 받은 반응(자기 반응 제외) + 관리자 조정', async () => {
    const { a, b } = await seed(); // alice 2개, bob 1개
    await ctx.refs.toggleReaction(a.id, bob, '⭐');
    await ctx.refs.toggleReaction(a.id, carol, '⭐');
    await ctx.refs.toggleReaction(a.id, alice, '⭐'); // 자기 반응 → 점수 X
    await ctx.refs.toggleReaction(b.id, alice, '🔥');

    const board = await ctx.community.leaderboard(1, 10);
    expect(board.total).toBe(2);
    expect(board.rows[0]).toMatchObject({ userId: alice.id, uploads: 2, reactionsReceived: 2, score: 22, rank: 1 });
    expect(board.rows[1]).toMatchObject({ userId: bob.id, uploads: 1, reactionsReceived: 1, score: 11, rank: 2 });

    await ctx.community.adjustScore(bob.id, 20, '이벤트 보상', admin);
    const bobScore = await ctx.community.score(bob.id);
    expect(bobScore).toMatchObject({ score: 31, rank: 1, adjustments: 20 });
    await expect(ctx.community.adjustScore(bob.id, 5, null, { id: 'x', isAdmin: false })).rejects.toThrow(/관리자/);

    // 레퍼런스를 지우면 점수도 빠짐
    await ctx.refs.delete(a.id, { id: alice.id, isAdmin: false });
    expect(await ctx.community.score(alice.id)).toMatchObject({ uploads: 1, reactionsReceived: 0, score: 10 });

    const profile = await ctx.community.profile(alice.id);
    expect(profile.categories).toEqual({ non_gm: 1 });
    expect(profile.recent).toHaveLength(1);
  });
});

describe('수정 / 삭제 권한', () => {
  it('올린 사람과 관리자만 수정 가능', async () => {
    const { a } = await seed();
    await expect(ctx.refs.update(a.id, { title: 'hack' }, { id: bob.id, isAdmin: false })).rejects.toThrow(/올린 사람이나 관리자/);
    const r = await ctx.refs.update(a.id, { title: 'New', addTags: ['3d'], removeTags: ['complex'] }, { id: alice.id, isAdmin: false });
    expect(r.title).toBe('New');
    expect(r.tags).toEqual(['3d', 'glow']);
    // 분류를 바꾸면 맵 이름 처리
    const moved = await ctx.refs.update(a.id, { category: 'non_gm' }, admin);
    expect(moved.category).toBe('non_gm');
    expect(moved.mapName).toBeNull();
    await expect(ctx.refs.update(a.id, { category: 'gm_thumbnail' }, admin)).rejects.toThrow(/맵 이름/);
    const back = await ctx.refs.update(a.id, { category: 'gm_thumbnail', mapName: 'Sonic Wave' }, admin);
    expect(back.mapName).toBe('Sonic Wave');
  });

  it('삭제하면 미리보기와 원본도 지워짐', async () => {
    const { b } = await seed();
    await expect(ctx.refs.delete(b.id, { id: alice.id, isAdmin: false })).rejects.toThrow(/삭제/);
    await ctx.refs.delete(b.id, admin);
    expect(await ctx.refs.get(b.id)).toBeNull();
    expect(await ctx.storage.get(b.previewKey)).toBeNull();
  });
});

describe('태그 관리', () => {
  it('기본 태그가 들어있고 관리자가 추가/이름변경/삭제', async () => {
    const names = await ctx.community.tagNames();
    expect(names).toContain('blender/c4d');
    expect(names).toContain('non-central-texted-composition');
    expect(names).toHaveLength(11);

    await expect(ctx.community.addTag('neon', null, { id: 'u', isAdmin: false })).rejects.toThrow(/관리자/);
    const t = await ctx.community.addTag('  Neon Light ', '네온', admin);
    expect(t.name).toBe('neon-light');
    await expect(ctx.community.addTag('neon-light', null, admin)).rejects.toThrow(/이미 있습니다/);
    await expect(ctx.community.addTag('!!', null, admin)).rejects.toThrow(/태그 이름은/);
    await ctx.community.addTag('타이포', null, admin);

    const { a } = await seed();
    await ctx.community.renameTag('glow', 'glow-fx', admin);
    expect((await ctx.refs.get(a.id))?.tags).toContain('glow-fx');
    await ctx.community.removeTag('glow-fx', admin);
    expect((await ctx.refs.get(a.id))?.tags).toEqual(['complex']);
    await expect(ctx.community.removeTag('glow-fx', admin)).rejects.toThrow(/없습니다/);
  });
});

describe('기기 연동 (플러그인/사이트 ↔ 디스코드)', () => {
  it('코드 발급 → /연동 승인 → 토큰 발급 (한 번만)', async () => {
    const { deviceCode, userCode } = await ctx.community.createDeviceCode('plugin');
    expect(userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect((await ctx.community.pollDeviceCode(deviceCode)).status).toBe('pending');

    await expect(ctx.community.approveDeviceCode('ZZZZ-ZZZZ', alice)).rejects.toThrow(/찾을 수 없습니다/);
    await ctx.community.approveDeviceCode(userCode.toLowerCase().replace('-', ''), alice); // 대소문자/하이픈 무시
    await expect(ctx.community.approveDeviceCode(userCode, bob)).rejects.toThrow(/이미 사용된/);

    const res = await ctx.community.pollDeviceCode(deviceCode);
    expect(res.status).toBe('approved');
    expect(res.token).toBeTruthy();
    expect((await ctx.community.pollDeviceCode(deviceCode)).status).toBe('consumed');

    const user = await ctx.community.userForToken(res.token!);
    expect(user).toMatchObject({ id: alice.id, tokenLabel: 'plugin' });
    await ctx.community.revokeToken(res.token!);
    expect(await ctx.community.userForToken(res.token!)).toBeNull();
  });

  it('만료된 코드', async () => {
    const { deviceCode, userCode } = await ctx.community.createDeviceCode('web');
    await ctx.db.query("UPDATE device_codes SET expires_at = now() - interval '1 minute'");
    await expect(ctx.community.approveDeviceCode(userCode, alice)).rejects.toThrow(/만료/);
    expect((await ctx.community.pollDeviceCode(deviceCode)).status).toBe('expired');
  });
});
