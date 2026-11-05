import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api/app.js';
import { openDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { alice, bob, carol, file, makeContext, makeImage, testPlaylists } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof makeContext>>;
let ctx: Ctx;
const admin = { id: alice.id, isAdmin: true };

afterEach(async () => {
  await ctx.db.close();
  testPlaylists.clear();
});

describe('지메 · 비지메 태그 분리', () => {
  beforeEach(async () => {
    ctx = await makeContext();
  });

  async function upload(category: 'gm_artwork' | 'non_gm', tags: string[], color = '#103080') {
    return ctx.refs.create({
      file: file(await makeImage('#0a0a0a', color, { shape: category === 'non_gm' ? 'stripes' : 'circle' })),
      category,
      title: 't',
      tags,
      uploader: bob,
    });
  }

  it('비지메에는 비지메 태그만, 지메에는 지메 태그만 달 수 있다', async () => {
    await ctx.community.addTag('stock-photo', null, admin, 'nongd');
    expect((await upload('non_gm', ['stock-photo'])).tags).toEqual(['stock-photo']);
    await expect(upload('gm_artwork', ['stock-photo'], '#e02020')).rejects.toMatchObject({ code: 'unknown_tag' });
    // 같은 이름은 양쪽에 따로 있을 수 있음
    await ctx.community.addTag('stock-photo', null, admin, 'gd');
    await expect(ctx.community.addTag('stock-photo', null, admin, 'nongd')).rejects.toThrow(/이미 있습니다/);
  });

  it('지메 태그 이름을 바꿔도 비지메 태그는 그대로', async () => {
    const gd = await upload('gm_artwork', ['glow']);
    const non = await upload('non_gm', ['glow']);
    const res = await ctx.community.renameTag('glow', 'neon-glow', admin, 'gd');
    expect(res.refIds).toEqual([gd.id]);
    expect((await ctx.refs.require(gd.id)).tags).toEqual(['neon-glow']);
    expect((await ctx.refs.require(non.id)).tags).toEqual(['glow']);

    await ctx.community.removeTag('glow', admin, 'nongd');
    expect((await ctx.refs.require(non.id)).tags).toEqual([]);
    expect((await ctx.refs.require(gd.id)).tags).toEqual(['neon-glow']);
  });

  it('분류를 비지메로 옮기면 비지메에도 있는 태그만 남는다', async () => {
    await ctx.community.addTag('gd-only', null, admin, 'gd');
    const ref = await upload('gm_artwork', ['glow', 'gd-only']);
    const moved = await ctx.refs.update(ref.id, { category: 'non_gm' }, admin);
    expect(moved.tags).toEqual(['glow']);
    expect((await ctx.community.listTags('nongd')).find((t) => t.name === 'glow')?.count).toBe(1);
    expect((await ctx.community.listTags('gd')).find((t) => t.name === 'glow')?.count).toBe(0);
  });

  it('제작과정 영상의 speedart 태그도 레퍼런스의 태그군으로 붙는다', async () => {
    const non = await upload('non_gm', []);
    await ctx.videos.add(non.id, 'https://youtu.be/abcdefghijk', carol);
    expect((await ctx.refs.require(non.id)).tags).toEqual(['speedart']);
    expect((await ctx.community.listTags('nongd')).find((t) => t.name === 'speedart')?.count).toBe(1);
  });

  it('scope 로 지메만 / 비지메만 검색', async () => {
    const gd = await upload('gm_artwork', []);
    const non = await upload('non_gm', []);
    const app = createApi(ctx);
    const ids = async (q: string) => ((await (await app.request(`/api/refs?${q}`)).json()) as any).items.map((r: any) => r.id);
    expect(await ids('scope=gd')).toEqual([gd.id]);
    expect(await ids('scope=nongd')).toEqual([non.id]);
    expect((await ids('')).sort()).toEqual([gd.id, non.id].sort());
  });
});

describe('마이그레이션 8: 비지메 태그 옮기기', () => {
  beforeEach(async () => {
    ctx = await makeContext();
  });

  it('비지메 레퍼런스의 태그를 비지메 태그군으로 옮긴다', async () => {
    const db = await openDb({ pgliteDir: 'memory' });
    // 8번만 빼고 먼저 적용
    await db.exec(`CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
      INSERT INTO schema_migrations (id, name) VALUES (8, 'later');`);
    await migrate(db);
    await db.exec(`
      INSERT INTO users (discord_id, username) VALUES ('1', 'u');
      INSERT INTO tags (name, description) VALUES ('only-gd', NULL);
      INSERT INTO refs (category, title, creator_name, uploader_id, original_filename, original_mime, original_size, width, height, preview_key, preview_width, preview_height, preview_size)
        VALUES ('non_gm', 'n', 'c', '1', 'a.png', 'image/png', 1, 1, 1, 'p1', 1, 1, 1),
               ('gm_artwork', 'g', 'c', '1', 'b.png', 'image/png', 1, 1, 1, 'p2', 1, 1, 1);
      INSERT INTO ref_tags (ref_id, tag_id) SELECT 1, id FROM tags WHERE name IN ('glow', '3d');
      INSERT INTO ref_tags (ref_id, tag_id) SELECT 2, id FROM tags WHERE name IN ('glow', 'only-gd');
      DELETE FROM schema_migrations WHERE id = 8;
    `);
    expect(await migrate(db)).toBe(1);
    const tagsOf = async (refId: number) =>
      (
        await db.query<{ grp: string; name: string }>(
          'SELECT t.grp, t.name FROM ref_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.ref_id = $1 ORDER BY t.name',
          [refId],
        )
      ).map((r) => `${r.grp}:${r.name}`);
    expect(await tagsOf(1)).toEqual(['nongd:3d', 'nongd:glow']);
    expect(await tagsOf(2)).toEqual(['gd:glow', 'gd:only-gd']);
    const nongd = (await db.query<{ name: string }>(`SELECT name FROM tags WHERE grp = 'nongd' ORDER BY name`)).map((r) => r.name);
    expect(nongd).toEqual(['3d', 'glow', 'speedart']);
    await db.close();
  });
});

describe('쇼케이스', () => {
  beforeEach(async () => {
    ctx = await makeContext({ YOUTUBE_API_KEY: 'test-key', POINTS_PER_SHOWCASE: '3' });
  });

  it('영상 주소로 올리면 제목 · 채널은 유튜브 정보, 올린 사람은 3점', async () => {
    const res = await ctx.showcase.submit('https://www.youtube.com/watch?v=abcdefghijk&t=10', carol);
    expect(res.kind).toBe('video');
    const item = res.kind === 'video' ? res.item : null!;
    expect(item).toMatchObject({ youtubeId: 'abcdefghijk', title: '영상 abcdefghijk', channelName: '채널 abc', addedBy: { id: carol.id } });
    expect((await ctx.community.score(carol.id))?.score).toBe(3);
    expect((await ctx.community.score(carol.id))?.showcases).toBe(1);

    await expect(ctx.showcase.submit('https://youtu.be/abcdefghijk', bob)).rejects.toMatchObject({ code: 'duplicate_video' });
    await expect(ctx.showcase.submit('https://youtu.be/notfound000', bob)).rejects.toMatchObject({ code: 'video_not_found' });
    await expect(ctx.showcase.submit('hello', bob)).rejects.toMatchObject({ code: 'bad_url' });

    // 올린 사람이나 관리자만 지울 수 있고, 지우면 점수도 빠짐
    await expect(ctx.showcase.remove(item.id, { id: bob.id, isAdmin: false })).rejects.toThrow(/올린 사람이나 관리자/);
    await ctx.showcase.remove(item.id, { id: carol.id, isAdmin: false });
    expect(await ctx.community.score(carol.id)).toBeNull();
  });

  it('재생목록은 관리자가 승인해야 가져오고, 영상마다 3점', async () => {
    testPlaylists.set('PLtest1234567', {
      title: '내 작업들',
      items: [
        ...Array.from({ length: 60 }, (_, i) => ({
          videoId: `vid${String(i).padStart(8, '0')}`,
          title: `작업 ${i}`,
          channelName: '나',
          channelId: 'UCabc',
          publishedAt: '2025-01-01T00:00:00Z',
        })),
        { videoId: 'private0000', title: 'Private video', channelName: null, channelId: null, publishedAt: null },
      ],
    });
    await ctx.showcase.submit('https://youtu.be/vid00000001', bob); // 이미 있는 영상 하나

    const res = await ctx.showcase.submit('https://www.youtube.com/playlist?list=PLtest1234567', carol);
    expect(res.kind).toBe('request');
    const req = res.kind === 'request' ? res.request : null!;
    expect(req).toMatchObject({ status: 'pending', title: '내 작업들', itemCount: 61 });
    expect(await ctx.showcase.pendingCount()).toBe(1);
    // 승인 전에는 아무것도 안 들어옴
    expect((await ctx.showcase.list()).total).toBe(1);
    await expect(ctx.showcase.submit('https://www.youtube.com/playlist?list=PLtest1234567', bob)).rejects.toMatchObject({ code: 'duplicate_request' });
    await expect(ctx.showcase.decide(req.id, true, { id: bob.id, isAdmin: false })).rejects.toThrow(/관리자만/);

    await ctx.showcase.decide(req.id, true, admin);
    await ctx.showcase.waitForImports();
    const done = (await ctx.showcase.getRequest(req.id))!;
    expect(done).toMatchObject({ status: 'done', imported: 59, skipped: 2 });
    expect((await ctx.showcase.list({ addedBy: carol.id })).total).toBe(59);
    expect((await ctx.community.score(carol.id))?.score).toBe(59 * 3);
    await expect(ctx.showcase.decide(req.id, false, admin)).rejects.toMatchObject({ code: 'already_decided' });
  });

  it('거절하면 아무것도 가져오지 않는다', async () => {
    testPlaylists.set('PLtest7654321', { title: '이상한 목록', items: [{ videoId: 'aaaaaaaaaaa', title: 'x', channelName: 'y', channelId: null, publishedAt: null }] });
    const res = await ctx.showcase.submit('https://youtube.com/playlist?list=PLtest7654321', carol);
    const req = res.kind === 'request' ? res.request : null!;
    expect((await ctx.showcase.decide(req.id, false, admin)).status).toBe('rejected');
    await ctx.showcase.waitForImports();
    expect((await ctx.showcase.list()).total).toBe(0);
    expect(await ctx.showcase.pendingCount()).toBe(0);
  });

  it('유튜브 API 키가 없으면 재생목록은 안내만', async () => {
    await ctx.db.close();
    ctx = await makeContext();
    testPlaylists.set('PLtest1234567', { title: 'x', items: [] });
    await expect(ctx.showcase.submit('https://www.youtube.com/playlist?list=PLtest1234567', carol)).rejects.toMatchObject({ code: 'playlist_disabled' });
    expect(ctx.showcase.playlistEnabled).toBe(false);
  });

  it('API: 목록 · 메타 · 신고', async () => {
    const app = createApi(ctx);
    await ctx.showcase.submit('https://youtu.be/abcdefghijk', carol);
    const list = (await (await app.request('/api/showcase?q=abcdef')).json()) as any;
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ thumbUrl: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', url: 'https://www.youtube.com/watch?v=abcdefghijk' });
    const meta = (await (await app.request('/api/meta')).json()) as any;
    expect(meta.showcase).toEqual({ points: 3, playlist: true });

    const token = await ctx.community.createSession(bob, 'plugin');
    const rep = await app.request('/api/reports', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ targetType: 'showcase', targetId: list.items[0].id, reason: 'inappropriate' }),
    });
    expect(rep.status).toBe(200);
    expect((await ctx.reports.target('showcase', list.items[0].id))?.title).toMatch(/^쇼케이스 #1/);
  });
});
