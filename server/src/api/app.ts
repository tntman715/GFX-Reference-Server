import fs from 'node:fs/promises';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import {
  categoriesOfGroup,
  CATEGORIES,
  CATEGORY_KEYS,
  COLOR_FAMILIES,
  COLOR_FAMILY_KEYS,
  isCategory,
  isColorFamily,
  isPopularPeriod,
  parseTagList,
  POPULAR_PERIODS,
  SORTS,
  type SortKey,
  isTagGroup,
  TAG_GROUP_KEYS,
  TAG_GROUPS,
  type TagGroup,
} from '../constants.js';
import type { AppContext } from '../context.js';
import type { SearchOptions } from '../repos/references.js';
import sharp from 'sharp';
import { toJpegThumb } from '../services/image.js';
import { DuplicateError } from '../services/references.js';
import { REPORT_REASONS } from '../services/reports.js';
import { isResourceKind, RESOURCE_KIND_KEYS, RESOURCE_KINDS, RESOURCE_LIMITS } from '../services/resources.js';
import { isSafeKey } from '../storage/types.js';
import { TIERS } from '../tiers.js';
import type { EditProposal } from '../services/edits.js';
import type { Reference, UserInfo } from '../types.js';
import { avatarUrl } from '../util/discord.js';
import { ForbiddenError, NotFoundError, ServiceUnavailableError, UnauthorizedError, UserError } from '../util/errors.js';
import { logger } from '../util/log.js';
import { RateLimiter } from '../util/rate-limit.js';

const log = logger('api');

type AuthedUser = UserInfo & { tokenLabel: string };
type Env = { Variables: { user: AuthedUser | null; token: string | null } };

const TOKEN_COOKIE = 'gfx_token';
const OAUTH_COOKIE = 'gfx_oauth';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** 관리자 태그 API 의 태그군 (없으면 지메) */
function tagGroupParam(v: unknown): TagGroup {
  return isTagGroup(v) ? v : 'gd';
}

