import crypto from 'node:crypto';
import path from 'node:path';
import type { OriginalArchive, OriginalFile } from '../archive/types.js';
import { type Config, normalizeEmoji } from '../config.js';
import { CATEGORIES, type Category, type ColorFamily, isCategory, normalizeTagName, type PopularPeriod, periodSince } from '../constants.js';
import type { Db } from '../db/index.js';
import { reactionsRepo } from '../repos/reactions.js';
import { refsRepo, type SearchOptions } from '../repos/references.js';
import { tagsRepo } from '../repos/tags.js';
import { usersRepo } from '../repos/users.js';
import type { PreviewStorage } from '../storage/types.js';
import type { Actor, PublicReference, Reference, UserInfo } from '../types.js';
import { ForbiddenError, NotFoundError, UserError } from '../util/errors.js';
import { logger } from '../util/log.js';
import { colorSimilarity, hexMatchScore, hexToLab, type PaletteColor } from './color.js';
import { hammingDistance, processImage } from './image.js';

const log = logger('refs');

export const LIMITS = {
  title: 100,
  mapName: 100,
  creatorName: 64,
  tagsPerRef: 12,
};

export interface UploadFile {
  buffer: Buffer;
  filename: string;
  contentType?: string | null;
}

export interface CreateReferenceInput {
  file: UploadFile;
  category: Category;
  title?: string | null;
  mapName?: string | null;
  creatorName?: string | null;
  creatorId?: string | null;
  tags?: string[];
  uploader: UserInfo;
}

export interface UpdateReferenceInput {
  title?: string | null;
  mapName?: string | null;
  creatorName?: string | null;
  creatorId?: string | null;
  category?: Category;
  /** 태그 전체 교체 */
  tags?: string[];
  addTags?: string[];
  removeTags?: string[];
}

