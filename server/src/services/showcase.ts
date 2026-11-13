import type { Db } from '../db/index.js';
import { usersRepo } from '../repos/users.js';
import type { Actor, UserInfo } from '../types.js';
import { ForbiddenError, NotFoundError, UserError } from '../util/errors.js';
import { logger } from '../util/log.js';
import { auditRepo } from '../repos/audit.js';
import { youtubeId } from './resources.js';

const log = logger('showcase');

/**
 * 쇼케이스: 유튜브 영상만 모아 보는 탭.
 * 제목과 제작자는 유튜브 정보(영상 제목 · 채널 이름) 그대로 쓰고, 등록한 사람이 영상마다 점수를 받습니다.
 * 재생목록을 한꺼번에 가져오려면 관리자 승인이 필요합니다 (이상한 영상을 대량으로 넣는 것을 막기 위해).
 */

export interface Showcase {
  id: number;
  youtubeId: string;
  title: string;
  channelName: string | null;
  channelUrl: string | null;
  addedBy: { id: string; name: string | null; avatarUrl: string | null };
  requestId: number | null;
  publishedAt: string | null;
  createdAt: string;
}

export type ShowcaseRequestStatus = 'pending' | 'approved' | 'rejected' | 'done' | 'failed';

export interface ShowcaseRequest {
  id: number;
  playlistId: string;
  title: string | null;
  channelName: string | null;
  itemCount: number | null;
  requestedBy: { id: string; name: string | null; avatarUrl: string | null };
  status: ShowcaseRequestStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  imported: number;
  skipped: number;
  error: string | null;
  /** 자동 연동: 몇 시간마다 새 영상을 확인하는지 (null = 연동 안 함) */
  syncHours: number | null;
  syncedAt: string | null;
  /** 자동 연동으로 지금까지 더 들어온 영상 수 */
  syncAdded: number;
  syncError: string | null;
  createdAt: string;
}

export type ShowcaseSort = 'random' | 'new' | 'old' | 'published';
export const SHOWCASE_SORTS: ShowcaseSort[] = ['random', 'new', 'old', 'published'];
/** 자동 연동 주기로 고를 수 있는 값 (시간) */
export const SYNC_HOURS = [1, 3, 6, 12, 24];

/** 영상 하나의 제목 · 채널 (oEmbed). 없는 영상이면 ok: false */
export type ShowcaseLookup = (
  id: string,
) => Promise<{ ok: true; title: string | null; author: string | null; authorUrl: string | null } | { ok: false }>;

export interface PlaylistItem {
  videoId: string;
  title: string;
  channelName: string | null;
  channelId: string | null;
  publishedAt: string | null;
}

/** 재생목록 읽기 (유튜브 Data API · 키가 있을 때만) */
export interface PlaylistApi {
  info(playlistId: string): Promise<{ title: string; channelName: string | null; itemCount: number } | null>;
  /** 50개씩 나눠서 */
  pages(playlistId: string): AsyncIterable<PlaylistItem[]>;
}

/** 관리자 채널 알림 · DM (봇이 켜져 있을 때만) */
export interface ShowcaseNotifier {
  postShowcaseRequest?(req: ShowcaseRequest, links: { playlistUrl: string; adminUrl: string }): Promise<void>;
  notifyUser?(userId: string, content: string): Promise<void>;
}

export const showcaseLookup: ShowcaseLookup = async (id) => {
  try {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if ([400, 401, 403, 404].includes(res.status)) return { ok: false };
    if (!res.ok) return { ok: true, title: null, author: null, authorUrl: null };
    const data = (await res.json()) as { title?: string; author_name?: string; author_url?: string };
    return {
      ok: true,
      title: data.title?.slice(0, 200) ?? null,
      author: data.author_name?.slice(0, 100) ?? null,
      authorUrl: data.author_url?.startsWith('https://') ? data.author_url.slice(0, 300) : null,
    };
  } catch {
    return { ok: true, title: null, author: null, authorUrl: null };
  }
};

