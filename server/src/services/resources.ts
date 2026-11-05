import crypto from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import type { OriginalFile } from '../archive/types.js';
import type { Config } from '../config.js';
import { normalizeTagName, TAG_NAME_RE } from '../constants.js';
import type { Db, Queryable } from '../db/index.js';
import { usersRepo } from '../repos/users.js';
import type { PreviewStorage } from '../storage/types.js';
import type { Actor, Creator, UserInfo } from '../types.js';
import { ForbiddenError, NotFoundError, ServiceUnavailableError, UserError } from '../util/errors.js';
import { logger } from '../util/log.js';
import { auditRepo } from '../repos/audit.js';
import { normalizeCreators, splitCreatorNames } from './references.js';

const log = logger('resources');

/** 에셋 · 플러그인 · 텍스쳐팩 (탭마다 태그가 따로) */
export const RESOURCE_KINDS = {
  asset: { label: '에셋', labelEn: 'Assets', singular: '에셋', emoji: '🧩' },
  plugin: { label: '플러그인', labelEn: 'Plugins', singular: '플러그인', emoji: '🔌' },
  texturepack: { label: '텍스쳐팩', labelEn: 'Texture packs', singular: '텍스쳐팩', emoji: '🎨' },
} as const;
export type ResourceKind = keyof typeof RESOURCE_KINDS;
export const RESOURCE_KIND_KEYS = Object.keys(RESOURCE_KINDS) as ResourceKind[];

export function isResourceKind(v: unknown): v is ResourceKind {
  return typeof v === 'string' && v in RESOURCE_KINDS;
}

export const RESOURCE_LIMITS = { title: 100, description: 2000, images: 6, imageBytes: 10 * 1024 * 1024, videos: 5, tags: 12 };

export type ResourceMedia = { type: 'image'; key: string; width: number; height: number } | { type: 'youtube'; id: string };

