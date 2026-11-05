import type { Db } from '../db/index.js';
import { kvRepo } from '../repos/kv.js';
import { UserError } from '../util/errors.js';
import { logger } from '../util/log.js';
import { type PlaylistApi, youtubePlaylistApi } from './showcase.js';

const log = logger('youtube-key');
const KV_KEY = 'youtube:apiKey';

interface Saved {
  key: string;
  updatedBy: string;
  updatedAt: string;
}

export interface YoutubeKeyStatus {
  /** 지금 쓰는 키가 있는지 */
  set: boolean;
  /** site: 사이트 관리자 화면에서 넣은 키, env: 서버 .env 의 YOUTUBE_API_KEY */
  source: 'site' | 'env' | null;
  /** 키의 마지막 4글자 (전체 키는 절대 돌려주지 않음) */
  last4: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** 키가 실제로 유튜브 Data API 에서 통하는지 확인. 안 되면 이유를 담아 던짐 */
export type YoutubeKeyCheck = (key: string) => Promise<void>;

export const checkYoutubeKey: YoutubeKeyCheck = async (key) => {
  const qs = new URLSearchParams({ part: 'id', id: 'dQw4w9WgXcQ', key });
  let res: Response;
  try {
    res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${qs}`, { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new UserError('유튜브에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.', { status: 503, code: 'youtube_unavailable' });
  }
  if (res.ok) return;
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  const why = body?.error?.message ?? `HTTP ${res.status}`;
  throw new UserError(`이 키로는 유튜브 API 를 쓸 수 없어요: ${why}`, { code: 'youtube_key_invalid' });
};

/**
 * 쇼케이스 재생목록 가져오기에 쓰는 유튜브 API 키.
 * 관리자가 사이트에서 넣은 키(DB)를 먼저 쓰고, 없으면 서버 .env 의 YOUTUBE_API_KEY 를 씁니다.
 */
export class YoutubeKeyStore {
  private saved: Saved | null = null;
  private cached: { key: string; api: PlaylistApi } | null = null;

  constructor(
    private readonly db: Db,
    private readonly envKey: string | undefined,
    private readonly opts: { make?: (key: string) => PlaylistApi; check?: YoutubeKeyCheck } = {},
  ) {}

  async load(): Promise<void> {
    this.saved = await kvRepo.get<Saved>(this.db, KV_KEY);
  }

  private current(): string | null {
    return this.saved?.key || this.envKey || null;
  }

  api(): PlaylistApi | null {
    const key = this.current();
    if (!key) return null;
    if (this.cached?.key !== key) this.cached = { key, api: (this.opts.make ?? youtubePlaylistApi)(key) };
    return this.cached.api;
  }

  status(): YoutubeKeyStatus {
    const key = this.current();
    const source = this.saved?.key ? 'site' : this.envKey ? 'env' : null;
    return {
      set: !!key,
      source,
      last4: key ? key.slice(-4) : null,
      updatedBy: source === 'site' ? this.saved!.updatedBy : null,
      updatedAt: source === 'site' ? this.saved!.updatedAt : null,
    };
  }

  async set(raw: unknown, actorId: string): Promise<YoutubeKeyStatus> {
    const key = String(raw ?? '').trim();
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(key)) throw new UserError('API 키 모양이 아니에요. Google Cloud 에서 복사한 키를 그대로 붙여 넣어 주세요.', { code: 'youtube_key_format' });
    await (this.opts.check ?? checkYoutubeKey)(key);
    const saved: Saved = { key, updatedBy: actorId, updatedAt: new Date().toISOString() };
    await kvRepo.set(this.db, KV_KEY, saved);
    this.saved = saved;
    log.info(`유튜브 API 키를 바꿨습니다 (…${key.slice(-4)}) by ${actorId}`);
    return this.status();
  }

  async clear(actorId: string): Promise<YoutubeKeyStatus> {
    await this.db.query('DELETE FROM kv WHERE key = $1', [KV_KEY]);
    this.saved = null;
    log.info(`사이트에서 넣은 유튜브 API 키를 지웠습니다 by ${actorId}`);
    return this.status();
  }
}
