import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api/app.js';
import type { BotBridge } from '../src/context.js';
import { type ImportSource, parseCaption, type SourceMessage } from '../src/services/importer.js';
import { DuplicateError } from '../src/services/references.js';
import { editDistance, findSimilarGroups, groupKey, looksSame, normalizeName, similarTo } from '../src/util/similar.js';
import { alice, bob, file, makeContext, makeImage } from './helpers.js';

describe('"맵이름 by 제작자" 읽기', () => {
  it('기본 형식과 꾸밈 문법', () => {
    expect(parseCaption('Bloodbath by Riot')).toEqual({ mapName: 'Bloodbath', creatorName: 'Riot', creatorId: null });
    expect(parseCaption('**Sonic Wave** by __Cyclic__ !')).toMatchObject({ mapName: 'Sonic Wave', creatorName: 'Cyclic' });
    expect(parseCaption('ㅋㅋ 잘만들었다\nTartarus BY Dolphy')).toMatchObject({ mapName: 'Tartarus', creatorName: 'Dolphy' });
    expect(parseCaption('Acheron by: ryamu <:fire:123456>')).toMatchObject({ mapName: 'Acheron', creatorName: 'ryamu' });
  });

  it('제작자가 멘션이면 이름으로 바꾸고 ID 도 기억', () => {
    expect(parseCaption('Kocmoc by <@42>', [{ id: '42', name: 'Nova' }])).toEqual({ mapName: 'Kocmoc', creatorName: 'Nova', creatorId: '42' });
  });

  it('맵 이름 없이 by 만 있거나 by 가 없으면', () => {
    expect(parseCaption('by Zylenox')).toMatchObject({ mapName: null, creatorName: 'Zylenox' });
    expect(parseCaption('그냥 사진')).toEqual({ mapName: null, creatorName: null, creatorId: null });
    // "baby" 같은 단어 안의 by 는 무시
    expect(parseCaption('baby shark')).toEqual({ mapName: null, creatorName: null, creatorId: null });
  });
});

describe('비슷한 이름 찾기', () => {
  it('대소문자 · 공백 · 기호 · 오타 1~2글자', () => {
    expect(normalizeName('Zy-lenox ')).toBe('zylenox');
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(looksSame('Zylenox', 'zylenox')).toBe(true);
    expect(looksSame('Zylenox', 'Zylen0x')).toBe(true);
    expect(looksSame('Knobbelboy', 'Knobelboy')).toBe(true);
    expect(looksSame('Riot', 'Rio')).toBe(false); // 너무 짧으면 오타 허용 안 함
    expect(looksSame('Riot', 'Trick')).toBe(false);
  });

  it('묶음은 많이 쓴 이름을 추천하고, 무시한 묶음은 빼기', () => {
    const counts = [
      { name: 'Zylenox', count: 5 },
      { name: 'zylenox', count: 2 },
      { name: 'Zylen0x', count: 1 },
      { name: 'Riot', count: 9 },
      { name: 'Cyclic', count: 3 },
      { name: 'cyclic ', count: 1 },
    ];
    const groups = findSimilarGroups(counts);
    expect(groups.map((g) => g.suggested)).toEqual(['Zylenox', 'Cyclic']);
    expect(groups[0].names.map((n) => n.name)).toEqual(['Zylenox', 'zylenox', 'Zylen0x']);
    expect(findSimilarGroups(counts, new Set([groupKey(['cyclic ', 'Cyclic'])]))).toHaveLength(1);
    // 입력 중인 이름 기준: 한 글자 차이까지만
    expect(similarTo('zylenoxx', counts).map((n) => n.name)).toEqual(['Zylenox', 'zylenox']);
  });
});

// ── 후보 저장 → 태그 → 레퍼런스로 옮기기 ───────────────────────

type Ctx = Awaited<ReturnType<typeof makeContext>>;
let ctx: Ctx;
let messages: SourceMessage[];
let images: Record<string, Buffer>;

function msg(id: string, content: string, attachments: { id: string; name?: string }[] = [], extra: Partial<SourceMessage> = {}): SourceMessage {
  return {
    id,
    channelId: '900',
    authorId: bob.id,
    authorName: 'bob',
    content,
    postedAt: new Date(Date.UTC(2026, 5, Number(id) % 28 || 1)),
    mentions: [],
    attachments: attachments.map((a) => ({ id: a.id, filename: a.name ?? `${a.id}.png`, contentType: (a.name ?? '.png').endsWith('.png') ? 'image/png' : 'text/plain', size: 1000, width: 640, height: 360 })),
    ...extra,
  };
}