export interface Resource {
  id: number;
  kind: ResourceKind;
  title: string;
  description: string;
  creators: Creator[];
  uploaderId: string;
  uploaderName: string | null;
  uploaderAvatar: string | null;
  file: { name: string; mime: string | null; size: number } | null;
  archiveChannelId: string | null;
  archiveMessageId: string | null;
  linkUrl: string | null;
  previewKey: string | null;
  previewWidth: number | null;
  previewHeight: number | null;
  media: ResourceMedia[];
  downloads: number;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ResourceUpload {
  buffer: Buffer;
  filename: string;
  contentType?: string | null;
}

/** 파일 보관소 (디스코드 채널, 테스트할 때는 로컬 폴더) */
export interface ResourceFileStore {
  readonly kind: 'discord' | 'local';
  isAvailable(): boolean;
  store(res: Resource, file: { buffer: Buffer; filename: string; contentType: string }): Promise<{ channelId: string; messageId: string }>;
  fetch(res: Resource): Promise<OriginalFile | null>;
  remove(res: Resource): Promise<void>;
}

export interface CreateResourceInput {
  kind: ResourceKind;
  title?: string | null;
  description?: string | null;
  /** "A, B" (비워도 됨) */
  creators?: string | null;
  tags?: string[];
  file?: ResourceUpload | null;
  images?: ResourceUpload[];
  /** 유튜브 주소 여러 개 (줄바꿈 / 쉼표) */
  youtube?: string | null;
  linkUrl?: string | null;
  uploader: UserInfo;
}

type Row = Record<string, any>;

function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

const SELECT = `
  SELECT r.*, u.username AS uploader_username, u.display_name AS uploader_display_name, u.avatar_url AS uploader_avatar,
    COALESCE((SELECT json_agg(t.name ORDER BY t.name) FROM resource_tag_links l JOIN resource_tags t ON t.id = l.tag_id WHERE l.resource_id = r.id), '[]'::json) AS tag_names
  FROM resources r LEFT JOIN users u ON u.discord_id = r.uploader_id`;

function mapRow(r: Row): Resource {
  return {
    id: Number(r.id),
    kind: r.kind,
    title: r.title,
    description: r.description ?? '',
    creators: json(r.creators, []),
    uploaderId: r.uploader_id,
    uploaderName: r.uploader_display_name ?? r.uploader_username ?? null,
    uploaderAvatar: r.uploader_avatar ?? null,
    file: r.file_name ? { name: r.file_name, mime: r.file_mime ?? null, size: Number(r.file_size ?? 0) } : null,
    archiveChannelId: r.archive_channel_id ?? null,
    archiveMessageId: r.archive_message_id ?? null,
    linkUrl: r.link_url ?? null,
    previewKey: r.preview_key ?? null,
    previewWidth: r.preview_width === null ? null : Number(r.preview_width),
    previewHeight: r.preview_height === null ? null : Number(r.preview_height),
    media: json(r.media, []),
    downloads: Number(r.downloads ?? 0),
    tags: json(r.tag_names, []),
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

function clean(v: string | null | undefined, max: number): string {
  return (v ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
}

/** 유튜브 주소에서 영상 ID 만 뽑기 (youtu.be/…, watch?v=…, shorts/…, embed/…, ID 그대로) */
export function youtubeId(raw: string): string | null {
  const s = raw.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'music.youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = /^\/(?:shorts|embed|live|v)\/([\w-]{11})/.exec(u.pathname);
      id = m?.[1] ?? null;
    }
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

/**
 * 에셋 · 플러그인 · 텍스쳐팩.
 * 파일은 디스코드 채널에 보관(또는 외부 링크), 미리보기 사진은 미리보기 저장소에, 유튜브는 ID 만 저장.
 * 제작자는 비워도 되고, 올린 사람은 종류별 점수를 받습니다.
 */
export class ResourceService {
  constructor(
    private readonly db: Db,
    private readonly storage: PreviewStorage,
    private store: ResourceFileStore,
    private readonly config: Config,
  ) {}

  setStore(store: ResourceFileStore): void {
    this.store = store;
  }

  get storeAvailable(): boolean {
    return this.store.isAvailable();
  }

  canEdit(res: Resource, actor: Actor): boolean {
    return actor.isAdmin || res.uploaderId === actor.id;
  }

  // ── 태그 (종류마다 따로) ──────────────────────────────────

  async listTags(kind: ResourceKind): Promise<{ name: string; description: string | null; count: number }[]> {
    const rows = await this.db.query<Row>(
      `SELECT t.name, t.description, count(l.resource_id)::int AS n
       FROM resource_tags t LEFT JOIN resource_tag_links l ON l.tag_id = t.id
       WHERE t.kind = $1 GROUP BY t.id ORDER BY t.id`,
      [kind],
    );
    return rows.map((r) => ({ name: r.name, description: r.description ?? null, count: Number(r.n) }));
  }

  private validTagName(raw: string): string {
    const name = normalizeTagName(raw);
    if (!TAG_NAME_RE.test(name)) {
      throw new UserError('태그 이름은 영문 소문자/숫자/한글로 시작하고, 기호는 / + . _ - 만 쓸 수 있습니다 (최대 40자).');
    }
    return name;
  }

  async addTag(kind: ResourceKind, raw: string, description: string | null, actor: Actor) {
    if (!actor.isAdmin) throw new ForbiddenError('관리자만 태그를 만들 수 있어요.');
    const name = this.validTagName(raw);
    const rows = await this.db.query(
      `INSERT INTO resource_tags (kind, name, description, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT (kind, name) DO NOTHING RETURNING id`,
      [kind, name, description?.trim() || null, actor.id],
    );
    if (!rows.length) throw new UserError(`\`${name}\` 태그는 이미 있어요.`);
    await auditRepo.add(this.db, { actorId: actor.id, action: 'resource-tag.add', targetType: 'resource-tag', targetId: `${kind}:${name}`, summary: `${RESOURCE_KINDS[kind].label} 태그 '${name}' 추가` });
    return { name };
  }

  async renameTag(kind: ResourceKind, fromRaw: string, toRaw: string, actor: Actor) {
    if (!actor.isAdmin) throw new ForbiddenError('관리자만 태그 이름을 바꿀 수 있어요.');
    const from = normalizeTagName(fromRaw);
    const to = this.validTagName(toRaw);
    if (from === to) throw new UserError('새 이름이 지금 이름과 같아요.');
    const exists = await this.db.query('SELECT 1 FROM resource_tags WHERE kind = $1 AND name = $2', [kind, to]);
    if (exists.length) throw new UserError(`\`${to}\` 태그가 이미 있어요.`);
    const rows = await this.db.query<{ id: number }>('UPDATE resource_tags SET name = $3 WHERE kind = $1 AND name = $2 RETURNING id', [kind, from, to]);
    if (!rows.length) throw new NotFoundError(`\`${from}\` 태그가 없어요.`);
    const n = await this.db.query<{ n: number }>('SELECT count(*)::int AS n FROM resource_tag_links WHERE tag_id = $1', [rows[0].id]);
    await auditRepo.add(this.db, { actorId: actor.id, action: 'resource-tag.rename', targetType: 'resource-tag', targetId: `${kind}:${to}`, summary: `${RESOURCE_KINDS[kind].label} 태그 '${from}' → '${to}'` });
    return { from, to, count: Number(n[0]?.n ?? 0) };
  }

  async removeTag(kind: ResourceKind, raw: string, actor: Actor) {
    if (!actor.isAdmin) throw new ForbiddenError('관리자만 태그를 지울 수 있어요.');
    const name = normalizeTagName(raw);
    const rows = await this.db.query('DELETE FROM resource_tags WHERE kind = $1 AND name = $2 RETURNING id', [kind, name]);
    if (!rows.length) throw new NotFoundError(`\`${name}\` 태그가 없어요.`);
    await auditRepo.add(this.db, { actorId: actor.id, action: 'resource-tag.remove', targetType: 'resource-tag', targetId: `${kind}:${name}`, summary: `${RESOURCE_KINDS[kind].label} 태그 '${name}' 삭제` });
  }

  private async resolveTags(q: Queryable, kind: ResourceKind, names: string[]): Promise<number[]> {
    const normalized = [...new Set(names.map(normalizeTagName).filter(Boolean))];
    if (normalized.length > RESOURCE_LIMITS.tags) throw new UserError(`태그는 최대 ${RESOURCE_LIMITS.tags}개까지 달 수 있어요.`);
    if (!normalized.length) return [];
    const rows = await q.query<{ id: number; name: string }>('SELECT id, name FROM resource_tags WHERE kind = $1 AND name = ANY($2::text[])', [
      kind,
      normalized,
    ]);
    const missing = normalized.filter((n) => !rows.some((r) => r.name === n));
    if (missing.length) throw new UserError(`없는 태그예요: ${missing.map((m) => `\`${m}\``).join(', ')}`, { code: 'unknown_tag' });
    return rows.map((r) => Number(r.id));
  }

  // ── 올리기 ──────────────────────────────────────────────

  private async previewOf(buffer: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
    const out = await sharp(buffer, { failOn: 'none', animated: false, limitInputPixels: 268_402_689 })
      .rotate()
      .resize({ width: this.config.upload.previewMaxSize, height: this.config.upload.previewMaxSize, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: this.config.upload.previewQuality })
      .toBuffer({ resolveWithObject: true });
    return { data: out.data, width: out.info.width, height: out.info.height };
  }

  private async savePreview(buffer: Buffer): Promise<ResourceMedia & { type: 'image' }> {
    let img;
    try {
      img = await this.previewOf(buffer);
    } catch {
      throw new UserError('미리보기 사진을 읽지 못했어요. PNG / JPG / WEBP 이미지를 올려 주세요.');
    }
    const now = new Date();
    const key = `resources/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.webp`;
    await this.storage.put(key, img.data, 'image/webp');
    return { type: 'image', key, width: img.width, height: img.height };
  }

  async create(input: CreateResourceInput): Promise<Resource> {
    if (!isResourceKind(input.kind)) throw new UserError('종류를 골라 주세요.');
    const kind = input.kind;
    const file = input.file?.buffer?.length ? input.file : null;
    const linkUrl = clean(input.linkUrl, 500) || null;
    if (linkUrl && !/^https?:\/\/[^\s]+$/i.test(linkUrl)) throw new UserError('링크는 http:// 또는 https:// 로 시작해야 해요.');
    if (!file && !linkUrl) throw new UserError('올릴 파일을 고르거나 다운로드 링크를 적어 주세요.');
    if (file && file.buffer.length > this.config.upload.resourceMaxBytes) {
      throw new UserError(`파일이 너무 커요. 최대 ${Math.round(this.config.upload.resourceMaxBytes / 1024 / 1024)}MB 까지 올릴 수 있어요. 더 크면 다운로드 링크로 올려 주세요.`, {
        code: 'too_large',
      });
    }
    if (file && !this.store.isAvailable()) throw new ServiceUnavailableError();
    const images = (input.images ?? []).filter((i) => i.buffer?.length);
    if (images.length > RESOURCE_LIMITS.images) throw new UserError(`미리보기 사진은 최대 ${RESOURCE_LIMITS.images}장까지예요.`);
    if (images.some((i) => i.buffer.length > RESOURCE_LIMITS.imageBytes)) throw new UserError('미리보기 사진은 한 장에 10MB 까지예요.');
    const videos = [
      ...new Set(
        (input.youtube ?? '')
          .split(/[\s,]+/)
          .filter(Boolean)
          .map((s) => {
            const id = youtubeId(s);
            if (!id) throw new UserError(`유튜브 주소를 알아볼 수 없어요: ${s.slice(0, 80)}`);
            return id;
          }),
      ),
    ];
    if (videos.length > RESOURCE_LIMITS.videos) throw new UserError(`유튜브 영상은 최대 ${RESOURCE_LIMITS.videos}개까지예요.`);

    const fileBase = file ? path.basename(file.filename).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() : '';
    const title = clean(input.title, RESOURCE_LIMITS.title) || fileBase || '제목 없음';
    const description = (input.description ?? '').replace(/\r\n/g, '\n').trim().slice(0, RESOURCE_LIMITS.description);
    const creators: Creator[] = splitCreatorNames(input.creators).length ? normalizeCreators([{ name: input.creators }]) : [];

    // 미리보기: 올린 사진들, 사진이 없고 파일이 이미지면 그 파일
    const media: ResourceMedia[] = [];
    const saved: string[] = [];
    try {
      for (const img of images) {
        const m = await this.savePreview(img.buffer);
        saved.push(m.key);
        media.push(m);
      }
      if (!images.length && file && IMAGE_EXT.has(path.extname(file.filename).toLowerCase())) {
        const m = await this.savePreview(file.buffer).catch(() => null);
        if (m) {
          saved.push(m.key);
          media.push(m);
        }
      }
    } catch (err) {
      await Promise.all(saved.map((k) => this.storage.delete(k).catch(() => undefined)));
      throw err;
    }
    for (const id of videos) media.push({ type: 'youtube', id });
    const cover = media.find((m): m is ResourceMedia & { type: 'image' } => m.type === 'image') ?? null;

    let id: number;
    try {
      id = await this.db.tx(async (q) => {
        await usersRepo.upsert(q, input.uploader);
        const tagIds = await this.resolveTags(q, kind, input.tags ?? []);
        const rows = await q.query<{ id: number }>(
          `INSERT INTO resources (kind, title, description, creators, creator_name, uploader_id, file_name, file_mime, file_size,
             link_url, preview_key, preview_width, preview_height, media)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb) RETURNING id`,
          [
            kind,
            title,
            description,
            JSON.stringify(creators),
            creators.map((c) => c.name).join(', '),
            input.uploader.id,
            file ? path.basename(file.filename) : null,
            file ? (file.contentType ?? null) : null,
            file ? file.buffer.length : null,
            linkUrl,
            cover?.key ?? null,
            cover?.width ?? null,
            cover?.height ?? null,
            JSON.stringify(media),
          ],
        );
        const newId = Number(rows[0].id);
        for (const t of tagIds) await q.query('INSERT INTO resource_tag_links (resource_id, tag_id) VALUES ($1, $2)', [newId, t]);
        return newId;
      });
    } catch (err) {
      await Promise.all(saved.map((k) => this.storage.delete(k).catch(() => undefined)));
      throw err;
    }

    if (file) {
      const res = (await this.get(id))!;
      try {
        const stored = await this.store.store(res, {
          buffer: file.buffer,
          filename: path.basename(file.filename),
          contentType: file.contentType || 'application/octet-stream',
        });
        await this.db.query('UPDATE resources SET archive_channel_id = $2, archive_message_id = $3 WHERE id = $1', [id, stored.channelId, stored.messageId]);
      } catch (err) {
        log.error(`${kind} #${id} 파일 보관 실패 — 등록을 취소합니다.`, err);
        await this.db.query('DELETE FROM resources WHERE id = $1', [id]).catch(() => undefined);
        await Promise.all(saved.map((k) => this.storage.delete(k).catch(() => undefined)));
        throw new UserError('파일을 디스코드에 보관하지 못했어요. 봇 권한(메시지 보내기 / 파일 첨부)이나 파일 크기를 확인해 주세요.', {
          status: 502,
          code: 'archive_failed',
        });
      }
    }
    log.info(`${kind} #${id} 등록: ${title} by ${input.uploader.username}`);
    return (await this.get(id))!;
  }

