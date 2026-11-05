import type { Db } from '../db/index.js';
import { tagGroupOf } from '../constants.js';
import { tagsRepo } from '../repos/tags.js';
import { usersRepo } from '../repos/users.js';
import type { Actor, UserInfo } from '../types.js';
import { ForbiddenError, NotFoundError, UserError } from '../util/errors.js';
import { logger } from '../util/log.js';
import type { ReferenceService } from './references.js';
import { youtubeId } from './resources.js';

const log = logger('videos');

/** 제작과정 영상이 붙은 레퍼런스에 자동으로 붙는 태그 */
export const SPEEDART_TAG = 'speedart';
export const VIDEO_LIMITS = { perRef: 3 };

export interface RefVideo {
  id: number;
  refId: number;
  youtubeId: string;
  title: string | null;
  addedBy: { id: string; name: string | null; avatarUrl: string | null };
  createdAt: string;
}

type Row = Record<string, any>;

function mapRow(r: Row): RefVideo {
  return {
    id: Number(r.id),
    refId: Number(r.ref_id),
    youtubeId: r.youtube_id,
    title: r.title ?? null,
    addedBy: { id: r.added_by, name: r.display_name ?? r.username ?? null, avatarUrl: r.avatar_url ?? null },
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/** 유튜브에 실제로 있는 공개 영상인지 확인하고 제목을 받아옴 (네트워크 문제면 확인 없이 통과) */
export type VideoLookup = (id: string) => Promise<{ ok: true; title: string | null } | { ok: false }>;

export const youtubeLookup: VideoLookup = async (id) => {
  try {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) return { ok: false };
    if (!res.ok) return { ok: true, title: null };
    const data = (await res.json()) as { title?: string };
    return { ok: true, title: data.title?.slice(0, 200) ?? null };
  } catch {
    return { ok: true, title: null };
  }
};

/**
 * 레퍼런스 제작과정(스피드아트) 영상.
 * 서버 멤버 누구나 남이 올린 레퍼런스에도 붙일 수 있고(한 사람당 한 레퍼런스에 하나, 레퍼런스마다 최대 3개),
 * 붙인 사람은 영상 점수를 받습니다. 영상이 하나라도 있으면 speedart 태그가 자동으로 붙고, 다 지우면 빠집니다.
 */
export class VideoService {
  constructor(
    private readonly db: Db,
    private readonly refs: ReferenceService,
    private readonly lookup: VideoLookup = youtubeLookup,
  ) {}

  async list(refId: number): Promise<RefVideo[]> {
    const rows = await this.db.query<Row>(
      `SELECT v.*, u.username, u.display_name, u.avatar_url FROM ref_videos v LEFT JOIN users u ON u.discord_id = v.added_by
       WHERE v.ref_id = $1 ORDER BY v.created_at, v.id`,
      [refId],
    );
    return rows.map(mapRow);
  }

  private speedartTagId(category: string): Promise<number> {
    return tagsRepo.ensure(this.db, tagGroupOf(category), SPEEDART_TAG, '제작과정(스피드아트) 영상이 붙어 있음');
  }

  async add(refId: number, url: unknown, user: UserInfo): Promise<RefVideo> {
    const ref = await this.refs.require(refId);
    const id = youtubeId(String(url ?? ''));
    if (!id) throw new UserError('유튜브 영상 주소를 알아볼 수 없어요. (예: https://youtu.be/…)', { code: 'bad_url' });
    const existing = await this.list(refId);
    if (existing.some((v) => v.youtubeId === id)) throw new UserError('이미 붙어 있는 영상이에요.', { code: 'duplicate_video' });
    if (existing.some((v) => v.addedBy.id === user.id)) {
      throw new UserError('이 레퍼런스에는 이미 영상을 하나 붙였어요. 바꾸려면 먼저 붙인 영상을 지워 주세요.', { code: 'one_per_user' });
    }
    if (existing.length >= VIDEO_LIMITS.perRef) throw new UserError(`영상은 레퍼런스마다 ${VIDEO_LIMITS.perRef}개까지 붙일 수 있어요.`, { code: 'too_many' });
    const found = await this.lookup(id);
    if (!found.ok) throw new UserError('유튜브에서 영상을 찾을 수 없어요. 공개(또는 일부 공개) 영상인지 확인해 주세요.', { code: 'video_not_found' });

    const tagId = await this.speedartTagId(ref.category);
    const videoId = await this.db.tx(async (q) => {
      await usersRepo.upsert(q, user);
      const rows = await q.query<{ id: number }>('INSERT INTO ref_videos (ref_id, youtube_id, title, added_by) VALUES ($1, $2, $3, $4) RETURNING id', [
        refId,
        id,
        found.title,
        user.id,
      ]);
      await q.query('INSERT INTO ref_tags (ref_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [refId, tagId]);
      return Number(rows[0].id);
    });
    log.info(`#${refId} 제작과정 영상 ${id} by ${user.username}`);
    if (!ref.tags.includes(SPEEDART_TAG)) this.refs.refreshArchives([refId]);
    return (await this.list(refId)).find((v) => v.id === videoId)!;
  }

  /** 붙인 사람, 레퍼런스 올린 사람, 관리자가 지울 수 있음. 영상이 다 빠지면 speedart 태그도 뺌 */
  async remove(refId: number, videoId: number, actor: Actor): Promise<void> {
    const ref = await this.refs.require(refId);
    const video = (await this.list(refId)).find((v) => v.id === videoId);
    if (!video) throw new NotFoundError('영상을 찾을 수 없어요.');
    if (!actor.isAdmin && actor.id !== video.addedBy.id && actor.id !== ref.uploaderId) {
      throw new ForbiddenError('영상을 붙인 사람, 레퍼런스를 올린 사람, 관리자만 지울 수 있어요.');
    }
    let tagRemoved = false;
    await this.db.tx(async (q) => {
      await q.query('DELETE FROM ref_videos WHERE id = $1', [videoId]);
      const left = await q.query<{ n: number }>('SELECT count(*)::int AS n FROM ref_videos WHERE ref_id = $1', [refId]);
      if (Number(left[0]?.n ?? 0) === 0) {
        const rows = await q.query(
          'DELETE FROM ref_tags WHERE ref_id = $1 AND tag_id IN (SELECT id FROM tags WHERE name = $2) RETURNING ref_id',
          [refId, SPEEDART_TAG],
        );
        tagRemoved = rows.length > 0;
      }
    });
    log.info(`#${refId} 제작과정 영상 ${video.youtubeId} 삭제 by ${actor.id}`);
    if (tagRemoved) this.refs.refreshArchives([refId]);
  }
}
