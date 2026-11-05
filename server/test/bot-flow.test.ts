import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotRuntime } from '../src/bot/runtime.js';
import { makeContext, makeImage } from './helpers.js';

/**
 * 디스코드에 실제로 접속하지 않고, 가짜 인터랙션 객체로 명령어 처리 흐름을 시험합니다.
 */

type Ctx = Awaited<ReturnType<typeof makeContext>>;
let ctx: Ctx;
let bot: BotRuntime;
let images: Record<string, Buffer>;

function fakeUser(id: string, name: string) {
  return { id, username: name, globalName: name.toUpperCase(), bot: false, partial: false, displayAvatarURL: () => `https://cdn.test/${id}.png` };
}
const ALICE = fakeUser('200000000000000001', 'alice');
const BOB = fakeUser('200000000000000002', 'bob');

function toJson(v: any): any {
  if (Array.isArray(v)) return v.map(toJson);
  if (v && typeof v.toJSON === 'function') return v.toJSON();
  return v;
}

function payloadJson(p: any) {
  if (!p || typeof p !== 'object') return p;
  return { ...p, embeds: toJson(p.embeds ?? []), components: toJson(p.components ?? []), files: p.files ?? [] };
}

function interaction(
  kind: 'command' | 'button' | 'autocomplete',
  init: {
    commandName?: string;
    customId?: string;
    values?: Record<string, any>;
    sub?: string;
    focused?: { name: string; value: string };
    user?: ReturnType<typeof fakeUser>;
    admin?: boolean;
    message?: any;
  },
) {
  const calls: [string, any][] = [];
  const values = init.values ?? {};
  const i: any = {
    commandName: init.commandName,
    customId: init.customId,
    user: init.user ?? ALICE,
    member: null,
    guild: null,
    channelId: 'channel-1',
    memberPermissions: { has: () => !!init.admin },
    message: init.message,
    deferred: false,
    replied: false,
    options: {
      getString: (n: string) => values[n] ?? null,
      getInteger: (n: string) => values[n] ?? null,
      getBoolean: (n: string) => values[n] ?? null,
      getUser: (n: string) => values[n] ?? null,
      getAttachment: (n: string) => values[n] ?? null,
      getSubcommand: () => init.sub,
      getFocused: () => init.focused,
    },
    isAutocomplete: () => kind === 'autocomplete',
    isChatInputCommand: () => kind === 'command',
    isButton: () => kind === 'button',
    isRepliable: () => kind !== 'autocomplete',
    reply: async (p: any) => {
      i.replied = true;
      calls.push(['reply', payloadJson(p)]);
    },
    deferReply: async (p: any) => {
      i.deferred = true;
      calls.push(['deferReply', p]);
    },
    editReply: async (p: any) => calls.push(['editReply', payloadJson(p)]),
    followUp: async (p: any) => calls.push(['followUp', payloadJson(p)]),
    update: async (p: any) => {
      i.replied = true;
      calls.push(['update', payloadJson(p)]);
    },
    deferUpdate: async () => {
      i.deferred = true;
      calls.push(['deferUpdate', null]);
    },
    respond: async (c: any) => calls.push(['respond', c]),
  };
  return {
    i,
    calls,
    last: (type?: string) => [...calls].reverse().find(([t]) => !type || t === type)?.[1],
    run: () => (bot as any).onInteraction(i) as Promise<void>,
  };
}

function attachment(name: string, size = 1000) {
  return { url: `https://cdn.discordapp.test/${name}`, name, size, contentType: 'image/png' };
}

beforeEach(async () => {
  ctx = await makeContext();
  bot = new BotRuntime(ctx);
  images = {
    'red.png': await makeImage('#050505', '#e01020'),
    'blue.png': await makeImage('#0a0a30', '#3060ff', { shape: 'stripes' }),
  };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
    const name = String(url).split('/').pop()!;
    const buf = images[name];
    return buf ? new Response(new Uint8Array(buf), { status: 200 }) : new Response('nope', { status: 404 });
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await bot.client.destroy();
  await ctx.db.close();
});

async function upload(values: Record<string, any>, user = ALICE) {
  const t = interaction('command', { commandName: 'upload', values, user });
  await t.run();
  return t;
}