export class DuplicateError extends UserError {
  constructor(readonly matches: Reference[]) {
    super(`이미 비슷한 레퍼런스가 있습니다: ${matches.map((m) => `#${m.id}`).join(', ')}`, { status: 409, code: 'duplicate' });
    this.name = 'DuplicateError';
  }
}

export interface ListResult {
  items: Reference[];
  total: number;
}

type ColorIndexRow = { id: number; category: Category; colorHist: number[]; palette: PaletteColor[] };

function clean(v: string | null | undefined, max: number): string | null {
  if (v === null || v === undefined) return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function titleFromFilename(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  return base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || '제목 없음';
}

export class ReferenceService {
  private colorCache: { at: number; rows: ColorIndexRow[] } | null = null;

  constructor(
    private readonly db: Db,
    private readonly storage: PreviewStorage,
    private archive: OriginalArchive,
    private readonly config: Config,
  ) {}

  /** 봇이 준비된 후 디스코드 아카이브로 교체할 때 사용 */
  setArchive(archive: OriginalArchive): void {
    this.archive = archive;
  }

  get archiveAvailable(): boolean {
    return this.archive.isAvailable();
  }

  private invalidate(): void {
    this.colorCache = null;
  }

  canEdit(ref: Reference, actor: Actor): boolean {
    return actor.isAdmin || ref.uploaderId === actor.id;
  }

  // ── 태그 검증 ───────────────────────────────────────────

  /** 입력된 태그 이름을 정규화하고 존재하는 태그인지 확인 */
  async resolveTags(names: string[]): Promise<{ id: number; name: string }[]> {
    const normalized = [...new Set(names.map(normalizeTagName).filter(Boolean))];
    if (normalized.length > LIMITS.tagsPerRef) throw new UserError(`태그는 최대 ${LIMITS.tagsPerRef}개까지 달 수 있습니다.`);
    const found = await tagsRepo.findByNames(this.db, normalized);
    const missing = normalized.filter((n) => !found.some((f) => f.name === n));
    if (missing.length) {
      const all = await tagsRepo.names(this.db);
      throw new UserError(
        `없는 태그입니다: ${missing.map((m) => `\`${m}\``).join(', ')}\n사용 가능한 태그: ${all.map((t) => `\`${t}\``).join(', ')}`,
        { code: 'unknown_tag' },
      );
    }
    return found;
  }

  // ── 생성 ────────────────────────────────────────────────

  async create(input: CreateReferenceInput, opts: { allowDuplicate?: boolean } = {}): Promise<Reference> {
    if (!isCategory(input.category)) throw new UserError('분류를 선택해 주세요.');
    const cat = CATEGORIES[input.category];
    const { file } = input;
    if (!file.buffer?.length) throw new UserError('빈 파일입니다.');
    if (file.buffer.length > this.config.upload.maxBytes) {
      throw new UserError(`파일이 너무 큽니다. 최대 ${Math.round(this.config.upload.maxBytes / 1024 / 1024)}MB 까지 올릴 수 있습니다.`);
    }

    const mapName = cat.hasMapName ? clean(input.mapName, LIMITS.mapName) : null;
    if (cat.requiresMapName && !mapName) throw new UserError(`${cat.label} 는 맵 이름이 필요합니다.`, { code: 'map_required' });
    const creatorName =
      clean(input.creatorName, LIMITS.creatorName) ?? clean(input.uploader.displayName ?? input.uploader.username, LIMITS.creatorName)!;
    const title = clean(input.title, LIMITS.title) ?? mapName ?? titleFromFilename(file.filename);
    const tags = await this.resolveTags(input.tags ?? []);

    const img = await processImage(file.buffer, {
      previewMaxSize: this.config.upload.previewMaxSize,
      previewQuality: this.config.upload.previewQuality,
    });

    if (!opts.allowDuplicate && this.config.upload.duplicateThreshold > 0) {
      const dupes = await this.findDuplicates(img.dhash);
      if (dupes.length) throw new DuplicateError(dupes);
    }

    const now = new Date();
    const previewKey = `previews/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.webp`;
    await this.storage.put(previewKey, img.preview.data, img.preview.mime);

    let id: number;
    try {
      id = await this.db.tx(async (q) => {
        await usersRepo.upsert(q, input.uploader);
        const newId = await refsRepo.insert(q, {
          category: input.category,
          title,
          mapName,
          creatorName,
          creatorId: input.creatorId ?? null,
          uploaderId: input.uploader.id,
          originalFilename: path.basename(file.filename),
          originalMime: img.mime,
          originalSize: file.buffer.length,
          width: img.width,
          height: img.height,
          previewKey,
          previewWidth: img.preview.width,
          previewHeight: img.preview.height,
          previewSize: img.preview.size,
          palette: img.colors.palette,
          colorHist: img.colors.colorHist,
          colorShares: img.colors.colorShares,
          primaryColor: img.colors.primaryColor,
          dhash: img.dhash,
        });
        await tagsRepo.setRefTags(
          q,
          newId,
          tags.map((t) => t.id),
        );
        return newId;
      });
    } catch (err) {
      await this.storage.delete(previewKey).catch(() => undefined);
      throw err;
    }

    const ref = (await refsRepo.get(this.db, id))!;
    try {
      const archived = await this.archive.store(ref, {
        buffer: file.buffer,
        filename: `ref-${id}.${img.ext}`,
        contentType: img.mime,
      });
      await refsRepo.setArchive(this.db, id, archived.channelId, archived.messageId);
    } catch (err) {
      log.error(`#${id} 원본 보관 실패 — 등록을 취소합니다.`, err);
      await refsRepo.delete(this.db, id).catch(() => undefined);
      await this.storage.delete(previewKey).catch(() => undefined);
      throw new UserError('원본을 디스코드 아카이브에 보관하지 못했습니다. 봇 권한(메시지 보내기 / 파일 첨부)을 확인해 주세요.', {
        status: 502,
        code: 'archive_failed',
      });
    }
    this.invalidate();
    log.info(`#${id} 등록: ${title} (${input.category}) by ${input.uploader.username}`);
    return (await refsRepo.get(this.db, id))!;
  }

  async findDuplicates(dhash: string, excludeId?: number): Promise<Reference[]> {
    const threshold = this.config.upload.duplicateThreshold;
    const all = await refsRepo.hashes(this.db);
    const ids = all
      .filter((h) => h.id !== excludeId && hammingDistance(h.dhash, dhash) <= threshold)
      .sort((a, b) => hammingDistance(a.dhash, dhash) - hammingDistance(b.dhash, dhash))
      .slice(0, 5)
      .map((h) => h.id);
    if (!ids.length) return [];
    const { items } = await refsRepo.search(this.db, { ids, sort: 'ids', limit: 5 });
    return items;
  }

  // ── 수정 / 삭제 ─────────────────────────────────────────

  async update(id: number, input: UpdateReferenceInput, actor: Actor): Promise<Reference> {
    const ref = await this.require(id);
    if (!this.canEdit(ref, actor)) throw new ForbiddenError('올린 사람이나 관리자만 수정할 수 있습니다.');

    const category = input.category ?? ref.category;
    if (!isCategory(category)) throw new UserError('잘못된 분류입니다.');
    const cat = CATEGORIES[category];
    const patch: Parameters<typeof refsRepo.update>[2] = {};
    if (input.category && input.category !== ref.category) patch.category = input.category;
    if (input.title !== undefined) patch.title = clean(input.title, LIMITS.title) ?? ref.title;
    if (input.creatorName !== undefined) patch.creatorName = clean(input.creatorName, LIMITS.creatorName) ?? ref.creatorName;
    if (input.creatorId !== undefined) patch.creatorId = input.creatorId;

    let mapName = ref.mapName;
    if (input.mapName !== undefined) mapName = clean(input.mapName, LIMITS.mapName);
    if (!cat.hasMapName) mapName = null;
    if (cat.requiresMapName && !mapName) throw new UserError(`${cat.label} 는 맵 이름이 필요합니다.`, { code: 'map_required' });
    if (mapName !== ref.mapName) patch.mapName = mapName;

    let tagNames: string[] | null = null;
    if (input.tags) tagNames = input.tags;
    if (input.addTags?.length || input.removeTags?.length) {
      const base = new Set(tagNames ?? ref.tags);
      for (const t of input.addTags ?? []) base.add(normalizeTagName(t));
      for (const t of input.removeTags ?? []) base.delete(normalizeTagName(t));
      tagNames = [...base];
    }
    const tags = tagNames ? await this.resolveTags(tagNames) : null;

    await this.db.tx(async (q) => {
      await refsRepo.update(q, id, patch);
      if (tags)
        await tagsRepo.setRefTags(
          q,
          id,
          tags.map((t) => t.id),
        );
    });
    this.invalidate();
    const updated = (await refsRepo.get(this.db, id))!;
    await this.archive.refresh(updated).catch((err) => log.warn(`#${id} 아카이브 메시지 갱신 실패`, err));
    return updated;
  }

  async delete(id: number, actor: Actor): Promise<Reference> {
    const ref = await this.require(id);
    if (!this.canEdit(ref, actor)) throw new ForbiddenError('올린 사람이나 관리자만 삭제할 수 있습니다.');
    await refsRepo.delete(this.db, id);
    this.invalidate();
    await this.archive.remove(ref).catch((err) => log.warn(`#${id} 아카이브 메시지 삭제 실패`, err));
    await this.storage.delete(ref.previewKey).catch((err) => log.warn(`#${id} 미리보기 삭제 실패`, err));
    log.info(`#${id} 삭제 by ${actor.id}`);
    return ref;
  }

  // ── 조회 ────────────────────────────────────────────────

  get(id: number): Promise<Reference | null> {
    return refsRepo.get(this.db, id);
  }

  async require(id: number): Promise<Reference> {
    const ref = await refsRepo.get(this.db, id);
    if (!ref) throw new NotFoundError(`#${id} 레퍼런스를 찾을 수 없습니다.`);
    return ref;
  }

  getByArchiveMessage(messageId: string): Promise<Reference | null> {
    return refsRepo.getByArchiveMessage(this.db, messageId);
  }

  search(opts: SearchOptions): Promise<ListResult> {
    return refsRepo.search(this.db, opts);
  }

  async popular(
    opts: Omit<SearchOptions, 'sort' | 'since'> & { period?: PopularPeriod },
  ): Promise<ListResult> {
    return refsRepo.search(this.db, { ...opts, sort: 'popular', since: periodSince(opts.period ?? 'all') });
  }

  async random(filters: Omit<SearchOptions, 'sort' | 'limit' | 'offset'> = {}): Promise<Reference | null> {
    const { items } = await refsRepo.search(this.db, { ...filters, sort: 'random', limit: 1 });
    return items[0] ?? null;
  }

  private async colorIndex(): Promise<ColorIndexRow[]> {
    if (this.colorCache && Date.now() - this.colorCache.at < 5 * 60_000) return this.colorCache.rows;
    const rows = await refsRepo.colorIndex(this.db);
    this.colorCache = { at: Date.now(), rows };
    return rows;
  }

  /** 색감이 비슷한 레퍼런스 */
  async similar(id: number, opts: Omit<SearchOptions, 'ids' | 'sort'> = {}): Promise<ListResult> {
    const ref = await this.require(id);
    const index = await this.colorIndex();
    const scored = index
      .filter((r) => r.id !== id)
      .map((r) => ({ id: r.id, s: colorSimilarity(ref, r) }))
      .filter((r) => r.s >= 0.3)
      .sort((a, b) => b.s - a.s)
      .slice(0, 300);
    if (!scored.length) return { items: [], total: 0 };
    return refsRepo.search(this.db, { ...opts, ids: scored.map((s) => s.id), sort: 'ids' });
  }

  /** 특정 색(hex)이 들어간 레퍼런스 */
  async byHex(hex: string, opts: Omit<SearchOptions, 'ids' | 'sort'> = {}): Promise<ListResult> {
    const lab = hexToLab(hex);
    if (!lab) throw new UserError('색상 코드는 #ff0044 같은 형식으로 입력해 주세요.');
    const index = await this.colorIndex();
    const scored = index
      .map((r) => ({ id: r.id, s: hexMatchScore(lab, r.palette) }))
      .filter((r) => r.s >= 0.12)
      .sort((a, b) => b.s - a.s)
      .slice(0, 300);
    if (!scored.length) return { items: [], total: 0 };
    return refsRepo.search(this.db, { ...opts, ids: scored.map((s) => s.id), sort: 'ids' });
  }

  creators(prefix: string, limit = 25): Promise<string[]> {
    return refsRepo.creators(this.db, prefix, limit);
  }

  suggest(text: string, limit = 25) {
    return refsRepo.suggest(this.db, text, limit);
  }

  colorStats(category?: Category): Promise<Record<ColorFamily, number>> {
    return refsRepo.colorStats(this.db, category);
  }

  // ── 반응 ────────────────────────────────────────────────

  normalizeReaction(emoji: string): string {
    const e = normalizeEmoji(emoji);
    if (!this.config.reactionEmojis.includes(e)) {
      throw new UserError(`사용할 수 있는 반응: ${this.config.reactionEmojis.join(' ')}`);
    }
    return e;
  }

  isReactionEmoji(emoji: string | null | undefined): boolean {
    return !!emoji && this.config.reactionEmojis.includes(normalizeEmoji(emoji));
  }

  async toggleReaction(refId: number, user: UserInfo, emoji: string): Promise<{ active: boolean; reactions: Record<string, number> }> {
    const e = this.normalizeReaction(emoji);
    await this.require(refId);
    await usersRepo.upsert(this.db, user);
    const active = await reactionsRepo.toggle(this.db, refId, user.id, e);
    return { active, reactions: await reactionsRepo.counts(this.db, refId) };
  }

  async setReaction(refId: number, user: UserInfo, emoji: string, on: boolean): Promise<boolean> {
    const e = this.normalizeReaction(emoji);
    await usersRepo.upsert(this.db, user);
    return on ? reactionsRepo.add(this.db, refId, user.id, e) : reactionsRepo.remove(this.db, refId, user.id, e);
  }

  myReactions(refIds: number[], userId: string): Promise<Map<number, string[]>> {
    return reactionsRepo.mine(this.db, refIds, userId);
  }

  // ── 원본 ────────────────────────────────────────────────

  async fetchOriginal(ref: Reference): Promise<OriginalFile> {
    const file = await this.archive.fetch(ref);
    if (!file) throw new NotFoundError('원본 파일을 찾을 수 없습니다. 아카이브 메시지가 삭제되었을 수 있습니다.');
    return file;
  }

  /** 다운로드할 때 쓸 파일 이름: "#12 맵이름 - 제작자.png" 형태 */
  downloadFilename(ref: Reference, file: OriginalFile): string {
    const ext = path.extname(file.filename) || path.extname(ref.originalFilename) || '.png';
    const base = `${ref.id} ${ref.title} - ${ref.creatorName}`.replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return `${base.slice(0, 120)}${ext}`;
  }

  // ── 외부 노출 ───────────────────────────────────────────

  previewUrl(ref: Pick<Reference, 'previewKey'>): string {
    return this.storage.publicUrl(ref.previewKey) ?? `${this.config.publicBaseUrl}/api/previews/${ref.previewKey}`;
  }

  siteUrl(ref: Pick<Reference, 'id'>): string {
    return `${this.config.publicBaseUrl}/#/ref/${ref.id}`;
  }

  toPublic(ref: Reference, myReactions?: string[]): PublicReference {
    return {
      id: ref.id,
      category: ref.category,
      categoryLabel: CATEGORIES[ref.category]?.label ?? ref.category,
      title: ref.title,
      mapName: ref.mapName,
      creator: { name: ref.creatorName, id: ref.creatorId },
      uploader: { id: ref.uploaderId, name: ref.uploaderName, avatarUrl: ref.uploaderAvatar },
      width: ref.width,
      height: ref.height,
      originalSize: ref.originalSize,
      originalMime: ref.originalMime,
      preview: { url: this.previewUrl(ref), width: ref.previewWidth, height: ref.previewHeight },
      thumbUrl: `${this.config.publicBaseUrl}/api/refs/${ref.id}/thumb`,
      siteUrl: this.siteUrl(ref),
      palette: ref.palette,
      primaryColor: ref.primaryColor,
      colorShares: ref.colorShares,
      tags: ref.tags,
      reactions: ref.reactions,
      reactionTotal: ref.reactionTotal,
      periodReactions: ref.periodReactions,
      myReactions,
      createdAt: ref.createdAt.toISOString(),
    };
  }

  async toPublicList(items: Reference[], viewerId?: string): Promise<PublicReference[]> {
    const mine = viewerId ? await this.myReactions(items.map((i) => i.id), viewerId) : null;
    return items.map((r) => this.toPublic(r, mine ? (mine.get(r.id) ?? []) : undefined));
  }

  async getPreview(ref: Reference): Promise<Buffer | null> {
    const obj = await this.storage.get(ref.previewKey);
    return obj?.data ?? null;
  }
}