  // ── 조회 ────────────────────────────────────────────────

  async get(id: number): Promise<Resource | null> {
    const rows = await this.db.query<Row>(`${SELECT} WHERE r.id = $1`, [id]);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async require(id: number): Promise<Resource> {
    const r = await this.get(id);
    if (!r) throw new NotFoundError(`#${id} 을(를) 찾을 수 없어요.`);
    return r;
  }

  async list(opts: {
    kind?: ResourceKind;
    q?: string;
    tags?: string[];
    uploaderId?: string;
    sort?: 'newest' | 'downloads';
    limit?: number;
    offset?: number;
  }): Promise<{ items: Resource[]; total: number }> {
    const where: string[] = [];
    const values: unknown[] = [];
    const add = (v: unknown) => {
      values.push(v);
      return `$${values.length}`;
    };
    if (opts.kind) where.push(`r.kind = ${add(opts.kind)}`);
    if (opts.uploaderId) where.push(`r.uploader_id = ${add(opts.uploaderId)}`);
    for (const word of (opts.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 8)) {
      const like = add(`%${word.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
      const idMatch = /^#?(\d{1,9})$/.exec(word);
      where.push(
        `(r.title ILIKE ${like} OR r.description ILIKE ${like} OR r.creator_name ILIKE ${like}` +
          ` OR EXISTS (SELECT 1 FROM resource_tag_links l JOIN resource_tags t ON t.id = l.tag_id WHERE l.resource_id = r.id AND t.name ILIKE ${like})` +
          `${idMatch ? ` OR r.id = ${add(Number(idMatch[1]))}` : ''})`,
      );
    }
    const tags = [...new Set((opts.tags ?? []).map(normalizeTagName).filter(Boolean))];
    if (tags.length) {
      where.push(`r.id IN (SELECT l.resource_id FROM resource_tag_links l JOIN resource_tags t ON t.id = l.tag_id
        WHERE t.name = ANY(${add(tags)}::text[]) GROUP BY l.resource_id HAVING count(DISTINCT t.name) = ${add(tags.length)})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM resources r ${whereSql}`, values))[0]?.n ?? 0);
    if (!total) return { items: [], total };
    const order = opts.sort === 'downloads' ? 'r.downloads DESC, r.id DESC' : 'r.created_at DESC, r.id DESC';
    const limit = Math.min(Math.max(opts.limit ?? 24, 1), 60);
    const rows = await this.db.query<Row>(
      `${SELECT} ${whereSql} ORDER BY ${order} LIMIT ${add(limit)} OFFSET ${add(Math.max(opts.offset ?? 0, 0))}`,
      values,
    );
    return { items: rows.map(mapRow), total };
  }

  async counts(): Promise<Record<ResourceKind, number>> {
    const rows = await this.db.query<{ kind: ResourceKind; n: number }>('SELECT kind, count(*)::int AS n FROM resources GROUP BY kind');
    const out = { asset: 0, plugin: 0, texturepack: 0 } as Record<ResourceKind, number>;
    for (const r of rows) out[r.kind] = Number(r.n);
    return out;
  }

  /** 파일 받기 (디스코드에서 가져옴). 받은 횟수도 올림 */
  async fetchFile(res: Resource): Promise<OriginalFile> {
    if (!res.file) throw new NotFoundError('이 항목은 파일 대신 다운로드 링크로 올라와 있어요.');
    if (!this.store.isAvailable()) throw new ServiceUnavailableError();
    const file = await this.store.fetch(res);
    if (!file) throw new NotFoundError('파일을 찾을 수 없어요. 보관 메시지가 지워졌을 수 있어요.');
    await this.db.query('UPDATE resources SET downloads = downloads + 1 WHERE id = $1', [res.id]);
    return file;
  }

  async delete(id: number, actor: Actor): Promise<Resource> {
    const res = await this.require(id);
    if (!this.canEdit(res, actor)) throw new ForbiddenError('올린 사람이나 관리자만 지울 수 있어요.');
    await this.db.query('DELETE FROM resources WHERE id = $1', [id]);
    if (res.file) await this.store.remove(res).catch((err) => log.warn(`#${id} 보관 메시지 삭제 실패`, err));
    for (const m of res.media) if (m.type === 'image') await this.storage.delete(m.key).catch(() => undefined);
    log.info(`${res.kind} #${id} 삭제 by ${actor.id}`);
    if (actor.id !== res.uploaderId) {
      await auditRepo.add(this.db, {
        actorId: actor.id,
        action: 'resource.delete',
        targetType: 'resource',
        targetId: id,
        summary: `다른 사람의 ${RESOURCE_KINDS[res.kind].label} #${id} '${res.title}' 삭제`,
        detail: { uploaderId: res.uploaderId, kind: res.kind },
      });
    }
    return res;
  }

  // ── 내보내기 ────────────────────────────────────────────

  imageUrl(key: string): string {
    return this.storage.publicUrl(key) ?? `${this.config.publicBaseUrl}/api/previews/${key}`;
  }

  siteUrl(res: Pick<Resource, 'id'>): string {
    return `${this.config.publicBaseUrl}/#/res/${res.id}`;
  }

  toPublic(res: Resource) {
    const youtubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    const firstVideo = res.media.find((m) => m.type === 'youtube');
    const preview = res.previewKey
      ? { url: this.imageUrl(res.previewKey), width: res.previewWidth ?? 16, height: res.previewHeight ?? 9 }
      : firstVideo && firstVideo.type === 'youtube'
        ? { url: youtubeThumb(firstVideo.id), width: 480, height: 360 }
        : null;
    return {
      id: res.id,
      kind: res.kind,
      kindLabel: RESOURCE_KINDS[res.kind].label,
      title: res.title,
      description: res.description,
      creators: res.creators,
      uploader: { id: res.uploaderId, name: res.uploaderName, avatarUrl: res.uploaderAvatar },
      file: res.file,
      linkUrl: res.linkUrl,
      preview,
      media: res.media.map((m) =>
        m.type === 'image'
          ? { type: 'image' as const, url: this.imageUrl(m.key), width: m.width, height: m.height }
          : { type: 'youtube' as const, id: m.id, thumbUrl: youtubeThumb(m.id) },
      ),
      tags: res.tags,
      downloads: res.downloads,
      siteUrl: this.siteUrl(res),
      createdAt: res.createdAt.toISOString(),
    };
  }
}