describe('/업로드', () => {
  it('업로드 성공 → 점수 안내와 카드', async () => {
    const t = await upload({ image: attachment('red.png'), category: 'gm_thumbnail', map: 'Bloodbath', tags: 'glow, complex' });
    expect(t.calls[0]).toEqual(['deferReply', { flags: 64 }]);
    const res = t.last('editReply');
    expect(res.content).toBe('✅ **#1** 등록 완료! **+10점** (현재 10점 · 1위)');
    const embed = res.embeds[0];
    expect(embed.title).toBe('#1 · Bloodbath');
    expect(embed.url).toBe('http://localhost:3000/#/ref/1');
    expect(embed.description).toContain('지메 썸네일');
    expect(embed.description).toContain('맵: **Bloodbath**');
    expect(embed.description).toContain('제작자: ALICE');
    expect(embed.fields[0].value).toBe('`complex` `glow`');
    // localhost 라 디스코드가 이미지를 가져갈 수 없으므로 미리보기를 첨부
    expect(embed.image.url).toBe('attachment://preview-1.webp');
    expect(res.files).toHaveLength(1);
    const ids = res.components.flatMap((r: any) => r.components.map((c: any) => c.custom_id ?? c.url));
    expect(ids).toEqual(['rx:1:0', 'rx:1:1', 'rx:1:2', 'og:1', 'sm:1', 'http://localhost:3000/#/ref/1']);
  });

  it('지메 썸네일인데 맵 이름이 없으면 바로 안내', async () => {
    const t = await upload({ image: attachment('red.png'), category: 'gm_thumbnail' });
    expect(t.last('reply').content).toContain('`맵이름` 옵션이 필요');
    expect(t.last('reply').flags).toBe(64);
  });

  it('없는 태그는 이미지 받기 전에 안내', async () => {
    const t = await upload({ image: attachment('red.png'), category: 'non_gm', tags: 'glowy' });
    expect(t.last('reply').content).toMatch(/없는 태그입니다: `glowy`/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('중복이면 확인 버튼 → 그래도 올리기', async () => {
    await upload({ image: attachment('red.png'), category: 'non_gm' });
    const t = await upload({ image: attachment('red.png'), category: 'non_gm', title: 'again' }, BOB);
    const warn = t.last('editReply');
    expect(warn.content).toContain('이미 비슷한 레퍼런스가 있어요');
    expect(warn.content).toContain('**#1**');
    const forceId = warn.components[0].components[0].custom_id as string;
    expect(forceId).toMatch(/^up:force:/);

    // 다른 사람은 누를 수 없음
    const other = interaction('button', { customId: forceId, user: ALICE });
    await other.run();
    expect(other.last('reply').content).toContain('본인 업로드만');

    const press = interaction('button', { customId: forceId, user: BOB });
    await press.run();
    expect(press.calls[0][1].content).toBe('⏳ 업로드 중…');
    expect(press.last('editReply').content).toContain('✅ **#2** 등록 완료!');
    // 한 번 쓴 버튼은 만료
    const again = interaction('button', { customId: forceId, user: BOB });
    await again.run();
    expect(again.last('update').content).toContain('대기 시간이 지났어요');
  });
});

describe('/검색 과 버튼', () => {
  beforeEach(async () => {
    await upload({ image: attachment('red.png'), category: 'gm_thumbnail', map: 'Red Map', tags: 'glow' });
    await upload({ image: attachment('blue.png'), category: 'non_gm', title: 'Blue Poster', tags: 'modern' }, BOB);
  });

  it('검색 결과를 넘겨보고, 다른 사람은 넘길 수 없음', async () => {
    const t = interaction('command', { commandName: 'search', values: {} });
    await t.run();
    const first = t.last('editReply');
    expect(first.embeds[0].title).toBe('#2 · Blue Poster');
    expect(first.embeds[0].footer.text).toContain('1/2');
    const nav = first.components[0].components;
    expect(nav.map((c: any) => c.disabled ?? false)).toEqual([true, true, true, false, false]);
    const next = nav[3].custom_id;

    const stranger = interaction('button', { customId: next, user: BOB });
    await stranger.run();
    expect(stranger.last('reply').content).toContain('직접 명령어를 실행');

    const press = interaction('button', { customId: next });
    await press.run();
    const second = press.last('editReply');
    expect(second.embeds[0].title).toBe('#1 · Red Map');
    expect(second.attachments).toEqual([]);
  });

  it('검색 조건 + 결과 없음', async () => {
    const t = interaction('command', { commandName: 'search', values: { tags: 'glow', color: 'red' } });
    await t.run();
    const one = t.last('editReply');
    expect(one.embeds[0].title).toBe('#1 · Red Map');
    // 결과가 1개면 ⏪/⏩ 가 같은 위치를 가리키지만 custom_id 는 달라야 디스코드가 받아줌
    const ids = one.components.flatMap((row: any) => row.components.map((c: any) => c.custom_id));
    expect(new Set(ids).size).toBe(ids.length);
    const none =interaction('command', { commandName: 'search', values: { query: 'zzz', public: true } });
    await none.run();
    expect(none.calls[0]).toEqual(['deferReply', { flags: undefined }]);
    expect(none.last('editReply').content).toContain('"zzz"');
  });

  it('반응 버튼 → 숫자 갱신, 다시 누르면 취소', async () => {
    const rows = [
      { type: 1, toJSON: () => ({ type: 1, components: [{ type: 2, style: 2, custom_id: 'rx:1:0', label: '0', emoji: { name: '⭐' } }] }) },
    ];
    const t = interaction('button', { customId: 'rx:1:0', user: BOB, message: { components: rows } });
    await t.run();
    expect(t.last('update').components[0].components[0].label).toBe('1');
    expect(t.last('followUp').content).toBe('⭐ 반응을 남겼어요!');
    const again = interaction('button', { customId: 'rx:1:0', user: BOB, message: { components: rows } });
    await again.run();
    expect(again.last('update').components[0].components[0].label).toBe('0');
    expect(again.last('followUp').content).toBe('⭐ 반응을 취소했어요.');
  });

  it('원본 받기 버튼 → 원본 파일 첨부', async () => {
    const t = interaction('button', { customId: 'og:1', user: BOB });
    await t.run();
    const res = t.last('editReply');
    expect(res.content).toContain('**#1 · Red Map** 원본 (640×360)');
    expect(res.files[0].name).toBe('1 Red Map - ALICE.png');
  });

  it('/인기 (반응 없으면 안내) / /랜덤 / /보기 / /색상', async () => {
    let t = interaction('command', { commandName: 'popular', values: {} });
    await t.run();
    expect(t.last('editReply').content).toContain('이번 주 반응을 받은 레퍼런스가 아직 없어요');

    await ctx.refs.toggleReaction(1, { id: BOB.id, username: 'bob' }, '🔥');
    t = interaction('command', { commandName: 'popular', values: { period: 'all' } });
    await t.run();
    expect(t.last('editReply').embeds[0].title).toBe('#1 · Red Map');

    t = interaction('command', { commandName: 'random', values: { category: 'non_gm' } });
    await t.run();
    const rnd = t.last('editReply');
    expect(rnd.embeds[0].title).toBe('#2 · Blue Poster');
    expect(rnd.components[0].components[0].label).toBe('다른 거 뽑기');

    t = interaction('command', { commandName: 'view', values: { id: 1 } });
    await t.run();
    expect(t.last('editReply').embeds[0].title).toBe('#1 · Red Map');

    t = interaction('command', { commandName: 'color', sub: 'family', values: { color: 'blue' } });
    await t.run();
    expect(t.last('editReply').embeds[0].title).toBe('#2 · Blue Poster');

    t = interaction('command', { commandName: 'color', sub: 'hex', values: { code: 'e01020' } });
    await t.run();
    expect(t.last('editReply').embeds[0].title).toBe('#1 · Red Map');

    t = interaction('command', { commandName: 'color', sub: 'hex', values: { code: 'nothex' } });
    await t.run();
    expect(t.last('reply').content).toContain('색상 코드');
  });

  it('수정 / 삭제 권한', async () => {
    let t = interaction('command', { commandName: 'edit', values: { id: 1, add_tags: '3d' }, user: BOB });
    await t.run();
    expect(t.last('editReply').content).toContain('올린 사람이나 관리자만');

    t = interaction('command', { commandName: 'edit', values: { id: 1, add_tags: '3d', title: 'Renamed' } });
    await t.run();
    const edited = t.last('editReply');
    expect(edited.content).toBe('✏️ **#1** 수정 완료');
    expect(edited.embeds[0].title).toBe('#1 · Renamed');
    expect(edited.embeds[0].fields[0].value).toBe('`3d` `glow`');

    t = interaction('command', { commandName: 'delete', values: { id: 1 }, user: BOB, admin: true });
    await t.run();
    const confirm = t.last('reply');
    expect(confirm.components[0].components[0].custom_id).toBe('del:yes:1');
    const yes = interaction('button', { customId: 'del:yes:1', user: BOB, admin: true });
    await yes.run();
    expect(yes.last('update').content).toContain('삭제했어요');
    expect(await ctx.refs.get(1)).toBeNull();
  });

  it('/랭킹 · /프로필', async () => {
    await ctx.refs.toggleReaction(1, { id: BOB.id, username: 'bob' }, '🔥');
    const t = interaction('command', { commandName: 'leaderboard', values: {} });
    await t.run();
    const lb = t.last('reply');
    expect(lb.embeds[0].description.split('\n')[0]).toBe(`🥇 💎 <@${ALICE.id}> — **11.5점** · 업로드 1 · 받은 반응 1`);
    expect(lb.embeds[0].footer.text).toContain('받은 반응 ⭐ +2 · 🔥 +1.5 · 👍 +1');
    expect(lb.embeds[0].description.split('\n')[1]).toBe(`🥈 💎 <@${BOB.id}> — **10점** · 업로드 1 · 받은 반응 0`);

    const p = interaction('command', { commandName: 'profile', values: {} });
    await p.run();
    const prof = p.last('editReply').embeds[0];
    expect(prof.title).toBe('11.5점 · 1위 · 💎 다이아몬드');
    expect(prof.footer.text).toContain('#1 Red Map');
  });
});

describe('관리 / 연동 / 자동완성', () => {
  it('/관리 태그추가 는 관리자만', async () => {
    let t = interaction('command', { commandName: 'admin', sub: 'tag-add', values: { name: 'neon' } });
    await t.run();
    expect(t.last('reply').content).toContain('관리자만');
    t = interaction('command', { commandName: 'admin', sub: 'tag-add', values: { name: 'Neon', description: '네온' }, admin: true });
    await t.run();
    expect(t.last('reply').content).toBe('🏷️ `neon` 태그를 추가했어요.');
    t = interaction('command', { commandName: 'admin', sub: 'score', values: { user: BOB, amount: 50, reason: '이벤트' }, admin: true });
    await t.run();
    expect(t.last('reply').content).toContain('현재 **50점** (1위)');
  });

  it('/연동 코드 승인', async () => {
    const code = await ctx.community.createDeviceCode('plugin');
    const t = interaction('command', { commandName: 'link', values: { code: code.userCode } });
    await t.run();
    expect(t.last('reply').content).toContain('연동 완료');
    const poll = await ctx.community.pollDeviceCode(code.deviceCode);
    expect(poll).toMatchObject({ status: 'approved', userId: ALICE.id });
  });

  it('태그 자동완성은 마지막 단어를 이어서 완성', async () => {
    const t = interaction('autocomplete', { focused: { name: 'tags', value: 'glow, gr' } });
    await t.run();
    expect(t.last('respond')).toEqual([{ name: 'glow, grunge', value: 'glow, grunge' }]);
    const all = interaction('autocomplete', { focused: { name: 'tags', value: '' } });
    await all.run();
    expect(all.last('respond')).toHaveLength(11);
  });

  it('번호 자동완성', async () => {
    await upload({ image: attachment('red.png'), category: 'gm_thumbnail', map: 'Bloodbath' });
    const t = interaction('autocomplete', { focused: { name: 'id', value: 'blood' } });
    await t.run();
    expect(t.last('respond')).toEqual([{ name: '#1 · Bloodbath (썸네일)', value: 1 }]);
  });

  it('/도움말 · /태그목록', async () => {
    let t = interaction('command', { commandName: 'help', values: {} });
    await t.run();
    expect(t.last('reply').embeds[0].description).toContain('/연동 코드:XXXX-XXXX');
    t = interaction('command', { commandName: 'tags', values: {} });
    await t.run();
    expect(t.last('reply').embeds[0].title).toBe('🏷️ 태그 목록 (11개)');
  });
});