const source: ImportSource = {
  listChannels: async () => [{ id: '900', name: 'gdfx', parentName: '레퍼런스' }],
  // 최신 → 과거 순, before 이전 것만
  fetchMessages: async (_ch, before) => {
    const sorted = [...messages].sort((a, b) => Number(b.id) - Number(a.id));
    const start = before ? sorted.findIndex((m) => m.id === before) + 1 : 0;
    return sorted.slice(start, start + 100);
  },
  fetchAttachment: async (_ch, _msg, attachmentId) =>
    images[attachmentId] ? { buffer: images[attachmentId], filename: `${attachmentId}.png`, contentType: 'image/png' } : null,
};

const bot: BotBridge = {
  isOnline: () => true,
  sendOriginalDm: async () => undefined,
  isGuildAdmin: async (id) => id === alice.id,
  importSource: source,
};

beforeEach(async () => {
  ctx = await makeContext({}, bot);
  images = {
    a1: await makeImage('#050505', '#ff2030'),
    a2: await makeImage('#0a0a30', '#3060ff', { shape: 'stripes' }),
    a3: await makeImage('#103010', '#30ff60', { shape: 'text' }),
  };
  messages = [
    msg('1', 'Bloodbath by Riot', [{ id: 'a1' }]),
    msg('2', '오늘 점심 뭐먹지'),
    msg('3', 'Sonic Wave by zylenox', [{ id: 'a2' }, { id: 'readme', name: 'notes.txt' }]),
    msg('4', '이거 보세요', [{ id: 'x9' }]), // by 없음 → 레퍼런스 아님
    msg('5', 'Tartarus by Zylenox', [{ id: 'a3' }]),
  ];
  // 페이지 넘김 확인용으로 잡담 150개
  for (let i = 0; i < 150; i++) messages.push(msg(String(1000 + i), `잡담 ${i}`));
});
afterEach(async () => {
  await ctx.db.close();
});

describe('채널에서 후보 찾기', () => {
  it('by 가 있고 이미지가 있는 글만, 이미지마다 후보 하나 · 다시 확인해도 중복 없음', async () => {
    await ctx.importer.runScan(source, '900');
    expect(ctx.importer.scanState()).toMatchObject({ scanned: 155, found: 3, added: 3, contentHidden: false, error: null });
    const items = await ctx.importer.list('pending');
    expect(items.map((i) => [i.mapName, i.creatorName, i.category])).toEqual([
      ['Bloodbath', 'Riot', 'gm_thumbnail'],
      ['Sonic Wave', 'zylenox', 'gm_thumbnail'],
      ['Tartarus', 'Zylenox', 'gm_thumbnail'],
    ]);
    await ctx.importer.runScan(source, '900');
    expect(ctx.importer.scanState().added).toBe(0);
    expect((await ctx.importer.counts()).pending).toBe(3);
  });

  it('내용이 전부 비어 있으면 Message Content Intent 가 꺼진 것으로 알림', async () => {
    messages = messages.map((m) => ({ ...m, content: '', attachments: [] }));
    await ctx.importer.runScan(source, '900');
    expect(ctx.importer.scanState()).toMatchObject({ found: 0, contentHidden: true });
  });
});

describe('태그 붙이고 옮기기', () => {
  it('저장하면 아카이브에 올라가고, 올린 사람은 관리자 · 날짜는 원래 날짜', async () => {
    await ctx.importer.runScan(source, '900');
    const [first] = await ctx.importer.list('pending');
    await ctx.importer.update(first.id, { tags: ['glow', '3d'], creatorName: '  Riot  ' });
    const { item, ref } = await ctx.importer.commit(first.id, alice);
    expect(item.status).toBe('imported');
    expect(ref).toMatchObject({ mapName: 'Bloodbath', title: 'Bloodbath', creatorName: 'Riot', uploaderId: alice.id, tags: ['3d', 'glow'] });
    expect(ref.createdAt.toISOString()).toBe(first.postedAt);
    expect((await ctx.importer.counts()).imported).toBe(1);
    await expect(ctx.importer.commit(first.id, alice)).rejects.toThrow(/이미 옮긴/);
  });

  it('없는 태그 · 비슷한 이미지 · 건너뛰기와 되돌리기', async () => {
    await ctx.importer.runScan(source, '900');
    const items = await ctx.importer.list('pending');
    await expect(ctx.importer.update(items[0].id, { tags: ['없는태그'] })).rejects.toThrow(/없는 태그/);

    await ctx.refs.create({ file: file(images.a2), category: 'non_gm', title: '이미 있음', uploader: bob });
    await expect(ctx.importer.commit(items[1].id, alice)).rejects.toBeInstanceOf(DuplicateError);
    const forced = await ctx.importer.commit(items[1].id, alice, { allowDuplicate: true });
    expect(forced.item.status).toBe('imported');

    await ctx.importer.setStatus(items[2].id, 'skipped');
    expect((await ctx.importer.list('skipped')).map((i) => i.id)).toEqual([items[2].id]);
    await ctx.importer.setStatus(items[2].id, 'pending');
    expect((await ctx.importer.counts()).skipped).toBe(0);
  });
});

