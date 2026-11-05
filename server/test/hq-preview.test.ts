import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { alice, file, makeContext, makeImage } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof makeContext>>;
let ctx: Ctx;

beforeEach(async () => {
  ctx = await makeContext({ DISCORD_GUILD_ID: '900000000000000001' });
});
afterEach(async () => {
  await ctx.db.close();
});

async function upload(w = 2400, h = 1350, shape: 'circle' | 'stripes' = 'circle') {
  return ctx.refs.create({
    file: file(await makeImage('#101040', '#a050ff', { w, h, shape }), 'big.png'),
    category: 'gm_thumbnail',
    mapName: 'Big Map',
    creatorName: 'Riot',
    tags: [],
    uploader: alice,
  });
}

describe('고화질 미리보기', () => {
  it('올릴 때 긴 변 1920px 고화질본을 따로 만든다', async () => {
    const ref = await upload();
    expect(ref.hqKey).toMatch(/^hq\//);
    expect(ref.hqWidth).toBe(1920);
    expect(ref.hqHeight).toBe(1080);
    expect(await ctx.storage.get(ref.hqKey!)).not.toBeNull();

    const pub = ctx.refs.toPublic(ref);
    expect(pub.preview.width).toBe(720);
    expect(pub.hq).toEqual({ url: `http://localhost:3000/api/previews/${ref.hqKey}`, width: 1920, height: 1080 });
  });

  it('작은 원본은 키우지 않는다', async () => {
    const ref = await upload(640, 360);
    expect(ref.hqWidth).toBe(640);
    expect(ref.hqHeight).toBe(360);
  });

  it('예전 레퍼런스는 백그라운드에서 채워 넣는다', async () => {
    const a = await upload();
    const b = await upload(1000, 500, 'stripes');
    // 고화질본이 없던 시절처럼 만들기
    await ctx.storage.delete(a.hqKey!);
    await ctx.storage.delete(b.hqKey!);
    await ctx.db.query('UPDATE refs SET hq_key = NULL, hq_width = NULL, hq_height = NULL');
    expect(ctx.refs.toPublic((await ctx.refs.get(a.id))!).hq).toBeNull();

    const res = await ctx.refs.backfillHq({ pauseMs: 0 });
    expect(res).toEqual({ done: 2, failed: 0 });
    const a2 = (await ctx.refs.get(a.id))!;
    const b2 = (await ctx.refs.get(b.id))!;
    expect(a2.hqWidth).toBe(1920);
    expect(b2.hqWidth).toBe(1000);
    expect(await ctx.storage.get(a2.hqKey!)).not.toBeNull();

    // 다 채웠으면 다시 돌려도 할 일이 없음
    expect(await ctx.refs.backfillHq({ pauseMs: 0 })).toEqual({ done: 0, failed: 0 });
  });

  it('원본을 못 찾으면 건너뛰고 나머지는 계속한다', async () => {
    const a = await upload();
    const b = await upload(1000, 500, 'stripes');
    await ctx.db.query('UPDATE refs SET hq_key = NULL');
    // a 의 원본이 사라진 상황
    const archive = (ctx.refs as any).archive;
    const realFetch = archive.fetch.bind(archive);
    archive.fetch = async (ref: { id: number }, opts?: unknown) => (ref.id === a.id ? null : realFetch(ref, opts));

    const res = await ctx.refs.backfillHq({ pauseMs: 0 });
    expect(res).toEqual({ done: 1, failed: 1 });
    expect((await ctx.refs.get(a.id))!.hqKey).toBeNull();
    expect((await ctx.refs.get(b.id))!.hqKey).not.toBeNull();
  });

  it('지우면 고화질본도 지운다', async () => {
    const ref = await upload();
    await ctx.refs.delete(ref.id, { id: alice.id, isAdmin: false });
    expect(await ctx.storage.get(ref.hqKey!)).toBeNull();
    expect(await ctx.storage.get(ref.previewKey)).toBeNull();
  });
});

describe('디스코드 메시지 링크', () => {
  it('디스코드 아카이브에 있으면 메시지 링크를 준다', async () => {
    const ref = await upload(640, 360);
    // 로컬 보관이면 디스코드 링크가 없음
    expect(ctx.refs.toPublic(ref).discordUrl).toBeNull();

    ctx.refs.setArchive({ ...(ctx.refs as any).archive, kind: 'discord', isAvailable: () => true });
    expect(ctx.refs.discordUrl({ archiveChannelId: '800000000000000002', archiveMessageId: '700000000000000003' })).toBe(
      'https://discord.com/channels/900000000000000001/800000000000000002/700000000000000003',
    );
    expect(ctx.refs.discordUrl({ archiveChannelId: null, archiveMessageId: null })).toBeNull();
  });
});