export function youtubePlaylistApi(apiKey: string): PlaylistApi {
  const get = async (path: string, params: Record<string, string>) => {
    const qs = new URLSearchParams({ ...params, key: apiKey });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${qs}`, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(`유튜브 API 오류 (${res.status}) ${body?.error?.message ?? ''}`.trim());
    }
    return (await res.json()) as any;
  };
  return {
    async info(playlistId) {
      const data = await get('playlists', { part: 'snippet,contentDetails', id: playlistId });
      const p = data?.items?.[0];
      if (!p) return null;
      return {
        title: String(p.snippet?.title ?? '').slice(0, 200),
        channelName: p.snippet?.channelTitle ? String(p.snippet.channelTitle).slice(0, 100) : null,
        itemCount: Number(p.contentDetails?.itemCount ?? 0),
      };
    },
    async *pages(playlistId) {
      let pageToken = '';
      for (;;) {
        const data = await get('playlistItems', {
          part: 'snippet,contentDetails',
          maxResults: '50',
          playlistId,
          ...(pageToken ? { pageToken } : {}),
        });
        if (!data) return;
        yield (data.items ?? []).map(
          (it: any): PlaylistItem => ({
            videoId: String(it.contentDetails?.videoId ?? it.snippet?.resourceId?.videoId ?? ''),
            title: String(it.snippet?.title ?? ''),
            // 비공개 · 삭제된 영상에는 채널 정보가 없음
            channelName: it.snippet?.videoOwnerChannelTitle ?? null,
            channelId: it.snippet?.videoOwnerChannelId ?? null,
            publishedAt: it.contentDetails?.videoPublishedAt ?? null,
          }),
        );
        if (!data.nextPageToken) return;
        pageToken = data.nextPageToken;
      }
    },
  };
}

/** 재생목록 주소(…?list=PL…)나 재생목록 ID 에서 ID 만 */
export function playlistId(raw: string): string | null {
  const s = raw.trim();
  if (/^(PL|UU|FL|OL|LL)[\w-]{10,60}$/.test(s)) return s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host !== 'youtube.com' && host !== 'music.youtube.com' && host !== 'youtu.be') return null;
  const id = u.searchParams.get('list');
  return id && /^[\w-]{10,64}$/.test(id) ? id : null;
}

type Row = Record<string, any>;

function checkSyncHours(hours: number | null | undefined): number | null {
  if (hours == null || hours === 0) return null;
  const n = Number(hours);
  if (!SYNC_HOURS.includes(n)) throw new UserError(`자동 연동 주기는 ${SYNC_HOURS.join(', ')}시간 중에서 골라 주세요.`, { code: 'bad_sync_hours' });
  return n;
}

function person(id: string, r: Row) {
  return { id, name: r.display_name ?? r.username ?? null, avatarUrl: r.avatar_url ?? null };
}

function mapShowcase(r: Row): Showcase {
  return {
    id: Number(r.id),
    youtubeId: r.youtube_id,
    title: r.title,
    channelName: r.channel_name ?? null,
    channelUrl: r.channel_url ?? null,
    addedBy: person(r.added_by, r),
    requestId: r.request_id == null ? null : Number(r.request_id),
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function mapRequest(r: Row): ShowcaseRequest {
  return {
    id: Number(r.id),
    playlistId: r.playlist_id,
    title: r.title ?? null,
    channelName: r.channel_name ?? null,
    itemCount: r.item_count == null ? null : Number(r.item_count),
    requestedBy: person(r.requested_by, r),
    status: r.status,
    decidedBy: r.decided_by ?? null,
    decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
    imported: Number(r.imported ?? 0),
    skipped: Number(r.skipped ?? 0),
    error: r.error ?? null,
    syncHours: r.sync_hours == null ? null : Number(r.sync_hours),
    syncedAt: r.synced_at ? new Date(r.synced_at).toISOString() : null,
    syncAdded: Number(r.sync_added ?? 0),
    syncError: r.sync_error ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

const ORDER: Record<Exclude<ShowcaseSort, 'random'>, string> = {
  new: 'x.created_at DESC, x.id DESC',
  old: 'x.created_at ASC, x.id ASC',
  published: 'COALESCE(x.published_at, x.created_at) DESC, x.id DESC',
};

const SELECT = `SELECT s.*, u.username, u.display_name, u.avatar_url FROM showcases s LEFT JOIN users u ON u.discord_id = s.added_by`;
const SELECT_REQ = `SELECT q.*, u.username, u.display_name, u.avatar_url FROM showcase_requests q LEFT JOIN users u ON u.discord_id = q.requested_by`;

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export class ShowcaseService {
  private readonly running = new Map<number, Promise<void>>();
  private readonly syncing = new Set<number>();
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: Db,
    private readonly opts: {
      pointsPerVideo: number;
      lookup?: ShowcaseLookup;
      /** 유튜브 API 키가 있을 때만 (재생목록 가져오기) */
      playlistApi?: () => PlaylistApi | null;
      notifier?: () => ShowcaseNotifier | null;
      siteUrl: (path: string) => string;
    },
  ) {}

  get playlistEnabled(): boolean {
    return !!this.opts.playlistApi?.();
  }

  // ── 목록 ────────────────────────────────────────────────

  /**
   * sort = random 이면 seed 로 섞음: 같은 seed 면 몇 페이지를 넘겨도 순서가 같고(중복 · 빠짐 없음),
   * seed 를 바꾸면 새로 섞임.
   */
  async list(
    f: { q?: string; addedBy?: string; limit?: number; offset?: number; sort?: ShowcaseSort; seed?: number } = {},
  ): Promise<{ items: Showcase[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (f.addedBy) where.push(`s.added_by = ${add(f.addedBy)}`);
    for (const word of (f.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6)) {
      const like = add(`%${escapeLike(word)}%`);
      where.push(`(s.title ILIKE ${like} OR s.channel_name ILIKE ${like})`);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countParams = params.slice();
    const sort = f.sort && SHOWCASE_SORTS.includes(f.sort) ? f.sort : 'new';
    const order =
      sort === 'random'
        ? `md5(x.id::text || ':' || ${add(String(Math.abs(Math.trunc(f.seed ?? 0)) % 1_000_000_000))}), x.id`
        : ORDER[sort];
    const limit = add(Math.min(Math.max(f.limit ?? 24, 1), 60));
    const offset = add(Math.max(f.offset ?? 0, 0));
    const rows = await this.db.query<Row>(
      `SELECT x.*, count(*) OVER()::int AS total FROM (${SELECT} ${w}) x ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    let total = Number(rows[0]?.total ?? 0);
    if (!rows.length && (f.offset ?? 0) > 0) {
      const c = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${SELECT} ${w}) x`, countParams);
      total = Number(c[0]?.n ?? 0);
    }
    return { items: rows.map(mapShowcase), total };
  }

  async get(id: number): Promise<Showcase | null> {
    const rows = await this.db.query<Row>(`${SELECT} WHERE s.id = $1`, [id]);
    return rows[0] ? mapShowcase(rows[0]) : null;
  }

  async require(id: number): Promise<Showcase> {
    const s = await this.get(id);
    if (!s) throw new NotFoundError('쇼케이스 영상을 찾을 수 없어요.');
    return s;
  }

  // ── 올리기 ──────────────────────────────────────────────

  /**
   * 유튜브 주소 하나로 올리기. 영상 주소면 바로 올라가고(+점수),
   * 재생목록 주소면 관리자에게 승인 요청이 갑니다.
   */
  async submit(url: unknown, user: UserInfo): Promise<{ kind: 'video'; item: Showcase } | { kind: 'request'; request: ShowcaseRequest }> {
    const raw = String(url ?? '').trim();
    const vid = youtubeId(raw);
    const list = playlistId(raw);
    // 재생목록 안의 영상 주소(watch?v=…&list=…)는 영상 하나로 봄
    if (!vid && list) return { kind: 'request', request: await this.requestPlaylist(list, user) };
    if (!vid) throw new UserError('유튜브 영상이나 재생목록 주소를 알아볼 수 없어요. (예: https://youtu.be/…)', { code: 'bad_url' });
    return { kind: 'video', item: await this.addVideo(vid, user) };
  }

  async addVideo(id: string, user: UserInfo): Promise<Showcase> {
    const dup = await this.db.query<{ id: number }>('SELECT id FROM showcases WHERE youtube_id = $1', [id]);
    if (dup[0]) throw new UserError(`이미 쇼케이스에 있는 영상이에요. (#${dup[0].id})`, { code: 'duplicate_video' });
    const found = await (this.opts.lookup ?? showcaseLookup)(id);
    if (!found.ok) throw new UserError('유튜브에서 영상을 찾을 수 없어요. 공개(또는 일부 공개) 영상인지 확인해 주세요.', { code: 'video_not_found' });
    if (!found.title) throw new UserError('유튜브에서 영상 정보를 받아오지 못했어요. 잠시 후 다시 시도해 주세요.', { code: 'youtube_unavailable', status: 503 });
    const newId = await this.db.tx(async (q) => {
      await usersRepo.upsert(q, user);
      const rows = await q.query<{ id: number }>(
        `INSERT INTO showcases (youtube_id, title, channel_name, channel_url, added_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (youtube_id) DO NOTHING RETURNING id`,
        [id, found.title, found.author, found.authorUrl, user.id],
      );
      // 누군가 직접 다시 올리면 지웠던 기록은 없앰
      if (rows[0]) await q.query('DELETE FROM showcase_removed WHERE youtube_id = $1', [id]);
      return rows[0] ? Number(rows[0].id) : null;
    });
    if (newId == null) throw new UserError('이미 쇼케이스에 있는 영상이에요.', { code: 'duplicate_video' });
    log.info(`쇼케이스 #${newId} ${id} by ${user.username}`);
    return (await this.get(newId))!;
  }

  async remove(id: number, actor: Actor): Promise<Showcase> {
    const s = await this.require(id);
    if (!actor.isAdmin && actor.id !== s.addedBy.id) throw new ForbiddenError('올린 사람이나 관리자만 지울 수 있어요.');
    await this.db.tx(async (q) => {
      await q.query('DELETE FROM showcases WHERE id = $1', [id]);
      // 재생목록 가져오기 · 자동 연동이 같은 영상을 다시 넣지 않도록 기억
      await q.query(
        'INSERT INTO showcase_removed (youtube_id) VALUES ($1) ON CONFLICT (youtube_id) DO UPDATE SET removed_at = now()',
        [s.youtubeId],
      );
    });
    log.info(`쇼케이스 #${id} 삭제 by ${actor.id}`);
    if (actor.id !== s.addedBy.id) {
      await auditRepo.add(this.db, {
        actorId: actor.id,
        action: 'showcase.delete',
        targetType: 'showcase',
        targetId: id,
        summary: `다른 사람이 올린 쇼케이스 #${id} '${s.title}' 삭제`,
        detail: { addedBy: s.addedBy.id, youtubeId: s.youtubeId },
      });
    }
    return s;
  }

  // ── 재생목록 (관리자 승인) ──────────────────────────────

  async requestPlaylist(id: string, user: UserInfo): Promise<ShowcaseRequest> {
    const api = this.opts.playlistApi?.();
    if (!api) {
      throw new UserError('재생목록 가져오기는 아직 설정되지 않았어요. 영상 주소를 하나씩 넣어 주세요.', { code: 'playlist_disabled' });
    }
    const open = await this.db.query<{ id: number }>(
      `SELECT id FROM showcase_requests WHERE playlist_id = $1 AND status IN ('pending', 'approved') LIMIT 1`,
      [id],
    );
    if (open[0]) throw new UserError('이 재생목록은 이미 승인을 기다리거나 가져오는 중이에요.', { code: 'duplicate_request' });
    const info = await api.info(id).catch((err) => {
      log.warn(`재생목록 ${id} 정보 확인 실패`, err);
      throw new UserError('유튜브에서 재생목록 정보를 받아오지 못했어요. 잠시 후 다시 시도해 주세요.', { code: 'youtube_unavailable', status: 503 });
    });
    if (!info) throw new UserError('재생목록을 찾을 수 없어요. 공개(또는 일부 공개) 재생목록인지 확인해 주세요.', { code: 'playlist_not_found' });
    if (!info.itemCount) throw new UserError('빈 재생목록이에요.', { code: 'playlist_empty' });

    const reqId = await this.db.tx(async (q) => {
      await usersRepo.upsert(q, user);
      const rows = await q.query<{ id: number }>(
        `INSERT INTO showcase_requests (playlist_id, title, channel_name, item_count, requested_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [id, info.title, info.channelName, info.itemCount, user.id],
      );
      return Number(rows[0].id);
    });
    const req = (await this.getRequest(reqId))!;
    log.info(`쇼케이스 재생목록 요청 #${reqId} ${id} (${info.itemCount}개) by ${user.username}`);
    const notifier = this.opts.notifier?.();
    if (notifier?.postShowcaseRequest) {
      notifier
        .postShowcaseRequest(req, { playlistUrl: `https://www.youtube.com/playlist?list=${id}`, adminUrl: this.opts.siteUrl('#/showcase?tab=requests') })
        .catch((err) => log.warn(`쇼케이스 요청 #${reqId} 관리자 알림 실패`, err));
    }
    return req;
  }

  async getRequest(id: number): Promise<ShowcaseRequest | null> {
    const rows = await this.db.query<Row>(`${SELECT_REQ} WHERE q.id = $1`, [id]);
    return rows[0] ? mapRequest(rows[0]) : null;
  }

  async requests(filter: { status?: 'pending' | 'all' | 'done'; requestedBy?: string } = {}): Promise<ShowcaseRequest[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status === 'done') where.push(`q.status = 'done'`);
    else if (filter.status !== 'all') where.push(`q.status IN ('pending', 'approved')`);
    if (filter.requestedBy) {
      params.push(filter.requestedBy);
      where.push(`q.requested_by = $${params.length}`);
    }
    const rows = await this.db.query<Row>(
      `${SELECT_REQ} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY q.created_at DESC LIMIT 100`,
      params,
    );
    return rows.map(mapRequest);
  }

  async pendingCount(): Promise<number> {
    const rows = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM showcase_requests WHERE status = 'pending'`);
    return Number(rows[0]?.n ?? 0);
  }

  /** 관리자: 승인하면 뒤에서 가져오기 시작, 거절하면 요청한 사람에게 알림 */
  async decide(id: number, approve: boolean, actor: Actor, opts: { syncHours?: number | null } = {}): Promise<ShowcaseRequest> {
    if (!actor.isAdmin) throw new ForbiddenError('관리자만 승인할 수 있어요.');
    const syncHours = approve ? checkSyncHours(opts.syncHours) : null;
    const rows = await this.db.query<{ id: number }>(
      `UPDATE showcase_requests SET status = $2, decided_by = $3, decided_at = now(), sync_hours = $4
       WHERE id = $1 AND status = 'pending' RETURNING id`,
      [id, approve ? 'approved' : 'rejected', actor.id, syncHours],
    );
    const req = await this.getRequest(id);
    if (!req) throw new NotFoundError('요청을 찾을 수 없어요.');
    if (!rows[0]) throw new UserError('이미 처리된 요청이에요.', { code: 'already_decided' });
    log.info(`쇼케이스 재생목록 요청 #${id} ${approve ? '승인' : '거절'} by ${actor.id}`);
    await auditRepo.add(this.db, {
      actorId: actor.id,
      action: approve ? 'showcase-request.approve' : 'showcase-request.reject',
      targetType: 'showcase-request',
      targetId: id,
      summary:
        `쇼케이스 재생목록 '${req.title ?? req.playlistId}' (${req.itemCount ?? '?'}개) ${approve ? '승인' : '거절'}` +
        (syncHours ? ` · ${syncHours}시간마다 자동 연동` : ''),
      detail: { playlistId: req.playlistId, requestedBy: req.requestedBy.id, syncHours },
    });
    if (approve) {
      const job = this.runImport(req).finally(() => this.running.delete(id));
      this.running.set(id, job);
    } else {
      this.dm(req.requestedBy.id, `🙅 쇼케이스 재생목록 요청이 거절됐어요: **${req.title ?? req.playlistId}**`);
    }
    return req;
  }

  /** 테스트용: 진행 중인 가져오기가 끝날 때까지 기다림 */
  async waitForImports(): Promise<void> {
    await Promise.all([...this.running.values()]);
  }

  /**
   * 재생목록의 영상을 쇼케이스에 넣음. 이미 있는 영상 · 쇼케이스에서 지운 영상 · 비공개 영상은 건너뜀.
   * 처음 가져올 때와 자동 연동 때 같이 씀. 영상은 요청한 사람 이름으로 들어감 (점수도).
   */
  private async insertFromPlaylist(
    api: PlaylistApi,
    req: ShowcaseRequest,
    onPage?: (added: number, skipped: number) => Promise<void>,
  ): Promise<{ added: number; skipped: number }> {
    let added = 0;
    let skipped = 0;
    for await (const page of api.pages(req.playlistId)) {
      for (const it of page) {
        // 비공개 · 삭제된 영상은 건너뜀
        if (!/^[\w-]{11}$/.test(it.videoId) || !it.channelName || !it.title) {
          skipped++;
          continue;
        }
        const rows = await this.db.query<{ id: number }>(
          `INSERT INTO showcases (youtube_id, title, channel_name, channel_url, added_by, request_id, published_at)
           SELECT $1, $2, $3, $4, $5, $6, $7
           WHERE NOT EXISTS (SELECT 1 FROM showcase_removed WHERE youtube_id = $1)
           ON CONFLICT (youtube_id) DO NOTHING RETURNING id`,
          [
            it.videoId,
            it.title.slice(0, 200),
            it.channelName.slice(0, 100),
            it.channelId ? `https://www.youtube.com/channel/${it.channelId}` : null,
            req.requestedBy.id,
            req.id,
            it.publishedAt,
          ],
        );
        if (rows[0]) added++;
        else skipped++;
      }
      await onPage?.(added, skipped);
    }
    return { added, skipped };
  }

  private async runImport(req: ShowcaseRequest): Promise<void> {
    const api = this.opts.playlistApi?.();
    let imported = 0;
    let skipped = 0;
    try {
      if (!api) throw new Error('유튜브 API 키가 없습니다.');
      ({ added: imported, skipped } = await this.insertFromPlaylist(api, req, async (a, s) => {
        imported = a;
        skipped = s;
        await this.db.query('UPDATE showcase_requests SET imported = $2, skipped = $3 WHERE id = $1', [req.id, a, s]);
      }));
      // 처음 가져온 것을 첫 확인으로 침 (자동 연동이면 여기서부터 주기를 셈)
      await this.db.query(`UPDATE showcase_requests SET status = 'done', imported = $2, skipped = $3, synced_at = now() WHERE id = $1`, [
        req.id,
        imported,
        skipped,
      ]);
      log.info(`쇼케이스 재생목록 #${req.id} 가져오기 끝: ${imported}개 (건너뜀 ${skipped}개)`);
      this.dm(
        req.requestedBy.id,
        `✅ 쇼케이스 재생목록을 가져왔어요: **${req.title ?? req.playlistId}** — 영상 ${imported}개 (+${imported * this.opts.pointsPerVideo}점)` +
          (skipped ? `, 건너뜀 ${skipped}개 (이미 있거나 비공개)` : '') +
          `\n${this.opts.siteUrl('#/showcase')}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`쇼케이스 재생목록 #${req.id} 가져오기 실패`, err);
      await this.db
        .query(`UPDATE showcase_requests SET status = 'failed', imported = $2, skipped = $3, error = $4 WHERE id = $1`, [
          req.id,
          imported,
          skipped,
          message.slice(0, 300),
        ])
        .catch(() => undefined);
    }
  }

  // ── 자동 연동 (가져온 재생목록에 새로 올라온 영상) ─────────

  /** 관리자: 가져오기가 끝난 재생목록의 자동 연동 주기를 바꿈 (null = 끄기) */
  async setSync(id: number, hours: number | null, actor: Actor): Promise<ShowcaseRequest> {
    if (!actor.isAdmin) throw new ForbiddenError('관리자만 바꿀 수 있어요.');
    const syncHours = checkSyncHours(hours);
    const before = await this.getRequest(id);
    if (!before) throw new NotFoundError('요청을 찾을 수 없어요.');
    if (before.status !== 'done') throw new UserError('가져오기가 끝난 재생목록만 연동할 수 있어요.', { code: 'not_done' });
    await this.db.query('UPDATE showcase_requests SET sync_hours = $2, sync_error = NULL WHERE id = $1', [id, syncHours]);
    if (before.syncHours !== syncHours) {
      await auditRepo.add(this.db, {
        actorId: actor.id,
        action: 'showcase-request.sync',
        targetType: 'showcase-request',
        targetId: id,
        summary: `쇼케이스 재생목록 '${before.title ?? before.playlistId}' 자동 연동 ${syncHours ? `${syncHours}시간마다` : '끔'}`,
        detail: { playlistId: before.playlistId, from: before.syncHours, to: syncHours },
      });
    }
    return (await this.getRequest(id))!;
  }

  /** 재생목록 하나를 지금 확인해서 새 영상을 넣음 */
  async syncNow(id: number, actor?: Actor): Promise<{ request: ShowcaseRequest; added: number }> {
    if (actor && !actor.isAdmin) throw new ForbiddenError('관리자만 할 수 있어요.');
    const req = await this.getRequest(id);
    if (!req) throw new NotFoundError('요청을 찾을 수 없어요.');
    if (req.status !== 'done') throw new UserError('가져오기가 끝난 재생목록만 확인할 수 있어요.', { code: 'not_done' });
    const api = this.opts.playlistApi?.();
    if (!api) throw new UserError('유튜브 API 키가 없어서 재생목록을 확인할 수 없어요.', { code: 'playlist_disabled' });
    if (this.syncing.has(id)) throw new UserError('지금 확인하는 중이에요. 잠시 후 다시 봐 주세요.', { code: 'sync_running' });
    this.syncing.add(id);
    try {
      const { added } = await this.insertFromPlaylist(api, req);
      await this.db.query('UPDATE showcase_requests SET synced_at = now(), sync_added = sync_added + $2, sync_error = NULL WHERE id = $1', [
        id,
        added,
      ]);
      if (added) log.info(`쇼케이스 재생목록 #${id} 자동 연동: 새 영상 ${added}개`);
      return { request: (await this.getRequest(id))!, added };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`쇼케이스 재생목록 #${id} 자동 연동 실패: ${message}`);
      // 실패해도 확인한 시각은 남김 (다음 주기까지 다시 묻지 않도록)
      await this.db
        .query('UPDATE showcase_requests SET synced_at = now(), sync_error = $2 WHERE id = $1', [id, message.slice(0, 300)])
        .catch(() => undefined);
      throw new UserError(`재생목록을 확인하지 못했어요: ${message.slice(0, 200)}`, { code: 'sync_failed', status: 502 });
    } finally {
      this.syncing.delete(id);
    }
  }

  /** 주기가 된 연동 재생목록을 확인 (타이머가 부름). 새로 들어온 영상 수를 돌려줌 */
  async syncDue(): Promise<number> {
    if (!this.opts.playlistApi?.()) return 0;
    const due = await this.db.query<{ id: number }>(
      `SELECT id FROM showcase_requests
       WHERE sync_hours IS NOT NULL AND status = 'done'
         AND (synced_at IS NULL OR synced_at + sync_hours * interval '1 hour' <= now())
       ORDER BY synced_at NULLS FIRST LIMIT 10`,
    );
    let added = 0;
    for (const { id } of due) {
      try {
        added += (await this.syncNow(Number(id))).added;
      } catch {
        /* syncNow 가 기록해 둠 */
      }
    }
    return added;
  }

  /** 10분마다 주기가 된 재생목록이 있는지 봄 (서버를 켤 때 index.ts 에서) */
  startSync(everyMs = 10 * 60_000): void {
    if (this.syncTimer) return;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        await this.syncDue();
      } catch (err) {
        log.warn('쇼케이스 자동 연동 확인 실패', err);
      } finally {
        busy = false;
      }
    };
    this.syncTimer = setInterval(() => void tick(), everyMs);
    this.syncTimer.unref?.();
    setTimeout(() => void tick(), 90_000).unref?.();
  }

  stopSync(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
  }

  private dm(userId: string, content: string): void {
    const n = this.opts.notifier?.();
    n?.notifyUser?.(userId, content).catch(() => undefined);
  }

  // ── 외부 노출 ───────────────────────────────────────────

  toPublic(s: Showcase) {
    return {
      ...s,
      url: `https://www.youtube.com/watch?v=${s.youtubeId}`,
      thumbUrl: `https://i.ytimg.com/vi/${s.youtubeId}/hqdefault.jpg`,
      siteUrl: this.opts.siteUrl(`#/showcase/${s.id}`),
    };
  }
}