describe('이름 통일', () => {
  it('비슷한 제작자 묶음 → 통일하면 후보와 이미 있는 레퍼런스 모두 바뀜', async () => {
    await ctx.importer.runScan(source, '900');
    const existing = await ctx.refs.create({
      file: file(await makeImage('#202020', '#ffffff')),
      category: 'gm_thumbnail',
      mapName: 'tartarus',
      creatorName: 'ZYLENOX',
      uploader: bob,
    });
    const groups = await ctx.importer.similarGroups('creator');
    expect(groups).toHaveLength(1);
    expect(groups[0].names.map((n) => n.name).sort()).toEqual(['ZYLENOX', 'Zylenox', 'zylenox']);

    const res = await ctx.importer.renameAll('creator', ['ZYLENOX', 'zylenox'], 'Zylenox', { id: alice.id, isAdmin: true });
    expect(res).toEqual({ items: 1, refs: 1 });
    expect((await ctx.refs.require(existing.id)).creatorName).toBe('Zylenox');
    expect(await ctx.importer.similarGroups('creator')).toEqual([]);

    // 맵 이름: 제목이 맵 이름과 같았으면 제목도 함께
    expect((await ctx.importer.similarGroups('map'))[0].names.map((n) => n.name).sort()).toEqual(['Tartarus', 'tartarus']);
    await ctx.importer.renameAll('map', ['tartarus'], 'Tartarus', { id: alice.id, isAdmin: true });
    expect(await ctx.refs.require(existing.id)).toMatchObject({ mapName: 'Tartarus', title: 'Tartarus' });
  });

  it('"서로 다른 이름" 으로 무시한 묶음은 다시 안 나옴', async () => {
    await ctx.importer.runScan(source, '900');
    const [g] = await ctx.importer.similarGroups('creator');
    await ctx.importer.ignoreGroup('creator', g.names.map((n) => n.name));
    expect(await ctx.importer.similarGroups('creator')).toEqual([]);
  });
});

describe('관리자 API', () => {
  it('관리자만 쓸 수 있고, me 에 관리자 여부가 나옴', async () => {
    const app = createApi(ctx);
    const as = async (user: typeof alice, path: string, init: RequestInit = {}) => {
      const token = await ctx.community.createSession(user, 'plugin');
      return app.request(path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
    };
    expect((await app.request('/api/admin/import/status')).status).toBe(401);
    expect((await as(bob, '/api/admin/import/status')).status).toBe(403);
    expect((await (await as(alice, '/api/auth/me')).json()).user.isAdmin).toBe(true);
    expect((await (await as(bob, '/api/auth/me')).json()).user.isAdmin).toBe(false);

    await ctx.importer.runScan(source, '900');
    const { items } = await (await as(alice, '/api/admin/import/items')).json();
    expect(items).toHaveLength(3);

    const img = await as(alice, `/api/admin/import/items/${items[0].id}/image`);
    expect(img.headers.get('content-type')).toBe('image/webp');

    const saved = await as(alice, `/api/admin/import/items/${items[0].id}`, { method: 'POST', body: JSON.stringify({ tags: ['glow'], category: 'gm_artwork' }) });
    expect((await saved.json()).item).toMatchObject({ tags: ['glow'], category: 'gm_artwork' });

    const done = await (await as(alice, `/api/admin/import/items/${items[0].id}/commit`, { method: 'POST', body: '{}' })).json();
    expect(done.ref.id).toBeGreaterThan(0);

    await ctx.refs.create({ file: file(images.a2), category: 'non_gm', title: '이미 있음', uploader: bob });
    const dup = await as(alice, `/api/admin/import/items/${items[1].id}/commit`, { method: 'POST', body: '{}' });
    expect(dup.status).toBe(409);
    expect((await dup.json()).matches[0]).toMatchObject({ title: '이미 있음' });

    const names = await (await as(alice, '/api/admin/import/names?field=creator')).json();
    expect(names.groups[0].suggested).toBe('zylenox');
    const sug = await (await as(alice, '/api/admin/import/suggest?field=creator&name=Zylenoxx')).json();
    expect(sug.similar.length).toBeGreaterThan(0);
  });
});
