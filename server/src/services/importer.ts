import { type Category, isCategory } from '../constants.js';
import type { Db } from '../db/index.js';
import { kvRepo } from '../repos/kv.js';
import type { UserInfo } from '../types.js';
import { NotFoundError, ServiceUnavailableError, UserError } from '../util/errors.js';
import { logger } from '../util/log.js';
import { findSimilarGroups, groupKey, type NameCount, type NameGroup, similarTo } from '../util/similar.js';
import { LIMITS, type ReferenceService, splitCreatorNames } from './references.js';

const log = logger('import');

// ── 디스코드 쪽 (봇이 구현) ─────────────────────────────────

export interface SourceAttachment {
  id: string;
  filename: string;
  contentType: string | null;
  size: number;
  width: number | null;
  height: number | null;
}

export interface SourceMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  content: string;
  postedAt: Date;
  /** 본문에 멘션된 사용자 (제작자를 @멘션으로 쓴 경우 이름으로 바꾸기 위해) */
  mentions: { id: string; name: string }[];
  attachments: SourceAttachment[];
}

export interface SourceChannel {
  id: string;
  name: string;
  parentName: string | null;
}

/** 예전 채팅 채널에서 메시지와 원본 파일을 가져오는 기능 */
export interface ImportSource {
  listChannels(): Promise<SourceChannel[]>;
  /** 최신 → 과거 순으로 최대 100개. before 를 주면 그 메시지보다 이전 것 */
  fetchMessages(channelId: string, before?: string): Promise<SourceMessage[]>;
  fetchAttachment(channelId: string, messageId: string, attachmentId: string): Promise<{ buffer: Buffer; filename: string; contentType: string | null } | null>;
}

// ── "맵이름 by 제작자" 읽기 ────────────────────────────────────

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|tiff?)$/i;

export function isImageAttachment(a: Pick<SourceAttachment, 'filename' | 'contentType'>): boolean {
  return a.contentType?.startsWith('image/') || IMAGE_EXT.test(a.filename);
}

/** 레퍼런스 글인지: "by" 라는 단어가 있고 이미지가 첨부되어 있음 */
export function looksLikeReference(m: Pick<SourceMessage, 'content' | 'attachments'>): boolean {
  return /\bby\b/i.test(m.content) && m.attachments.some(isImageAttachment);
}

