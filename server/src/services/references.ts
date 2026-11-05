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
import type { Actor, Creator, PublicReference, Reference, UserInfo } from '../types.js';
import { ForbiddenError, NotFoundError, UserError } from '../util/errors.js';
import { logger } from '../util/log.js';
import { colorSimilarity, hexMatchScore, hexToLab, type PaletteColor } from './color.js';
import { hammingDistance, processImage } from './image.js';

const log = logger('refs');

export const LIMITS = {
  title: 100,
  mapName: 100,
  creatorName: 64,
  creatorsPerRef: 8,
  tagsPerRef: 12,
};

/**
 * "A, B" 처럼 쉼표로 이어 쓴 제작자 이름을 목록으로 (같은 이름은 한 번만).
 * 이름 안에 쉼표를 쓸 수는 없지만, 함께 만든 작품을 쉽게 적을 수 있습니다.
 */
export function splitCreatorNames(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of (text ?? '').split(/[,，、]/)) {
    const name = clean(part, LIMITS.creatorName);
    if (name && !out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

/** 제작자 목록 정리: 이름 다듬기, 같은 이름 합치기, 개수 제한 */
export function normalizeCreators(list: { name?: string | null; id?: string | null }[]): Creator[] {
  const out: Creator[] = [];
  for (const c of list) {
    // "A, B" 처럼 한 칸에 여러 명이 적혀 있으면 디스코드 계정은 첫 사람에게만 연결
    for (const [i, name] of splitCreatorNames(c.name).entries()) {
      const id = i === 0 && c.id && /^\d{5,25}$/.test(c.id) ? c.id : null;
      const same = out.find((o) => o.name.toLowerCase() === name.toLowerCase());
      if (same) {
        same.id ??= id;
        continue;
      }
      out.push({ name, id });
    }
  }
  if (out.length > LIMITS.creatorsPerRef) throw new UserError(`제작자는 최대 ${LIMITS.creatorsPerRef}명까지 적을 수 있습니다.`);
  return out;
}

/**
 * 입력에서 제작자 목록 만들기.
 * creators 가 있으면 그대로, 없으면 creatorName("A, B") + creatorId(첫 제작자) 로.
 * 아무것도 없으면 null.
 */
function creatorsFromInput(input: { creators?: Creator[] | null; creatorName?: string | null; creatorId?: string | null }): Creator[] | null {
  if (input.creators) return normalizeCreators(input.creators);
  if (input.creatorName === undefined || input.creatorName === null) return null;
  const names = splitCreatorNames(input.creatorName);
  if (!names.length) return null;
  return normalizeCreators(names.map((name, i) => ({ name, id: i === 0 ? (input.creatorId ?? null) : null })));
}

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
  /** "A, B" 처럼 쉼표로 여러 명을 적을 수 있음 */
  creatorName?: string | null;
  /** 첫 제작자의 디스코드 ID */
  creatorId?: string | null;
  /** 제작자 목록 (있으면 creatorName / creatorId 대신 사용) */
  creators?: Creator[] | null;
  tags?: string[];
  uploader: UserInfo;
  /** 예전에 올린 것을 옮겨올 때 원래 올린 시각 */
  createdAt?: Date | null;
}

export interface UpdateReferenceInput {
  title?: string | null;
  mapName?: string | null;
  /** "A, B" 처럼 쉼표로 여러 명을 적을 수 있음 */
  creatorName?: string | null;
  creatorId?: string | null;
  creators?: Creator[] | null;
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
    const creators = creatorsFromInput(input) ?? [
      { name: clean(input.uploader.displayName ?? input.uploader.username, LIMITS.creatorName)!, id: input.creatorId ?? null },
    ];
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
          creators,
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
          createdAt: input.createdAt,
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
    if (input.creators !== undefined || input.creatorName !== undefined) {
      const creators = creatorsFromInput(input);
      if (creators && JSON.stringify(creators) !== JSON.stringify(ref.creators)) patch.creators = creators;
    } else if (input.creatorId !== undefined && input.creatorId !== ref.creatorId) {
      // 첫 제작자의 디스코드 계정만 바꾸기
      patch.creators = ref.creators.map((c, i) => (i === 0 ? { ...c, id: input.creatorId ?? null } : c));
    }

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

  /**
   * 태그 이름이 바뀌었을 때처럼 여러 레퍼런스의 디스코드 아카이브 메시지를 다시 씀.
   * 디스코드 속도 제한 때문에 하나씩, 기다리지 않고 뒤에서 처리.
   */
  refreshArchives(ids: number[]): void {
    if (!ids.length) return;
    void (async () => {
      let done = 0;
      for (const id of ids) {
        const ref = await refsRepo.get(this.db, id).catch(() => null);
        if (!ref) continue;
        await this.archive.refresh(ref).then(
          () => done++,
          (err) => log.warn(`#${id} 아카이브 메시지 갱신 실패`, err),
        );
      }
      log.info(`아카이브 메시지 ${done}/${ids.length}개 갱신`);
    })();
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
    const s = this.config.scoring;
    return refsRepo.search(this.db, {
      ...opts,
      sort: 'popular',
      since: periodSince(opts.period ?? 'all'),
      reactionWeights: { points: s.reactionPoints, fallback: s.pointsPerReaction },
    });
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
      creators: ref.creators,
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
      videoCount: ref.videoCount,
      periodReactions: ref.periodReactions,
      periodPoints: ref.periodPoints,
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