function intParam(v: string | undefined, def: number, min: number, max: number): number {
  const n = Number.parseInt(v ?? '', 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function clientIp(c: Context): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

/** RFC 5987 형식으로 한글 파일명도 깨지지 않게 */
function contentDisposition(type: 'attachment' | 'inline', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function createApi(ctx: AppContext): Hono<Env> {
  const { config, refs, community } = ctx;
  const app = new Hono<Env>();
  const secureCookie = config.publicBaseUrl.startsWith('https://');
  const crossSite = config.corsOrigins.length > 0;
  const thumbCache = new Map<string, Buffer>();
  const deviceLimiter = new RateLimiter(10, 60_000);
  const downloadLimiter = new RateLimiter(60, 60_000);
  const reactLimiter = new RateLimiter(60, 60_000);
  const editLimiter = new RateLimiter(20, 60_000);
  const boardLimiter = new RateLimiter(120, 60_000);

  if (config.corsOrigins.length) {
    app.use(
      '/api/*',
      cors({
        origin: config.corsOrigins,
        credentials: true,
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        maxAge: 600,
      }),
    );
  }

  // ── CSRF: 쿠키로 인증하는 쓰기 요청은 허용된 Origin 에서만 ──
  const allowedOrigins = new Set([new URL(config.publicBaseUrl).origin, ...config.corsOrigins]);
  app.use('/api/*', async (c, next) => {
    const method = c.req.method;
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && !c.req.header('authorization')) {
      const origin = c.req.header('origin');
      if (origin && origin !== new URL(c.req.url).origin && !allowedOrigins.has(origin)) {
        return c.json({ error: '허용되지 않은 출처의 요청입니다.', code: 'bad_origin' }, 403);
      }
    }
    await next();
  });

  // ── 인증 ────────────────────────────────────────────────
  app.use('/api/*', async (c, next) => {
    const header = c.req.header('authorization');
    const token = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : (getCookie(c, TOKEN_COOKIE) ?? null);
    let user: AuthedUser | null = null;
    if (token) user = await community.userForToken(token).catch(() => null);
    c.set('user', user);
    c.set('token', user ? token : null);
    await next();
  });

  const requireUser = (c: Context<Env>): AuthedUser => {
    const user = c.get('user');
    if (!user) throw new UnauthorizedError();
    return user;
  };

  app.onError((err, c) => {
    if (err instanceof UserError) return c.json({ error: err.message, code: err.code }, err.status as 400);
    log.error(`${c.req.method} ${c.req.path} 처리 중 오류`, err);
    return c.json({ error: '서버 오류가 발생했습니다.', code: 'internal' }, 500);
  });

  const setSessionCookie = (c: Context, token: string) => {
    setCookie(c, TOKEN_COOKIE, token, {
      httpOnly: true,
      secure: secureCookie || crossSite,
      sameSite: crossSite ? 'None' : 'Lax',
      path: '/',
      maxAge: config.auth.sessionDays * 24 * 60 * 60,
    });
  };

  // ── 메타 / 상태 ─────────────────────────────────────────
  app.get('/api/health', (c) => c.json({ ok: true, bot: ctx.bot?.isOnline() ?? false, archive: refs.archiveAvailable }));

  app.get('/api/meta', async (c) => {
    const [tags, stats] = await Promise.all([community.listTags(), community.stats()]);
    const botOnline = ctx.bot?.isOnline() ?? false;
    return c.json({
      name: 'GFX References',
      guild: ctx.bot?.inviteInfo?.() ?? null,
      categories: CATEGORY_KEYS.map((key) => ({ key, ...CATEGORIES[key] })),
      colors: COLOR_FAMILY_KEYS.map((key) => ({ key, ...COLOR_FAMILIES[key] })),
      tags: tags.map((t) => ({ name: t.name, description: t.description, count: t.count, group: t.group })),
      tagGroups: TAG_GROUP_KEYS.map((key) => ({ key, ...TAG_GROUPS[key] })),
      reactions: config.reactionEmojis,
      sorts: SORTS,
      periods: Object.entries(POPULAR_PERIODS).map(([key, v]) => ({ key, label: v.label })),
      scoring: config.scoring,
      upload: { maxBytes: config.upload.maxBytes, resourceMaxBytes: config.upload.resourceMaxBytes },
      tiers: TIERS,
      resourceKinds: RESOURCE_KIND_KEYS.map((key) => ({ key, ...RESOURCE_KINDS[key], points: config.scoring.pointsPerResource[key] })),
      reportReasons: Object.entries(REPORT_REASONS).map(([key, label]) => ({ key, label })),
      showcase: { points: config.scoring.pointsPerShowcase, playlist: ctx.showcase.playlistEnabled },
      stats,
      bot: { online: botOnline },
      archive: { available: refs.archiveAvailable, kind: config.archiveDriver },
      auth: { oauth: config.discord.oauthEnabled, deviceCode: botOnline },
    });
  });

  // ── 레퍼런스 ────────────────────────────────────────────
  const parseFilters = (c: Context): SearchOptions => {
    const q = c.req.query();
    const opts: SearchOptions = {};
    if (q.q) opts.q = q.q.slice(0, 200);
    if (isCategory(q.category)) opts.category = q.category;
    // scope=gd 면 지메 분류만, scope=nongd 면 비지메만 (분류를 따로 고르지 않았을 때)
    else if (isTagGroup(q.scope)) opts.categories = categoriesOfGroup(q.scope);
    const tags = parseTagList(q.tags);
    if (tags.length) opts.tags = tags;
    if (isColorFamily(q.color)) opts.color = q.color;
    if (q.creator) opts.creator = q.creator.slice(0, 64);
    if (q.uploader) opts.uploaderId = q.uploader;
    return opts;
  };

  app.get('/api/refs', async (c) => {
    const q = c.req.query();
    const filters = parseFilters(c);
    const pageSize = intParam(q.limit, 24, 1, 60);
    const page = intParam(q.page, 1, 1, 10_000);
    const offset = (page - 1) * pageSize;
    const sort = (SORTS as readonly string[]).includes(q.sort ?? '') ? (q.sort as SortKey) : undefined;

    let result;
    if (q.hex) {
      result = await refs.byHex(q.hex, { ...filters, limit: pageSize, offset });
    } else if (q.similar) {
      result = await refs.similar(intParam(q.similar, 0, 0, 2 ** 31 - 1), { ...filters, limit: pageSize, offset });
    } else if (sort === 'popular') {
      result = await refs.popular({ ...filters, period: isPopularPeriod(q.period) ? q.period : 'all', limit: pageSize, offset });
    } else {
      const effective = sort ?? (filters.color ? 'color' : 'newest');
      const seed = effective === 'random' && q.seed ? q.seed.slice(0, 32) : undefined;
      result = await refs.search({ ...filters, sort: effective, seed, limit: pageSize, offset });
    }
    const viewer = c.get('user');
    return c.json({
      items: await refs.toPublicList(result.items, viewer?.id),
      total: result.total,
      page,
      pageSize,
      hasMore: offset + result.items.length < result.total,
    });
  });

  app.get('/api/refs/random', async (c) => {
    const ref = await refs.random(parseFilters(c));
    if (!ref) throw new NotFoundError('조건에 맞는 레퍼런스가 없습니다.');
    const [item] = await refs.toPublicList([ref], c.get('user')?.id);
    return c.json({ item });
  });

  const refIdParam = (c: Context): number => {
    const id = Number.parseInt(c.req.param('id') ?? '', 10);
    if (!Number.isFinite(id) || id <= 0) throw new NotFoundError();
    return id;
  };

  app.get('/api/refs/:id', async (c) => {
    const ref = await refs.require(refIdParam(c));
    const [item] = await refs.toPublicList([ref], c.get('user')?.id);
    return c.json({ item });
  });

  app.get('/api/refs/:id/thumb', async (c) => {
    const id = refIdParam(c);
    const w = intParam(c.req.query('w'), 320, 64, 720);
    const key = `${id}:${w}`;
    let jpeg = thumbCache.get(key);
    if (!jpeg) {
      const ref = await refs.require(id);
      const preview = await refs.getPreview(ref);
      if (!preview) throw new NotFoundError('미리보기가 없습니다.');
      jpeg = await toJpegThumb(preview, w);
      if (thumbCache.size > 400) thumbCache.delete(thumbCache.keys().next().value!);
      thumbCache.set(key, jpeg);
    }
    return c.body(new Uint8Array(jpeg), 200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    });
  });

  app.get('/api/refs/:id/original', async (c) => {
    const user = requireUser(c);
    if (!downloadLimiter.take(user.id)) throw new UserError('잠시 후 다시 시도해 주세요.', { status: 429, code: 'rate_limited' });
    const ref = await refs.require(refIdParam(c));
    if (!refs.archiveAvailable) throw new ServiceUnavailableError();
    const file = await refs.fetchOriginal(ref);
    const name = refs.downloadFilename(ref, file);
    const inline = c.req.query('inline') === '1';
    return c.body(new Uint8Array(file.data), 200, {
      'Content-Type': file.contentType,
      'Content-Length': String(file.data.length),
      'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', name),
      'Cache-Control': 'private, no-store',
      'Access-Control-Expose-Headers': 'Content-Disposition',
    });
  });

  app.post('/api/refs/:id/dm', async (c) => {
    const user = requireUser(c);
    if (!downloadLimiter.take(user.id)) throw new UserError('잠시 후 다시 시도해 주세요.', { status: 429, code: 'rate_limited' });
    const ref = await refs.require(refIdParam(c));
    if (!ctx.bot?.isOnline()) throw new ServiceUnavailableError();
    const file = await refs.fetchOriginal(ref);
    await ctx.bot.sendOriginalDm(user.id, ref, file);
    return c.json({ ok: true });
  });

  app.post('/api/refs/:id/reactions', async (c) => {
    const user = requireUser(c);
    if (!reactLimiter.take(user.id)) throw new UserError('잠시 후 다시 시도해 주세요.', { status: 429, code: 'rate_limited' });
    const body = await c.req.json<{ emoji?: string }>().catch(() => ({}) as { emoji?: string });
    if (!body.emoji) throw new UserError('emoji 가 필요합니다.');
    const id = refIdParam(c);
    const res = await refs.toggleReaction(id, user, body.emoji);
    if (!res.active && ctx.bot?.syncReactionRemoval) {
      const ref = await refs.get(id);
      if (ref) ctx.bot.syncReactionRemoval(ref, user.id, refs.normalizeReaction(body.emoji)).catch(() => undefined);
    }
    const mine = await refs.myReactions([id], user.id);
    return c.json({ ...res, myReactions: mine.get(id) ?? [] });
  });

  // ── 태그 / 색상 / 제작자 ────────────────────────────────
  app.get('/api/tags', async (c) => {
    const group = c.req.query('group');
    return c.json({ tags: await community.listTags(isTagGroup(group) ? group : undefined) });
  });

  app.get('/api/creators', async (c) => c.json({ creators: await refs.creators(c.req.query('q') ?? '', 20) }));

  app.get('/api/colors', async (c) => {
    const category = c.req.query('category');
    const stats = await refs.colorStats(isCategory(category) ? category : undefined);
    return c.json({
      colors: COLOR_FAMILY_KEYS.map((key) => ({ key, ...COLOR_FAMILIES[key], count: stats[key] })),
    });
  });

  // ── 수정 / 수정 제안 ────────────────────────────────────
  // 올린 사람과 관리자는 바로 고치고, 다른 사람이 고치면 올린 사람에게 "수정 제안"이 갑니다.
  const viewerIsAdmin = async (userId: string) => (ctx.bot?.isOnline() ? isAdminUser(userId) : false);

  /** 제안 목록에 레퍼런스 정보(제목, 미리보기)를 붙여서 내보냄 */
  const publicProposals = async (list: EditProposal[], viewerId?: string) => {
    const ids = [...new Set(list.map((p) => p.refId))];
    const found: Reference[] = ids.length ? (await refs.search({ ids, sort: 'ids', limit: ids.length })).items : [];
    const pub = new Map((await refs.toPublicList(found, viewerId)).map((r) => [r.id, r]));
    return list.map((p) => ({ ...p, ref: pub.get(p.refId) ?? null }));
  };

  // 레퍼런스 삭제: 관리자 또는 올린 사람 (디스코드 /삭제 와 같음)
  app.post('/api/refs/:id/delete', async (c) => {
    const user = requireUser(c);
    const ref = await refs.delete(refIdParam(c), { id: user.id, isAdmin: await viewerIsAdmin(user.id) });
    log.info(`#${ref.id} 사이트에서 삭제 by ${user.username}`);
    return c.json({ ok: true, id: ref.id });
  });

  app.get('/api/refs/:id/proposals', async (c) => {
    const ref = await refs.require(refIdParam(c));
    const user = c.get('user');
    const isAdmin = user ? await viewerIsAdmin(user.id) : false;
    const canEdit = !!user && refs.canEdit(ref, { id: user.id, isAdmin });
    const pending = await ctx.edits.pendingFor(ref.id);
    // 올린 사람/관리자는 모든 제안을, 다른 사람은 내가 보낸 것만
    const visible = canEdit ? pending : pending.filter((p) => p.proposer.id === user?.id);
    return c.json({ canEdit, isAdmin, proposals: visible });
  });

  app.post('/api/refs/:id/edit', async (c) => {
    const user = requireUser(c);
    if (!editLimiter.take(user.id)) throw new UserError('잠시 후 다시 시도해 주세요.', { status: 429, code: 'rate_limited' });
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const str = (v: unknown) => (v === undefined ? undefined : v === null ? null : String(v));
    const result = await ctx.edits.submit(
      refIdParam(c),
      {
        title: str(body.title),
        mapName: str(body.mapName),
        category: body.category === undefined ? undefined : String(body.category),
        creators: str(body.creators),
        tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
        note: str(body.note),
      },
      user,
      await viewerIsAdmin(user.id),
    );
    if (result.mode === 'applied') {
      const [item] = await refs.toPublicList([result.ref], user.id);
      return c.json({ mode: 'applied', item });
    }
    return c.json({ mode: 'proposed', proposal: result.proposal });
  });

  app.get('/api/edits/received', async (c) => {
    const user = requireUser(c);
    const all = c.req.query('all') === '1' && (await viewerIsAdmin(user.id));
    return c.json({ items: await publicProposals(await ctx.edits.received(user.id, { all }), user.id), all });
  });

  app.get('/api/edits/sent', async (c) => {
    const user = requireUser(c);
    return c.json({ items: await publicProposals(await ctx.edits.sent(user.id), user.id) });
  });

  app.post('/api/edits/:id/accept', async (c) => {
    const user = requireUser(c);
    const { proposal, ref } = await ctx.edits.accept(refIdParam(c), { id: user.id, isAdmin: await viewerIsAdmin(user.id) });
    const [item] = await refs.toPublicList([ref], user.id);
    return c.json({ proposal, item });
  });

  app.post('/api/edits/:id/reject', async (c) => {
    const user = requireUser(c);
    const body = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
    return c.json({ proposal: await ctx.edits.reject(refIdParam(c), { id: user.id, isAdmin: await viewerIsAdmin(user.id) }, body.reason) });
  });

  app.post('/api/edits/:id/cancel', async (c) => {
    const user = requireUser(c);
    return c.json({ proposal: await ctx.edits.cancel(refIdParam(c), user.id) });
  });

  // ── 보드 ────────────────────────────────────────────────
  /** 보드 목록에 표지 이미지 주소를 붙임 */
  const publicBoards = async <T extends { coverIds: number[] }>(list: T[]) => {
    const ids = [...new Set(list.flatMap((b) => b.coverIds))];
    const found: Reference[] = ids.length ? (await refs.search({ ids, sort: 'ids', limit: Math.min(ids.length, 100) })).items : [];
    const byId = new Map(found.map((r) => [r.id, r]));
    return list.map((b) => ({
      ...b,
      covers: b.coverIds
        .map((id) => byId.get(id))
        .filter((r): r is Reference => !!r)
        .map((r) => ({ id: r.id, url: refs.previewUrl(r), color: r.palette[0]?.hex ?? null })),
    }));
  };

  app.get('/api/boards', async (c) => {
    const viewer = c.get('user');
    const owner = c.req.query('owner') || viewer?.id;
    if (!owner) throw new UnauthorizedError();
    const refQuery = c.req.query('ref');
    const refId = owner === viewer?.id && refQuery ? intParam(refQuery, 0, 0, 2 ** 31 - 1) || undefined : undefined;
    return c.json({ items: await publicBoards(await ctx.boards.listByOwner(owner, refId)) });
  });

  app.post('/api/boards', async (c) => {
    const user = requireUser(c);
    if (!boardLimiter.take(user.id)) throw new UserError('잠시 후 다시 시도해 주세요.', { status: 429, code: 'rate_limited' });
    const body = await c.req.json<{ name?: string; refId?: number }>().catch(() => ({}) as { name?: string; refId?: number });
    let board = await ctx.boards.create(user, body.name);
    if (body.refId) board = await ctx.boards.setItem(board.id, user.id, Number(body.refId), true);
    const [item] = await publicBoards([board]);
    return c.json({ item });
  });

  app.get('/api/boards/:id', async (c) => {
    const [item] = await publicBoards([await ctx.boards.require(refIdParam(c))]);
    return c.json({ item });
  });

  app.get('/api/boards/:id/refs', async (c) => {
    const pageSize = intParam(c.req.query('limit'), 24, 1, 60);
    const page = intParam(c.req.query('page'), 1, 1, 10_000);
    const offset = (page - 1) * pageSize;
    const { items, total } = await ctx.boards.items(refIdParam(c), pageSize, offset);
    return c.json({
      items: await refs.toPublicList(items, c.get('user')?.id),
      total,
      page,
      pageSize,
      hasMore: offset + items.length < total,
    });
  });

  app.post('/api/boards/:id', async (c) => {
    const user = requireUser(c);
    const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
    const [item] = await publicBoards([await ctx.boards.rename(refIdParam(c), user.id, body.name)]);
    return c.json({ item });
  });

  app.post('/api/boards/:id/delete', async (c) => {
    const user = requireUser(c);
    await ctx.boards.delete(refIdParam(c), user.id);
    return c.json({ ok: true });
  });

  app.post('/api/boards/:id/items', async (c) => {
    const user = requireUser(c);
    if (!boardLimiter.take(user.id)) throw new UserError('잠시 후 다시 시도해 주세요.', { status: 429, code: 'rate_limited' });
    const body = await c.req.json<{ refId?: number; on?: boolean }>().catch(() => ({}) as { refId?: number; on?: boolean });
    const refId = Number(body.refId);
    if (!Number.isInteger(refId) || refId <= 0) throw new UserError('레퍼런스 번호가 필요해요.');
    const [item] = await publicBoards([await ctx.boards.setItem(refIdParam(c), user.id, refId, body.on !== false)]);
    return c.json({ item });
  });

  // ── 점수 / 프로필 ───────────────────────────────────────
  app.get('/api/leaderboard', async (c) => {
    const page = intParam(c.req.query('page'), 1, 1, 1000);
    const pageSize = intParam(c.req.query('limit'), 20, 1, 50);
    const { rows, total } = await community.leaderboard(page, pageSize);
    return c.json({ rows, total, page, pageSize, scoring: config.scoring, tiers: TIERS });
  });

  app.get('/api/users/:id', async (c) => {
    const profile = await community.profile(c.req.param('id'));
    const viewer = c.get('user')?.id;
    return c.json({
      user: profile.user,
      score: profile.score,
      categories: profile.categories,
      recent: await refs.toPublicList(profile.recent, viewer),
      top: await refs.toPublicList(profile.top, viewer),
    });
  });

  // ── 관리자: 예전 채팅 채널에서 레퍼런스 옮겨오기 ─────────
  // 관리자 여부는 디스코드 서버 권한으로 판단 (봇에게 물어보고 잠깐 기억)
  const adminCache = new Map<string, { ok: boolean; at: number }>();
  const isAdminUser = async (userId: string): Promise<boolean> => {
    const hit = adminCache.get(userId);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.ok;
    if (!ctx.bot?.isGuildAdmin) return false;
    const ok = await ctx.bot.isGuildAdmin(userId).catch(() => false);
    adminCache.set(userId, { ok, at: Date.now() });
    return ok;
  };
  const requireAdmin = async (c: Context<Env>): Promise<AuthedUser> => {
    const user = requireUser(c);
    if (!ctx.bot?.isOnline()) throw new ServiceUnavailableError('디스코드 봇이 오프라인이라 관리자 확인을 할 수 없어요.');
    if (!(await isAdminUser(user.id))) throw new ForbiddenError('서버 관리자만 사용할 수 있어요.');
    return user;
  };
  const importer = ctx.importer;
  const importImages = new Map<number, Buffer>();
  // 관리자 화면에서 실패한 요청은 서버 기록에 남김 (화면 알림은 금방 사라지므로)
  const logFailures = async (c: Context<Env>, next: () => Promise<void>) => {
    await next();
    if (c.res.status >= 400) {
      const body = (await c.res
        .clone()
        .json()
        .catch(() => null)) as { error?: string } | null;
      log.warn(`${c.req.method} ${c.req.path} → ${c.res.status}${body?.error ? ` · ${body.error.split('\n')[0]}` : ''}`);
    }
  };
  app.use('/api/admin/*', logFailures);
  app.use('/api/import/*', logFailures);
  const nameField = (v: string | undefined) => (v === 'map' ? 'map' : 'creator');

  // ── 디스코드 서버 멤버 확인 (사이트에서 올리기 / 가져오기) ──
  const memberCache = new Map<string, { ok: boolean; at: number }>();
  const isMemberUser = async (userId: string): Promise<boolean> => {
    const hit = memberCache.get(userId);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.ok;
    if (!ctx.bot?.isGuildMember) return false;
    const ok = await ctx.bot.isGuildMember(userId).catch(() => false);
    memberCache.set(userId, { ok, at: Date.now() });
    return ok;
  };
  const requireMember = async (c: Context<Env>): Promise<AuthedUser> => {
    const user = requireUser(c);
    if (!ctx.bot?.isOnline()) throw new ServiceUnavailableError();
    if (!(await isMemberUser(user.id))) throw new ForbiddenError('GFX References 디스코드 서버 멤버만 사용할 수 있어요.');
    return user;
  };
  const duplicateResponse = (c: Context<Env>, err: DuplicateError) =>
    c.json(
      {
        error: err.message,
        code: 'duplicate',
        matches: err.matches.map((m) => ({ id: m.id, title: m.title, thumbUrl: `/api/refs/${m.id}/thumb` })),
      },
      409,
    );
  const uploadLimiter = new RateLimiter(10, 60_000);
  const importLimiter = new RateLimiter(40, 60_000);

  // ── 사이트에서 레퍼런스 올리기 (디스코드 /업로드 와 같음) ──
  app.post(
    '/api/refs',
    bodyLimit({
      maxSize: config.upload.maxBytes + 512 * 1024,
      onError: (c) =>
        c.json({ error: `파일이 너무 큽니다. 최대 ${Math.round(config.upload.maxBytes / 1024 / 1024)}MB 까지 올릴 수 있습니다.`, code: 'too_large' }, 413),
    }),
    async (c) => {
      const user = await requireMember(c);
      if (!uploadLimiter.take(user.id)) throw new UserError('잠시 후 다시 시도해 주세요.', { status: 429, code: 'rate_limited' });
      const form = await c.req.parseBody();
      const upload = form.file;
      if (!(upload instanceof File) || !upload.size) throw new UserError('이미지 파일을 골라 주세요.');
      const text = (k: string) => (typeof form[k] === 'string' ? (form[k] as string) : null);
      const category = text('category') ?? '';
      if (!isCategory(category)) throw new UserError('분류를 선택해 주세요.');
      try {
        const ref = await refs.create(
          {
            file: { buffer: Buffer.from(await upload.arrayBuffer()), filename: upload.name || 'image.png', contentType: upload.type || null },
            category,
            title: text('title'),
            mapName: text('mapName'),
            creatorName: text('creators'),
            tags: (text('tags') ?? '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
            uploader: user,
          },
          { allowDuplicate: text('allowDuplicate') === '1' },
        );
        const [item] = await refs.toPublicList([ref], user.id);
        return c.json({ item });
      } catch (err) {
        if (err instanceof DuplicateError) return duplicateResponse(c, err);
        throw err;
      }
    },
  );

  // ── 가져오기: 예전 채팅 채널의 레퍼런스를 함께 정리 ──
  // 서버 멤버 누구나 태그를 붙여 저장할 수 있고, 저장한 사람이 올린 사람(점수)이 됩니다.
  // 채널 읽기와 이름 통일, 새 태그 만들기는 관리자만.
  app.get('/api/import/status', async (c) => {
    const user = await requireMember(c);
    return c.json({
      counts: await importer.counts(),
      scan: importer.scanState(),
      guildId: config.discord.guildId ?? null,
      isAdmin: await isAdminUser(user.id),
    });
  });

  app.get('/api/import/items', async (c) => {
    const user = await requireMember(c);
    const status = c.req.query('status');
    const s = status === 'skipped' || status === 'imported' ? status : 'pending';
    return c.json({ items: await importer.list(s, s === 'pending' ? user.id : undefined) });
  });

  app.post('/api/import/items/:id/claim', async (c) => {
    const user = await requireMember(c);
    return c.json({ item: await importer.claim(Number(c.req.param('id')), user.id) });
  });

  app.post('/api/import/items/:id', async (c) => {
    const user = await requireMember(c);
    const body = await c.req.json<Parameters<typeof importer.update>[1]>().catch(() => ({}));
    return c.json({ item: await importer.update(Number(c.req.param('id')), body, user.id) });
  });

  app.post('/api/import/items/:id/skip', async (c) => {
    const user = await requireMember(c);
    return c.json({ item: await importer.setStatus(Number(c.req.param('id')), 'skipped', user.id) });
  });

  app.post('/api/import/items/:id/restore', async (c) => {
    const user = await requireMember(c);
    return c.json({ item: await importer.setStatus(Number(c.req.param('id')), 'pending', user.id) });
  });

  app.post('/api/import/items/:id/commit', async (c) => {
    const user = await requireMember(c);
    if (!importLimiter.take(user.id)) throw new UserError('잠시 후 다시 시도해 주세요.', { status: 429, code: 'rate_limited' });
    const body = await c.req.json<{ allowDuplicate?: boolean }>().catch(() => ({}) as { allowDuplicate?: boolean });
    try {
      const { item, ref } = await importer.commit(Number(c.req.param('id')), user, { allowDuplicate: !!body.allowDuplicate });
      return c.json({ item, ref: { id: ref.id, siteUrl: refs.siteUrl(ref) } });
    } catch (err) {
      if (err instanceof DuplicateError) return duplicateResponse(c, err);
      throw err;
    }
  });

  // 화면에 보여줄 크기로 줄인 원본 (디스코드 링크는 만료되므로 서버가 받아서 전달)
  app.get('/api/import/items/:id/image', async (c) => {
    await requireMember(c);
    const id = Number(c.req.param('id'));
    let img = importImages.get(id);
    if (!img) {
      const { file } = await importer.original(id);
      img = await sharp(file.buffer, { animated: false })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      importImages.set(id, img);
      if (importImages.size > (config.lowMemory ? 30 : 200)) importImages.delete(importImages.keys().next().value!);
    }
    return c.body(new Uint8Array(img), 200, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600' });
  });

  app.get('/api/import/suggest', async (c) => {
    await requireMember(c);
    return c.json({ similar: await importer.suggest(nameField(c.req.query('field')), c.req.query('name') ?? '') });
  });

  // ── 제작과정(스피드아트) 영상 ─────────────────────────────
  const videoLimiter = new RateLimiter(10, 60_000);
  const publicVideos = async (refId: number, viewerId: string | undefined) => {
    const ref = await refs.require(refId);
    const isAdmin = viewerId ? await viewerIsAdmin(viewerId) : false;
    return (await ctx.videos.list(refId)).map((v) => ({
      ...v,
      thumbUrl: `https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg`,
      canRemove: !!viewerId && (isAdmin || viewerId === v.addedBy.id || viewerId === ref.uploaderId),
    }));
  };

  app.get('/api/refs/:id/videos', async (c) => {
    return c.json({ items: await publicVideos(refIdParam(c), c.get('user')?.id), points: config.scoring.pointsPerVideo });
  });

  app.post('/api/refs/:id/videos', async (c) => {
    const user = await requireMember(c);
    if (!videoLimiter.take(user.id)) throw new UserError('잠시 후 다시 시도해 주세요.', { status: 429, code: 'rate_limited' });
    const body = await c.req.json<{ url?: string }>().catch(() => ({}) as { url?: string });
    await ctx.videos.add(refIdParam(c), body.url, user);
    const [item] = await refs.toPublicList([await refs.require(refIdParam(c))], user.id);
    return c.json({ items: await publicVideos(refIdParam(c), user.id), item });
  });

  app.post('/api/refs/:id/videos/:videoId/delete', async (c) => {
    const user = requireUser(c);
    const videoId = Number.parseInt(c.req.param('videoId') ?? '', 10);
    if (!Number.isInteger(videoId) || videoId <= 0) throw new NotFoundError();
    await ctx.videos.remove(refIdParam(c), videoId, { id: user.id, isAdmin: await viewerIsAdmin(user.id) });
    const [item] = await refs.toPublicList([await refs.require(refIdParam(c))], user.id);
    return c.json({ items: await publicVideos(refIdParam(c), user.id), item });
  });

  // ── 신고 ────────────────────────────────────────────────
  // ── 쇼케이스 (유튜브 영상) ──────────────────────────────
  const showcaseLimiter = new RateLimiter(30, 60_000);
  const showcaseId = (c: Context<Env>) => {
    const id = Number.parseInt(c.req.param('id') ?? '', 10);
    if (!Number.isInteger(id) || id <= 0) throw new NotFoundError();
    return id;
  };

  app.get('/api/showcase', async (c) => {
    const q = c.req.query();
    const pageSize = intParam(q.limit, 24, 1, 60);
    const page = intParam(q.page, 1, 1, 10_000);
    const offset = (page - 1) * pageSize;
    const { items, total } = await ctx.showcase.list({ q: q.q?.slice(0, 200), addedBy: q.addedBy, limit: pageSize, offset });
    return c.json({ items: items.map((s) => ctx.showcase.toPublic(s)), total, page, pageSize, hasMore: offset + items.length < total });
  });

  app.get('/api/showcase/:id', async (c) => {
    return c.json({ item: ctx.showcase.toPublic(await ctx.showcase.require(showcaseId(c))) });
  });

  // 영상 주소면 바로 올라가고, 재생목록 주소면 관리자 승인 요청
  app.post('/api/showcase', async (c) => {
    const user = await requireMember(c);
    if (!showcaseLimiter.take(user.id)) throw new UserError('잠시 후 다시 시도해 주세요.', { status: 429, code: 'rate_limited' });
    const body = await c.req.json<{ url?: string }>().catch(() => ({}) as { url?: string });
    const res = await ctx.showcase.submit(body.url, user);
    return c.json(res.kind === 'video' ? { kind: 'video', item: ctx.showcase.toPublic(res.item) } : res);
  });

  app.post('/api/showcase/:id/delete', async (c) => {
    const user = requireUser(c);
    await ctx.showcase.remove(showcaseId(c), { id: user.id, isAdmin: await viewerIsAdmin(user.id) });
    return c.json({ ok: true });
  });

  // 내가 보낸 재생목록 요청 (처리 상태 확인)
  app.get('/api/showcase-requests/mine', async (c) => {
    const user = requireUser(c);
    return c.json({ items: await ctx.showcase.requests({ status: 'all', requestedBy: user.id }) });
  });

  app.get('/api/admin/showcase-requests', async (c) => {
    await requireAdmin(c);
    const all = c.req.query('status') === 'all';
    return c.json({ items: await ctx.showcase.requests({ status: all ? 'all' : 'pending' }) });
  });

  app.post('/api/admin/showcase-requests/:id', async (c) => {
    const user = await requireAdmin(c);
    const body = await c.req.json<{ action?: string }>().catch(() => ({}) as { action?: string });
    if (body.action !== 'approve' && body.action !== 'reject') throw new UserError('승인 또는 거절을 골라 주세요.');
    const req = await ctx.showcase.decide(showcaseId(c), body.action === 'approve', { id: user.id, isAdmin: true });
    return c.json({ request: req });
  });

  // 관리자: 재생목록 가져오기용 유튜브 API 키 (전체 키는 돌려주지 않고 마지막 4글자만)
  app.get('/api/admin/youtube-key', async (c) => {
    await requireAdmin(c);
    return c.json({ status: ctx.youtubeKey.status() });
  });

  const youtubeKeyLimiter = new RateLimiter(10, 60_000);
  app.post('/api/admin/youtube-key', async (c) => {
    const user = await requireAdmin(c);
    if (!youtubeKeyLimiter.take(user.id)) throw new UserError('잠시 후 다시 시도해 주세요.', { status: 429, code: 'rate_limited' });
    const body = await c.req.json<{ key?: string }>().catch(() => ({}) as { key?: string });
    return c.json({ status: await ctx.youtubeKey.set(body.key, user.id) });
  });

  app.post('/api/admin/youtube-key/delete', async (c) => {
    const user = await requireAdmin(c);
    return c.json({ status: await ctx.youtubeKey.clear(user.id) });
  });

  const reportLimiter = new RateLimiter(10, 60_000);
  app.post('/api/reports', async (c) => {
    const user = requireUser(c);
    if (!reportLimiter.take(user.id)) throw new UserError('잠시 후 다시 시도해 주세요.', { status: 429, code: 'rate_limited' });
    const body = await c.req.json<{ targetType?: string; targetId?: number; reason?: string; note?: string }>().catch(() => ({}) as Record<string, never>);
    const type = body.targetType === 'resource' || body.targetType === 'showcase' ? body.targetType : 'ref';
    const id = Number(body.targetId);
    if (!Number.isInteger(id) || id <= 0) throw new UserError('신고할 대상이 없어요.');
    const report = await ctx.reports.create(type, id, user, body.reason, body.note);
    return c.json({ report });
  });

  app.get('/api/admin/reports', async (c) => {
    await requireAdmin(c);
    const s = c.req.query('status');
    const status = s === 'resolved' || s === 'dismissed' ? s : 'open';
    const list = await ctx.reports.list(status);
    const items = await Promise.all(list.map(async (r) => ({ ...r, target: await ctx.reports.target(r.targetType, r.targetId) })));
    return c.json({ items });
  });

  app.post('/api/admin/reports/:id', async (c) => {
    const user = await requireAdmin(c);
    const body = await c.req.json<{ status?: string }>().catch(() => ({}) as { status?: string });
    const status = body.status === 'dismissed' ? 'dismissed' : 'resolved';
    return c.json({ report: await ctx.reports.close(refIdParam(c), status, { id: user.id, isAdmin: true }) });
  });

  // ── 에셋 · 플러그인 · 텍스쳐팩 ───────────────────────────
  const resourceKind = (v: string | undefined) => {
    if (!isResourceKind(v)) throw new UserError('종류(asset / plugin / texturepack)를 골라 주세요.');
    return v;
  };

  app.get('/api/resources', async (c) => {
    const q = c.req.query();
    const pageSize = intParam(q.limit, 24, 1, 60);
    const page = intParam(q.page, 1, 1, 10_000);
    const offset = (page - 1) * pageSize;
    const { items, total } = await ctx.resources.list({
      kind: q.kind ? resourceKind(q.kind) : undefined,
      q: q.q,
      tags: (q.tags ?? '').split(',').filter(Boolean),
      uploaderId: q.uploader,
      sort: q.sort === 'downloads' ? 'downloads' : 'newest',
      limit: pageSize,
      offset,
    });
    return c.json({ items: items.map((r) => ctx.resources.toPublic(r)), total, page, pageSize, hasMore: offset + items.length < total });
  });

  app.get('/api/resources/tags', async (c) => {
    return c.json({ tags: await ctx.resources.listTags(resourceKind(c.req.query('kind'))) });
  });

  app.get('/api/resources/:id', async (c) => {
    return c.json({ item: ctx.resources.toPublic(await ctx.resources.require(refIdParam(c))) });
  });

  app.get('/api/resources/:id/file', async (c) => {
    const user = requireUser(c);
    if (!downloadLimiter.take(user.id)) throw new UserError('잠시 후 다시 시도해 주세요.', { status: 429, code: 'rate_limited' });
    const res = await ctx.resources.require(refIdParam(c));
    const file = await ctx.resources.fetchFile(res);
    return c.body(new Uint8Array(file.data), 200, {
      'Content-Type': file.contentType,
      'Content-Length': String(file.data.length),
      'Content-Disposition': contentDisposition('attachment', file.filename),
      'Cache-Control': 'private, no-store',
      'Access-Control-Expose-Headers': 'Content-Disposition',
    });
  });

  app.post(
    '/api/resources',
    bodyLimit({
      maxSize: config.upload.resourceMaxBytes + RESOURCE_LIMITS.images * RESOURCE_LIMITS.imageBytes + 1024 * 1024,
      onError: (c) => c.json({ error: '파일이 너무 커요.', code: 'too_large' }, 413),
    }),
    async (c) => {
      const user = await requireMember(c);
      if (!uploadLimiter.take(user.id)) throw new UserError('잠시 후 다시 시도해 주세요.', { status: 429, code: 'rate_limited' });
      const form = await c.req.parseBody({ all: true });
      const text = (k: string) => {
        const v = form[k];
        return typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null;
      };
      const files = (k: string) => {
        const v = form[k];
        return (Array.isArray(v) ? v : v ? [v] : []).filter((f): f is File => f instanceof File && f.size > 0);
      };
      const toUpload = async (f: File) => ({ buffer: Buffer.from(await f.arrayBuffer()), filename: f.name || 'file', contentType: f.type || null });
      const [file] = files('file');
      const res = await ctx.resources.create({
        kind: resourceKind(text('kind') ?? undefined),
        title: text('title'),
        description: text('description'),
        creators: text('creators'),
        tags: (text('tags') ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        file: file ? await toUpload(file) : null,
        images: await Promise.all(files('images').map(toUpload)),
        youtube: text('youtube'),
        linkUrl: text('linkUrl'),
        uploader: user,
      });
      return c.json({ item: ctx.resources.toPublic(res) });
    },
  );

  app.post('/api/resources/:id/delete', async (c) => {
    const user = requireUser(c);
    const res = await ctx.resources.delete(refIdParam(c), { id: user.id, isAdmin: await viewerIsAdmin(user.id) });
    return c.json({ ok: true, id: res.id });
  });

  // 종류별 태그 관리 (관리자)
  app.post('/api/admin/resource-tags', async (c) => {
    const user = await requireAdmin(c);
    const body = await c.req.json<{ kind?: string; name?: string; description?: string }>().catch(() => ({}) as Record<string, never>);
    return c.json({ tag: await ctx.resources.addTag(resourceKind(body.kind), String(body.name ?? ''), body.description ?? null, { id: user.id, isAdmin: true }) });
  });

  app.post('/api/admin/resource-tags/rename', async (c) => {
    const user = await requireAdmin(c);
    const body = await c.req.json<{ kind?: string; from?: string; to?: string }>().catch(() => ({}) as Record<string, never>);
    const res = await ctx.resources.renameTag(resourceKind(body.kind), String(body.from ?? ''), String(body.to ?? ''), { id: user.id, isAdmin: true });
    return c.json({ from: res.from, to: res.to, refs: res.count });
  });

  app.post('/api/admin/resource-tags/delete', async (c) => {
    const user = await requireAdmin(c);
    const body = await c.req.json<{ kind?: string; name?: string }>().catch(() => ({}) as Record<string, never>);
    await ctx.resources.removeTag(resourceKind(body.kind), String(body.name ?? ''), { id: user.id, isAdmin: true });
    return c.json({ ok: true });
  });

  // ── 관리자 전용 ──
  app.get('/api/admin/import/channels', async (c) => {
    await requireAdmin(c);
    return c.json({ channels: await importer.listChannels() });
  });

  app.post('/api/admin/import/scan', async (c) => {
    await requireAdmin(c);
    const body = await c.req.json<{ channelId?: string }>().catch(() => ({}) as { channelId?: string });
    if (!body.channelId || !/^\d+$/.test(body.channelId)) throw new UserError('채널을 골라 주세요.');
    return c.json({ scan: importer.startScan(body.channelId) });
  });

  // 태그 붙이는 중에 바로 새 태그 만들기 (디스코드 /관리 태그추가 와 같음)
  app.post('/api/admin/tags', async (c) => {
    const user = await requireAdmin(c);
    const body = await c.req
      .json<{ name?: string; description?: string; group?: string }>()
      .catch(() => ({}) as { name?: string; description?: string; group?: string });
    const tag = await community.addTag(String(body.name ?? ''), body.description ?? null, { id: user.id, isAdmin: true }, tagGroupParam(body.group));
    return c.json({ tag });
  });

  // 태그 지우기: 달려 있던 레퍼런스에서도 빠짐
  app.post('/api/admin/tags/delete', async (c) => {
    const user = await requireAdmin(c);
    const body = await c.req.json<{ name?: string; group?: string }>().catch(() => ({}) as { name?: string; group?: string });
    const res = await community.removeTag(String(body.name ?? ''), { id: user.id, isAdmin: true }, tagGroupParam(body.group));
    refs.refreshArchives(res.refIds);
    log.info(`태그 삭제: ${body.name} (${tagGroupParam(body.group)}, 레퍼런스 ${res.refIds.length}개) by ${user.username}`);
    return c.json({ refs: res.refIds.length });
  });

  // 태그 이름 바꾸기: 그 태그가 달린 모든 레퍼런스와 가져오기 후보에 한꺼번에 적용
  app.post('/api/admin/tags/rename', async (c) => {
    const user = await requireAdmin(c);
    const body = await c.req.json<{ from?: string; to?: string; group?: string }>().catch(() => ({}) as { from?: string; to?: string; group?: string });
    const res = await community.renameTag(String(body.from ?? ''), String(body.to ?? ''), { id: user.id, isAdmin: true }, tagGroupParam(body.group));
    refs.refreshArchives(res.refIds);
    log.info(`태그 이름 변경: ${res.from} → ${res.to} (레퍼런스 ${res.refIds.length}개) by ${user.username}`);
    return c.json({ from: res.from, to: res.to, refs: res.refIds.length });
  });

  app.get('/api/admin/import/names', async (c) => {
    await requireAdmin(c);
    return c.json({ groups: await importer.similarGroups(nameField(c.req.query('field'))) });
  });

  app.post('/api/admin/import/names/rename', async (c) => {
    const user = await requireAdmin(c);
    const body = await c.req.json<{ field?: string; from?: string[]; to?: string }>().catch(() => ({}) as { field?: string; from?: string[]; to?: string });
    if (!Array.isArray(body.from) || !body.from.length) throw new UserError('바꿀 이름을 골라 주세요.');
    return c.json(await importer.renameAll(nameField(body.field), body.from.map(String), String(body.to ?? ''), { id: user.id, isAdmin: true }));
  });

  app.post('/api/admin/import/names/ignore', async (c) => {
    await requireAdmin(c);
    const body = await c.req.json<{ field?: string; names?: string[] }>().catch(() => ({}) as { field?: string; names?: string[] });
    if (!Array.isArray(body.names) || body.names.length < 2) throw new UserError('이름 묶음이 필요해요.');
    await importer.ignoreGroup(nameField(body.field), body.names.map(String));
    return c.json({ ok: true });
  });

  // ── 로그인 ──────────────────────────────────────────────
  app.get('/api/auth/me', async (c) => {
    const user = c.get('user');
    return c.json({
      user: user
        ? {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            isAdmin: ctx.bot?.isOnline() ? await isAdminUser(user.id) : false,
            isMember: ctx.bot?.isOnline() ? await isMemberUser(user.id) : false,
            pendingEdits: await ctx.edits.pendingCount(user.id),
            openReports: ctx.bot?.isOnline() && (await isAdminUser(user.id)) ? await ctx.reports.openCount() : 0,
            pendingShowcase: ctx.bot?.isOnline() && (await isAdminUser(user.id)) ? await ctx.showcase.pendingCount() : 0,
          }
        : null,
    });
  });

  app.post('/api/auth/logout', async (c) => {
    const token = c.get('token');
    if (token) await community.revokeToken(token);
    deleteCookie(c, TOKEN_COOKIE, { path: '/', secure: secureCookie || crossSite, sameSite: crossSite ? 'None' : 'Lax' });
    return c.json({ ok: true });
  });

  /** 연동 코드 발급: 디스코드에서 `/연동 코드:XXXX-XXXX` 로 승인 */
  app.post('/api/auth/device', async (c) => {
    if (!deviceLimiter.take(clientIp(c))) throw new UserError('잠시 후 다시 시도해 주세요.', { status: 429, code: 'rate_limited' });
    if (!ctx.bot?.isOnline()) throw new ServiceUnavailableError('디스코드 봇이 오프라인이라 코드 연동을 사용할 수 없습니다.');
    const body = await c.req.json<{ client?: string }>().catch(() => ({}) as { client?: string });
    const label = body.client === 'plugin' ? 'plugin' : 'web';
    const code = await community.createDeviceCode(label);
    return c.json({
      deviceCode: code.deviceCode,
      userCode: code.userCode,
      expiresAt: code.expiresAt.toISOString(),
      interval: 3,
      command: `/연동 코드:${code.userCode}`,
    });
  });

  app.post('/api/auth/device/poll', async (c) => {
    const body = await c.req.json<{ deviceCode?: string }>().catch(() => ({}) as { deviceCode?: string });
    if (!body.deviceCode) throw new UserError('deviceCode 가 필요합니다.');
    const res = await community.pollDeviceCode(body.deviceCode);
    if (res.status !== 'approved' || !res.token) return c.json({ status: res.status });
    const user = await community.userForToken(res.token);
    const userOut = user
      ? {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          isAdmin: await isAdminUser(user.id),
          isMember: await isMemberUser(user.id),
          pendingEdits: await ctx.edits.pendingCount(user.id),
        }
      : null;
    if (res.label === 'web') {
      setSessionCookie(c, res.token);
      return c.json({ status: 'approved', user: userOut });
    }
    return c.json({ status: 'approved', token: res.token, user: userOut });
  });

  // 디스코드 OAuth2 (웹사이트 로그인)
  app.get('/api/auth/discord/login', (c) => {
    if (!config.discord.oauthEnabled) throw new UserError('디스코드 OAuth 가 설정되지 않았습니다.', { status: 404, code: 'oauth_disabled' });
    const rawRedirect = c.req.query('redirect') ?? '/';
    const redirect = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/';
    const state = crypto.randomUUID();
    setCookie(c, OAUTH_COOKIE, `${state}|${redirect}`, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'Lax',
      path: '/api/auth/discord',
      maxAge: 600,
    });
    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', config.discord.clientId!);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', `${config.publicBaseUrl}/api/auth/discord/callback`);
    url.searchParams.set('scope', 'identify guilds');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'none');
    return c.redirect(url.toString());
  });

  app.get('/api/auth/discord/callback', async (c) => {
    const back = (msg: string) => c.redirect(`/#/login-error?msg=${encodeURIComponent(msg)}`);
    const cookie = getCookie(c, OAUTH_COOKIE) ?? '';
    deleteCookie(c, OAUTH_COOKIE, { path: '/api/auth/discord' });
    const [state, redirect = '/'] = cookie.split('|');
    if (!state || state !== c.req.query('state')) return back('로그인 요청이 만료되었습니다. 다시 시도해 주세요.');
    const code = c.req.query('code');
    if (!code) return back('디스코드 로그인이 취소되었습니다.');

    try {
      const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.discord.clientId!,
          client_secret: config.discord.clientSecret!,
          grant_type: 'authorization_code',
          code,
          redirect_uri: `${config.publicBaseUrl}/api/auth/discord/callback`,
        }),
      });
      if (!tokenRes.ok) return back('디스코드 인증에 실패했습니다.');
      const { access_token } = (await tokenRes.json()) as { access_token: string };
      const headers = { Authorization: `Bearer ${access_token}` };
      const me = (await (await fetch('https://discord.com/api/v10/users/@me', { headers })).json()) as {
        id: string;
        username: string;
        global_name?: string | null;
        avatar?: string | null;
      };
      if (!me?.id) return back('디스코드 사용자 정보를 가져오지 못했습니다.');

      if (config.discord.requireGuildMembership && config.discord.guildId) {
        const guilds = (await (await fetch('https://discord.com/api/v10/users/@me/guilds', { headers })).json()) as { id: string }[];
        const member = Array.isArray(guilds) && guilds.some((g) => g.id === config.discord.guildId);
        if (!member) return back('GFX References 디스코드 서버 멤버만 로그인할 수 있습니다.');
      }

      const token = await community.createSession(
        { id: me.id, username: me.username, displayName: me.global_name ?? me.username, avatarUrl: avatarUrl(me.id, me.avatar) },
        'web',
      );
      setSessionCookie(c, token);
      return c.redirect(redirect);
    } catch (err) {
      log.error('OAuth 콜백 처리 실패', err);
      return back('로그인 처리 중 오류가 발생했습니다.');
    }
  });

  // ── 미리보기 (공개 URL 이 없을 때) ──────────────────────
  app.get('/api/previews/*', async (c) => {
    const key = decodeURIComponent(c.req.path.slice('/api/previews/'.length));
    if (!isSafeKey(key)) throw new NotFoundError();
    const obj = await ctx.storage.get(key);
    if (!obj) throw new NotFoundError();
    return c.body(new Uint8Array(obj.data), 200, {
      'Content-Type': obj.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  });

  app.all('/api/*', () => {
    throw new NotFoundError('없는 API 입니다.');
  });

  // ── 정적 웹사이트 ───────────────────────────────────────
  const webRoot = path.resolve(config.webDir);
  app.get('*', async (c) => {
    let rel = decodeURIComponent(c.req.path);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(webRoot, '.' + rel);
    if (!file.startsWith(webRoot + path.sep) && file !== webRoot) return c.notFound();
    const serve = async (f: string) => {
      const data = await fs.readFile(f);
      const ext = path.extname(f);
      return c.body(new Uint8Array(data), 200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        // 코드(html/js/css)는 고치면 바로 반영되도록 매번 확인, 이미지 · 글꼴만 1시간 보관
        'Cache-Control': ext === '.html' || ext === '.js' || ext === '.mjs' || ext === '.css' ? 'no-cache' : 'public, max-age=3600',
      });
    };
    try {
      return await serve(file);
    } catch {
      if (path.extname(rel)) return c.notFound();
      try {
        return await serve(path.join(webRoot, 'index.html'));
      } catch {
        return c.text('웹사이트 파일(web/)을 찾을 수 없습니다.', 404);
      }
    }
  });

  return app;
}