/** 디스코드 꾸밈 문법 (굵게, 기울임, 스포일러, 인용, 사용자 이모지 등) 제거 */
function plain(line: string): string {
  return line
    .replace(/<a?:(\w+):\d+>/g, '')
    .replace(/(\*\*|__|\*|_|~~|\|\||`)/g, '')
    .replace(/^\s*(#{1,3}|>|-#|-|•)\s+/, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tidy(s: string): string | null {
  const v = s
    .replace(/^[\s\-–—:|"'“”]+/, '')
    .replace(/[\s\-–—:|.,!?"'“”]+$/, '')
    .trim();
  return v || null;
}

/**
 * "Bloodbath by Riot" → { mapName: 'Bloodbath', creatorName: 'Riot' }
 * 제작자가 <@123> 멘션이면 그 사람 이름으로 바꾸고 creatorId 도 채웁니다.
 */
export function parseCaption(
  content: string,
  mentions: SourceMessage['mentions'] = [],
): { mapName: string | null; creatorName: string | null; creatorId: string | null } {
  const empty = { mapName: null, creatorName: null, creatorId: null };
  for (const raw of content.split('\n')) {
    const line = plain(raw);
    const m = /^(.*?)\s*\bby\b\s*:?\s*(.+)$/i.exec(line);
    if (!m) continue;
    let creatorId: string | null = null;
    const creatorRaw = m[2].replace(/<@!?(\d+)>/g, (_, id: string) => {
      const who = mentions.find((u) => u.id === id);
      creatorId ??= id;
      return who?.name ?? '';
    });
    return {
      mapName: tidy(m[1])?.slice(0, LIMITS.mapName) ?? null,
      creatorName: tidy(creatorRaw)?.slice(0, LIMITS.creatorName) ?? null,
      creatorId,
    };
  }
  return empty;
}

// ── 후보 목록 ───────────────────────────────────────────────

export type ImportStatus = 'pending' | 'imported' | 'skipped';
export type NameField = 'creator' | 'map';

export interface ImportItem {
  id: number;
  channelId: string;
  messageId: string;
  attachmentId: string;
  authorId: string | null;
  authorName: string | null;
  postedAt: string;
  content: string;
  filename: string;
  width: number | null;
  height: number | null;
  size: number | null;
  mapName: string | null;
  creatorName: string | null;
  category: Category;
  tags: string[];
  status: ImportStatus;
  refId: number | null;
  /** 지금 태그를 붙이고 있는 사람 (잠깐 맡아 둔 사람) */
  claimedBy: string | null;
  claimedAt: string | null;
  /** 저장하거나 건너뛴 사람 */
  decidedBy: string | null;
}

/** 한 사람이 후보를 맡아 두는 시간. 지나면 다른 사람이 이어서 할 수 있음 */
export const CLAIM_MINUTES = 10;

type Row = Record<string, unknown>;

function mapRow(r: Row): ImportItem {
  return {
    id: Number(r.id),
    channelId: String(r.channel_id),
    messageId: String(r.message_id),
    attachmentId: String(r.attachment_id),
    authorId: (r.author_id as string) ?? null,
    authorName: (r.author_name as string) ?? null,
    postedAt: new Date(r.posted_at as string).toISOString(),
    content: String(r.content ?? ''),
    filename: String(r.filename),
    width: r.width === null ? null : Number(r.width),
    height: r.height === null ? null : Number(r.height),
    size: r.size === null ? null : Number(r.size),
    mapName: (r.map_name as string) ?? null,
    creatorName: (r.creator_name as string) ?? null,
    category: r.category as Category,
    tags: (typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags) as string[],
    status: r.status as ImportStatus,
    refId: r.ref_id === null || r.ref_id === undefined ? null : Number(r.ref_id),
    claimedBy: (r.claimed_by as string) ?? null,
    claimedAt: r.claimed_at ? new Date(r.claimed_at as string).toISOString() : null,
    decidedBy: (r.decided_by as string) ?? null,
  };
}

export interface ScanState {
  running: boolean;
  channelId: string | null;
  scanned: number;
  found: number;
  added: number;
  /** 읽은 메시지가 모두 빈 내용이면 Message Content Intent 가 꺼진 것 */
  contentHidden: boolean;
  error: string | null;
  finishedAt: string | null;
}

const IGNORE_KEY: Record<NameField, string> = { creator: 'import:ignore:creator', map: 'import:ignore:map' };
const COLUMN: Record<NameField, 'creator_name' | 'map_name'> = { creator: 'creator_name', map: 'map_name' };

export class ImportService {
  private scan: ScanState = {
    running: false,
    channelId: null,
    scanned: 0,
    found: 0,
    added: 0,
    contentHidden: false,
    error: null,
    finishedAt: null,
  };

  constructor(
    private readonly db: Db,
    private readonly refs: ReferenceService,
    private readonly source: () => ImportSource | null,
  ) {}

  private requireSource(): ImportSource {
    const s = this.source();
    if (!s) throw new ServiceUnavailableError('디스코드 봇이 연결되어 있지 않아요. 봇이 온라인일 때 다시 시도해 주세요.');
    return s;
  }

  scanState(): ScanState {
    return { ...this.scan };
  }

  /** 채널 전체를 거슬러 올라가며 레퍼런스 글을 후보로 저장 (백그라운드). 이미 저장한 첨부파일은 건너뜀 */
  startScan(channelId: string): ScanState {
    const source = this.requireSource();
    if (this.scan.running) throw new UserError('이미 채널을 확인하는 중이에요.');
    void this.runScan(source, channelId);
    return this.scanState();
  }

  /** 테스트에서 끝날 때까지 기다리려고 따로 둠 */
  async runScan(source: ImportSource, channelId: string): Promise<void> {
    this.scan = { running: true, channelId, scanned: 0, found: 0, added: 0, contentHidden: false, error: null, finishedAt: null };
    let before: string | undefined;
    let sawContent = false;
    try {
      for (;;) {
        const page = await source.fetchMessages(channelId, before);
        if (!page.length) break;
        for (const m of page) {
          this.scan.scanned++;
          if (m.content || m.attachments.length) sawContent = true;
          if (!looksLikeReference(m)) continue;
          this.scan.found++;
          this.scan.added += await this.addMessage(m);
        }
        before = page[page.length - 1].id;
        if (page.length < 100) break;
      }
      this.scan.contentHidden = this.scan.scanned > 0 && !sawContent;
      log.info(`채널 ${channelId} 확인: 메시지 ${this.scan.scanned}개 · 레퍼런스 글 ${this.scan.found}개 · 새 후보 ${this.scan.added}개`);
    } catch (err) {
      log.error('채널 확인 실패', err);
      this.scan.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.scan.running = false;
      this.scan.finishedAt = new Date().toISOString();
    }
  }

  /** 메시지의 이미지 첨부파일마다 후보 하나. 새로 추가한 개수 반환 */
  async addMessage(m: SourceMessage): Promise<number> {
    const parsed = parseCaption(m.content, m.mentions);
    let added = 0;
    for (const a of m.attachments.filter(isImageAttachment)) {
      const rows = await this.db.query(
        `INSERT INTO import_items (channel_id, message_id, attachment_id, author_id, author_name, posted_at, content,
           filename, content_type, size, width, height, map_name, creator_name, creator_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (attachment_id) DO NOTHING RETURNING id`,
        [
          m.channelId,
          m.id,
          a.id,
          m.authorId,
          m.authorName,
          m.postedAt.toISOString(),
          m.content,
          a.filename,
          a.contentType,
          a.size,
          a.width,
          a.height,
          parsed.mapName,
          parsed.creatorName,
          parsed.creatorId,
        ],
      );
      added += rows.length;
    }
    return added;
  }

  listChannels(): Promise<SourceChannel[]> {
    return this.requireSource().listChannels();
  }

  async counts(): Promise<Record<ImportStatus, number>> {
    const rows = await this.db.query<{ status: ImportStatus; n: number }>('SELECT status, count(*)::int AS n FROM import_items GROUP BY status');
    const out: Record<ImportStatus, number> = { pending: 0, imported: 0, skipped: 0 };
    for (const r of rows) out[r.status] = Number(r.n);
    return out;
  }

  /** 오래된 글부터 (채널에 올라온 순서대로 정리하기 쉽게) */
  async list(status: ImportStatus, viewerId?: string): Promise<ImportItem[]> {
    // 다른 사람이 맡아 둔(태그 붙이는 중인) 후보는 빼고 보여줌
    const rows = viewerId
      ? await this.db.query<Row>(
          `SELECT * FROM import_items WHERE status = $1
             AND NOT (claimed_by IS NOT NULL AND claimed_by <> $2 AND claimed_at > now() - make_interval(mins => $3))
           ORDER BY posted_at, id`,
          [status, viewerId, CLAIM_MINUTES],
        )
      : await this.db.query<Row>('SELECT * FROM import_items WHERE status = $1 ORDER BY posted_at, id', [status]);
    return rows.map(mapRow);
  }

  /**
   * 후보를 맡아 두기 (태그 화면에 띄울 때). 다른 사람이 맡고 있으면 409.
   * 맡은 지 CLAIM_MINUTES 분이 지나면 다른 사람이 가져갈 수 있음.
   */
  async claim(id: number, userId: string): Promise<ImportItem> {
    const rows = await this.db.query<Row>(
      `UPDATE import_items SET claimed_by = $2, claimed_at = now()
       WHERE id = $1 AND status <> 'imported'
         AND (claimed_by IS NULL OR claimed_by = $2 OR claimed_at <= now() - make_interval(mins => $3))
       RETURNING *`,
      [id, userId, CLAIM_MINUTES],
    );
    if (rows[0]) return mapRow(rows[0]);
    const item = await this.get(id);
    if (item.status === 'imported') throw new UserError('이미 옮긴 레퍼런스예요. (다른 분이 먼저 저장했을 수 있어요)', { status: 409, code: 'already_imported' });
    throw new UserError('다른 분이 지금 태그를 붙이고 있어요. 다음 것으로 넘어갈게요.', { status: 409, code: 'claimed' });
  }

  async get(id: number): Promise<ImportItem> {
    const rows = await this.db.query<Row>('SELECT * FROM import_items WHERE id = $1', [id]);
    if (!rows[0]) throw new NotFoundError('가져올 레퍼런스 후보를 찾을 수 없어요.');
    return mapRow(rows[0]);
  }

  /** 맵 이름 · 제작자 · 분류 · 태그 임시 저장 */
  async update(
    id: number,
    patch: { mapName?: string | null; creatorName?: string | null; category?: string; tags?: string[] },
    userId?: string,
  ): Promise<ImportItem> {
    const item = userId ? await this.claim(id, userId) : await this.get(id);
    if (item.status === 'imported') throw new UserError('이미 옮긴 레퍼런스예요.');
    if (patch.category !== undefined && !isCategory(patch.category)) throw new UserError('잘못된 분류입니다.');
    const tags = patch.tags ? (await this.refs.resolveTags(patch.tags)).map((t) => t.name) : item.tags;
    const clean = (v: string | null | undefined, max: number, cur: string | null) =>
      v === undefined ? cur : (v ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || null;
    await this.db.query(
      `UPDATE import_items SET map_name = $2, creator_name = $3, category = $4, tags = $5::jsonb, updated_at = now() WHERE id = $1`,
      [
        id,
        clean(patch.mapName, LIMITS.mapName, item.mapName),
        clean(patch.creatorName, LIMITS.creatorName, item.creatorName),
        patch.category ?? item.category,
        JSON.stringify(tags),
      ],
    );
    return this.get(id);
  }

  async setStatus(id: number, status: 'pending' | 'skipped', userId?: string): Promise<ImportItem> {
    // 건너뛰기는 맡은 사람만, 되돌리기는 누구나
    const item = userId && status === 'skipped' ? await this.claim(id, userId) : await this.get(id);
    if (item.status === 'imported') throw new UserError('이미 옮긴 레퍼런스예요.');
    await this.db.query(
      `UPDATE import_items SET status = $2, decided_by = $3, claimed_by = NULL, claimed_at = NULL, updated_at = now() WHERE id = $1`,
      [id, status, status === 'skipped' ? (userId ?? null) : null],
    );
    return this.get(id);
  }

  /** 원본 파일 (화면 미리보기 / 저장용) */
  async original(id: number) {
    const item = await this.get(id);
    const file = await this.requireSource().fetchAttachment(item.channelId, item.messageId, item.attachmentId);
    if (!file) throw new NotFoundError('디스코드에서 원본을 찾지 못했어요. 메시지가 지워졌을 수 있어요.');
    return { item, file };
  }

  /**
   * 레퍼런스로 저장: 원본을 받아 아카이브 채널에 다시 올리고 refs 에 넣음.
   * 올린 사람(점수를 받는 사람)은 태그를 붙여 저장한 사람, 올린 날짜는 원래 채팅에 올린 날짜.
   */
  async commit(id: number, uploader: UserInfo, opts: { allowDuplicate?: boolean } = {}) {
    await this.claim(id, uploader.id);
    const { item, file } = await this.original(id);
    if (item.status === 'imported') throw new UserError('이미 옮긴 레퍼런스예요.');
    if (!item.creatorName) throw new UserError('제작자를 입력해 주세요.');
    if (!item.tags.length) throw new UserError('태그를 하나 이상 골라 주세요.', { code: 'tags_required' });
    // 비슷한 이미지가 이미 있으면 DuplicateError (409) — 화면에서 "그래도 저장" 으로 다시 부름
    const ref = await this.refs.create(
      {
        file: { buffer: file.buffer, filename: file.filename, contentType: file.contentType },
        category: item.category,
        mapName: item.mapName,
        creatorName: item.creatorName,
        tags: item.tags,
        uploader,
        createdAt: new Date(item.postedAt),
      },
      opts,
    );
    await this.db.query(
      `UPDATE import_items SET status = 'imported', ref_id = $2, decided_by = $3, claimed_by = NULL, claimed_at = NULL, updated_at = now() WHERE id = $1`,
      [id, ref.id, uploader.id],
    );
    return { item: await this.get(id), ref };
  }

  // ── 이름 정리 ─────────────────────────────────────────────

  /** 후보(건너뛴 것 제외)와 이미 있는 레퍼런스에 쓰인 이름과 횟수 */
  async nameCounts(field: NameField): Promise<NameCount[]> {
    if (field === 'creator') return this.creatorCounts();
    const col = COLUMN[field];
    const rows = await this.db.query<{ name: string; n: number }>(
      `SELECT name, sum(n)::int AS n FROM (
         SELECT ${col} AS name, count(*) AS n FROM import_items WHERE status = 'pending' AND ${col} IS NOT NULL GROUP BY ${col}
         UNION ALL
         SELECT ${col} AS name, count(*) AS n FROM refs WHERE ${col} IS NOT NULL GROUP BY ${col}
       ) t GROUP BY name`,
    );
    return rows.map((r) => ({ name: r.name, count: Number(r.n) }));
  }

  /** 제작자는 "A, B" 처럼 여러 명일 수 있어서 한 사람씩 셈 */
  private async creatorCounts(): Promise<NameCount[]> {
    const counts = new Map<string, number>();
    const add = (name: string, n: number) => counts.set(name, (counts.get(name) ?? 0) + n);
    const items = await this.db.query<{ name: string; n: number }>(
      `SELECT creator_name AS name, count(*)::int AS n FROM import_items WHERE status = 'pending' AND creator_name IS NOT NULL GROUP BY 1`,
    );
    for (const r of items) for (const name of splitCreatorNames(r.name)) add(name, Number(r.n));
    const refs = await this.db.query<{ name: string; n: number }>(
      `SELECT c->>'name' AS name, count(*)::int AS n FROM refs, jsonb_array_elements(refs.creators) c GROUP BY 1`,
    );
    for (const r of refs) add(r.name, Number(r.n));
    return [...counts].map(([name, count]) => ({ name, count }));
  }

  private async ignored(field: NameField): Promise<Set<string>> {
    return new Set((await kvRepo.get<string[]>(this.db, IGNORE_KEY[field])) ?? []);
  }

  async similarGroups(field: NameField): Promise<NameGroup[]> {
    return findSimilarGroups(await this.nameCounts(field), await this.ignored(field));
  }

  /** 입력 중인 이름과 비슷한 기존 이름 (태그 화면에서 바로 알려주기) */
  async suggest(field: NameField, name: string) {
    // 제작자를 "A, B" 처럼 적는 중이면 마지막으로 적은 사람 이름으로 찾음
    const target = field === 'creator' ? (splitCreatorNames(name).at(-1) ?? '') : name;
    return similarTo(target, await this.nameCounts(field));
  }

  /** "서로 다른 이름이에요" — 이 묶음은 다시 알리지 않음 */
  async ignoreGroup(field: NameField, names: string[]): Promise<void> {
    const set = await this.ignored(field);
    set.add(groupKey(names));
    await kvRepo.set(this.db, IGNORE_KEY[field], [...set]);
  }

  /**
   * from 이름들을 to 로 통일. 아직 옮기지 않은 후보와 이미 있는 레퍼런스 모두 바꿉니다.
   * (레퍼런스 제목이 맵 이름과 같았다면 제목도 함께)
   */
  async renameAll(field: NameField, from: string[], to: string, actor: { id: string; isAdmin: boolean }) {
    const target = to.replace(/\s+/g, ' ').trim();
    if (!target) throw new UserError('통일할 이름을 입력해 주세요.');
    const names = [...new Set(from)].filter((n) => n !== target);
    if (!names.length) return { items: 0, refs: 0 };
    if (field === 'creator') return this.renameCreators(names, target, actor);
    const col = COLUMN[field];
    const items = await this.db.query(
      `UPDATE import_items SET ${col} = $2, updated_at = now() WHERE ${col} = ANY($1::text[]) AND status <> 'imported' RETURNING id`,
      [names, target],
    );
    const refRows = await this.db.query<{ id: number; title: string; map_name: string | null }>(
      `SELECT id, title, map_name FROM refs WHERE ${col} = ANY($1::text[])`,
      [names],
    );
    for (const r of refRows) {
      await this.refs.update(r.id, { mapName: target, ...(r.title === r.map_name ? { title: target } : {}) }, actor);
    }
    log.info(`맵 이름 통일: ${names.join(', ')} → ${target} (후보 ${items.length} · 레퍼런스 ${refRows.length})`);
    return { items: items.length, refs: refRows.length };
  }

  /** 제작자 이름 통일: 여러 명 중 한 사람만 바꾸고 나머지는 그대로 둠 */
  private async renameCreators(names: string[], target: string, actor: { id: string; isAdmin: boolean }) {
    const from = new Set(names);
    const swap = (list: string[]) => list.map((n) => (from.has(n) ? target : n));
    let itemCount = 0;
    const items = await this.db.query<{ id: number; creator_name: string }>(
      `SELECT id, creator_name FROM import_items WHERE status <> 'imported' AND creator_name IS NOT NULL`,
    );
    for (const it of items) {
      const list = splitCreatorNames(it.creator_name);
      if (!list.some((n) => from.has(n))) continue;
      await this.db.query('UPDATE import_items SET creator_name = $2, updated_at = now() WHERE id = $1', [it.id, [...new Set(swap(list))].join(', ')]);
      itemCount++;
    }
    const refRows = await this.db.query<{ id: number }>(
      `SELECT DISTINCT r.id FROM refs r, jsonb_array_elements(r.creators) c WHERE c->>'name' = ANY($1::text[])`,
      [names],
    );
    for (const r of refRows) {
      const ref = await this.refs.require(Number(r.id));
      await this.refs.update(ref.id, { creators: ref.creators.map((c) => (from.has(c.name) ? { ...c, name: target } : c)) }, actor);
    }
    log.info(`제작자 이름 통일: ${names.join(', ')} → ${target} (후보 ${itemCount} · 레퍼런스 ${refRows.length})`);
    return { items: itemCount, refs: refRows.length };
  }
}
