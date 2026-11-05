import { type Category, type ColorFamily, colorFilterThreshold, COLOR_FAMILY_KEYS } from '../constants.js';
import type { Queryable } from '../db/index.js';
import type { PaletteColor } from '../services/color.js';
import type { Creator, Reference } from '../types.js';

export interface NewReference {
  category: Category;
  title: string;
  mapName: string | null;
  creators: Creator[];
  uploaderId: string;
  originalFilename: string;
  originalMime: string;
  originalSize: number;
  width: number;
  height: number;
  previewKey: string;
  previewWidth: number;
  previewHeight: number;
  previewSize: number;
  palette: PaletteColor[];
  colorHist: number[];
  colorShares: Record<ColorFamily, number>;
  primaryColor: ColorFamily;
  dhash: string;
  /** 비우면 지금 시각 (예전 채팅에서 옮겨온 레퍼런스는 원래 올린 시각) */
  createdAt?: Date | null;
}

export interface SearchFilters {
  /** 제목 / 맵 이름 / 제작자 / 태그 / #번호 */
  q?: string;
  category?: Category;
  /** 모두 포함해야 함 (AND) */
  tags?: string[];
  color?: ColorFamily;
  creator?: string;
  uploaderId?: string;
  /** 이 ID 목록 안에서만 (색상 유사도 검색 결과 등). 정렬도 이 순서를 따름 */
  ids?: number[];
}

export type SearchSort = 'newest' | 'oldest' | 'popular' | 'random' | 'color' | 'ids';

export interface SearchOptions extends SearchFilters {
  sort?: SearchSort;
  /** 인기순일 때 이 시점 이후의 반응만 집계 */
  since?: Date | null;
  /** 인기순일 때 반응별 점수 (없으면 반응 개수로) */
  reactionWeights?: { points: Record<string, number>; fallback: number };
  /** 무작위 정렬을 페이지를 넘겨도 같은 순서로 유지하기 위한 값 */
  seed?: string;
  limit?: number;
  offset?: number;
}

class Params {
  values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

const SELECT_COLUMNS = `
  r.*,
  u.username AS uploader_username,
  u.display_name AS uploader_display_name,
  u.avatar_url AS uploader_avatar,
  COALESCE((SELECT json_agg(t.name ORDER BY t.name) FROM ref_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.ref_id = r.id), '[]'::json) AS tag_names,
  COALESCE((SELECT json_object_agg(x.emoji, x.c) FROM (SELECT emoji, count(*)::int AS c FROM reactions WHERE ref_id = r.id GROUP BY emoji) x), '{}'::json) AS reaction_counts,
  (SELECT count(*)::int FROM reactions WHERE ref_id = r.id) AS reaction_total,
  (SELECT count(*)::int FROM ref_videos WHERE ref_id = r.id) AS video_count`;

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

function creatorsOf(row: Row): Creator[] {
  const list = json<Creator[]>(row.creators, []);
  return list.length ? list : [{ name: row.creator_name, id: row.creator_id ?? null }];
}

/** 제작자 목록 → creators / creator_name / creator_id 컬럼 값 */
export function creatorColumns(creators: Creator[]): { json: string; name: string; id: string | null } {
  return { json: JSON.stringify(creators), name: creators.map((c) => c.name).join(', '), id: creators[0]?.id ?? null };
}

export function mapRef(row: Row): Reference {
  return {
    id: Number(row.id),
    category: row.category,
    title: row.title,
    mapName: row.map_name ?? null,
    creatorName: row.creator_name,
    creatorId: row.creator_id ?? null,
    creators: creatorsOf(row),
    uploaderId: row.uploader_id,
    uploaderName: row.uploader_display_name ?? row.uploader_username ?? null,
    uploaderAvatar: row.uploader_avatar ?? null,
    archiveChannelId: row.archive_channel_id ?? null,
    archiveMessageId: row.archive_message_id ?? null,
    originalFilename: row.original_filename,
    originalMime: row.original_mime,
    originalSize: Number(row.original_size),
    width: Number(row.width),
    height: Number(row.height),
    previewKey: row.preview_key,
    previewWidth: Number(row.preview_width),
    previewHeight: Number(row.preview_height),
    previewSize: Number(row.preview_size),
    palette: json(row.palette, []),
    colorHist: json(row.color_hist, []),
    colorShares: json(row.color_shares, {} as Record<ColorFamily, number>),
    primaryColor: row.primary_color ?? null,
    dhash: row.dhash ?? null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    tags: json(row.tag_names, []),
    reactions: json(row.reaction_counts, {}),
    reactionTotal: Number(row.reaction_total ?? 0),
    videoCount: Number(row.video_count ?? 0),
    periodReactions: row.period_reactions === undefined ? undefined : Number(row.period_reactions),
    periodPoints: row.period_points === undefined ? undefined : Number(row.period_points),
  };
}

function buildWhere(f: SearchFilters, p: Params): string[] {
  const where: string[] = [];
  if (f.category) where.push(`r.category = ${p.add(f.category)}`);
  if (f.uploaderId) where.push(`r.uploader_id = ${p.add(f.uploaderId)}`);
  if (f.creator?.trim()) where.push(`r.creator_name ILIKE ${p.add(`%${escapeLike(f.creator.trim())}%`)}`);
  if (f.ids) where.push(`r.id = ANY(${p.add(f.ids)}::int[])`);

  if (f.q?.trim()) {
    for (const word of f.q.trim().split(/\s+/).slice(0, 8)) {
      const idMatch = /^#?(\d{1,9})$/.exec(word);
      const like = p.add(`%${escapeLike(word)}%`);
      const parts = [
        `r.title ILIKE ${like}`,
        `r.map_name ILIKE ${like}`,
        `r.creator_name ILIKE ${like}`,
        `EXISTS (SELECT 1 FROM ref_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.ref_id = r.id AND t.name ILIKE ${like})`,
      ];
      if (idMatch) parts.push(`r.id = ${p.add(Number(idMatch[1]))}`);
      where.push(`(${parts.join(' OR ')})`);
    }
  }

  if (f.tags?.length) {
    const tags = [...new Set(f.tags)];
    where.push(`r.id IN (
      SELECT rt.ref_id FROM ref_tags rt JOIN tags t ON t.id = rt.tag_id
      WHERE t.name = ANY(${p.add(tags)}::text[])
      GROUP BY rt.ref_id HAVING count(DISTINCT t.name) = ${p.add(tags.length)}
    )`);
  }

  if (f.color && COLOR_FAMILY_KEYS.includes(f.color)) {
    where.push(`COALESCE((r.color_shares->>${p.add(f.color)})::float, 0) >= ${p.add(colorFilterThreshold(f.color))}`);
  }
  return where;
}

export const refsRepo = {
  async insert(q: Queryable, r: NewReference): Promise<number> {
    const rows = await q.query<{ id: number }>(
      `INSERT INTO refs (category, title, map_name, creator_name, creator_id, creators, uploader_id,
        original_filename, original_mime, original_size, width, height,
        preview_key, preview_width, preview_height, preview_size,
        palette, color_hist, color_shares, primary_color, dhash, created_at)
       VALUES ($1,$2,$3,$4,$5,$22::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20,
         COALESCE($21::timestamptz, now()))
       RETURNING id`,
      [
        r.category,
        r.title,
        r.mapName,
        creatorColumns(r.creators).name,
        creatorColumns(r.creators).id,
        r.uploaderId,
        r.originalFilename,
        r.originalMime,
        r.originalSize,
        r.width,
        r.height,
        r.previewKey,
        r.previewWidth,
        r.previewHeight,
        r.previewSize,
        JSON.stringify(r.palette),
        JSON.stringify(r.colorHist),
        JSON.stringify(r.colorShares),
        r.primaryColor,
        r.dhash,
        r.createdAt?.toISOString() ?? null,
        creatorColumns(r.creators).json,
      ],
    );
    return Number(rows[0].id);
  },

  async setArchive(q: Queryable, id: number, channelId: string, messageId: string): Promise<void> {
    await q.query('UPDATE refs SET archive_channel_id = $2, archive_message_id = $3 WHERE id = $1', [id, channelId, messageId]);
  },

  async update(
    q: Queryable,
    id: number,
    patch: Partial<Pick<Reference, 'title' | 'mapName' | 'creators' | 'category'>>,
  ): Promise<void> {
    const p = new Params();
    const sets: string[] = [];
    if (patch.creators) {
      const c = creatorColumns(patch.creators);
      sets.push(`creators = ${p.add(c.json)}::jsonb`, `creator_name = ${p.add(c.name)}`, `creator_id = ${p.add(c.id)}`);
    }
    const cols: Record<string, string> = {
      title: 'title',
      mapName: 'map_name',
      category: 'category',
    };
    for (const [k, col] of Object.entries(cols)) {
      if (k in patch) sets.push(`${col} = ${p.add((patch as Record<string, unknown>)[k] ?? null)}`);
    }
    if (!sets.length) return;
    sets.push('updated_at = now()');
    await q.query(`UPDATE refs SET ${sets.join(', ')} WHERE id = ${p.add(id)}`, p.values);
  },

  async delete(q: Queryable, id: number): Promise<void> {
    await q.query('DELETE FROM refs WHERE id = $1', [id]);
  },

  async get(q: Queryable, id: number): Promise<Reference | null> {
    const rows = await q.query<Row>(
      `SELECT ${SELECT_COLUMNS} FROM refs r LEFT JOIN users u ON u.discord_id = r.uploader_id WHERE r.id = $1`,
      [id],
    );
    return rows[0] ? mapRef(rows[0]) : null;
  },

  async getByArchiveMessage(q: Queryable, messageId: string): Promise<Reference | null> {
    const rows = await q.query<Row>(
      `SELECT ${SELECT_COLUMNS} FROM refs r LEFT JOIN users u ON u.discord_id = r.uploader_id WHERE r.archive_message_id = $1`,
      [messageId],
    );
    return rows[0] ? mapRef(rows[0]) : null;
  },

  async search(q: Queryable, opts: SearchOptions): Promise<{ items: Reference[]; total: number }> {
    const p = new Params();
    const where = buildWhere(opts, p);
    const sort = opts.sort ?? 'newest';
    let since: string | null = null;
    if (sort === 'popular') {
      since = opts.since ? p.add(opts.since) : null;
      where.push(`EXISTS (SELECT 1 FROM reactions x WHERE x.ref_id = r.id${since ? ` AND x.created_at >= ${since}` : ''})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRows = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM refs r ${whereSql}`, p.values);
    const total = Number(countRows[0]?.n ?? 0);
    if (total === 0) return { items: [], total };

    let extra = '';
    let order: string;
    switch (sort) {
      case 'oldest':
        order = 'r.created_at ASC, r.id ASC';
        break;
      case 'popular': {
        // 반응마다 점수가 달라서(⭐ 2, 🔥 1.5, 👍 1 …) 점수 합으로 순위를 매김
        const within = `x.ref_id = r.id${since ? ` AND x.created_at >= ${since}` : ''}`;
        const w = opts.reactionWeights;
        const points = w
          ? `COALESCE(sum(COALESCE((${p.add(JSON.stringify(w.points))}::jsonb ->> x.emoji)::numeric, ${p.add(w.fallback)}::numeric)), 0)`
          : 'count(*)';
        extra = `, (SELECT count(*)::int FROM reactions x WHERE ${within}) AS period_reactions,
          (SELECT ${points} FROM reactions x WHERE ${within}) AS period_points`;
        order = 'period_points DESC, period_reactions DESC, reaction_total DESC, r.id DESC';
        break;
      }
      case 'random':
        order = opts.seed ? `md5(r.id::text || ${p.add(opts.seed)})` : 'random()';
        break;
      case 'color':
        order = opts.color ? `COALESCE((r.color_shares->>${p.add(opts.color)})::float, 0) DESC, r.id DESC` : 'r.id DESC';
        break;
      case 'ids':
        order = opts.ids ? `array_position(${p.add(opts.ids)}::int[], r.id)` : 'r.id DESC';
        break;
      default:
        order = 'r.created_at DESC, r.id DESC';
    }
    const limit = Math.min(Math.max(opts.limit ?? 24, 1), 100);
    const offset = Math.max(opts.offset ?? 0, 0);
    const rows = await q.query<Row>(
      `SELECT ${SELECT_COLUMNS}${extra}
       FROM refs r LEFT JOIN users u ON u.discord_id = r.uploader_id
       ${whereSql}
       ORDER BY ${order}
       LIMIT ${p.add(limit)} OFFSET ${p.add(offset)}`,
      p.values,
    );
    return { items: rows.map(mapRef), total };
  },

  /** 색상 유사도 계산용 가벼운 목록 */
  async colorIndex(q: Queryable): Promise<{ id: number; category: Category; colorHist: number[]; palette: PaletteColor[] }[]> {
    const rows = await q.query<Row>('SELECT id, category, color_hist, palette FROM refs');
    return rows.map((r) => ({
      id: Number(r.id),
      category: r.category,
      colorHist: json(r.color_hist, []),
      palette: json(r.palette, []),
    }));
  },

  async hashes(q: Queryable): Promise<{ id: number; dhash: string }[]> {
    const rows = await q.query<Row>('SELECT id, dhash FROM refs WHERE dhash IS NOT NULL');
    return rows.map((r) => ({ id: Number(r.id), dhash: r.dhash }));
  },

  async colorStats(q: Queryable, category?: Category): Promise<Record<ColorFamily, number>> {
    const p = new Params();
    const cols = COLOR_FAMILY_KEYS.map(
      (k) => `count(*) FILTER (WHERE COALESCE((color_shares->>${p.add(k)})::float, 0) >= ${p.add(colorFilterThreshold(k))})::int AS "${k}"`,
    );
    const where = category ? `WHERE category = ${p.add(category)}` : '';
    const rows = await q.query<Row>(`SELECT ${cols.join(', ')} FROM refs ${where}`, p.values);
    return Object.fromEntries(COLOR_FAMILY_KEYS.map((k) => [k, Number(rows[0]?.[k] ?? 0)])) as Record<ColorFamily, number>;
  },

  async categoryCounts(q: Queryable): Promise<Record<string, number>> {
    const rows = await q.query<{ category: string; n: number }>('SELECT category, count(*)::int AS n FROM refs GROUP BY category');
    return Object.fromEntries(rows.map((r) => [r.category, Number(r.n)]));
  },

  async count(q: Queryable): Promise<number> {
    const rows = await q.query<{ n: number }>('SELECT count(*)::int AS n FROM refs');
    return Number(rows[0]?.n ?? 0);
  },

  async creators(q: Queryable, prefix: string, limit = 25): Promise<string[]> {
    const rows = await q.query<{ name: string }>(
      `SELECT c->>'name' AS name FROM refs, jsonb_array_elements(refs.creators) c
       WHERE c->>'name' ILIKE $1
       GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT $2`,
      [`%${escapeLike(prefix.trim())}%`, limit],
    );
    return rows.map((r) => r.name);
  },

  /** 자동완성용: 제목/맵 이름/번호로 찾기 */
  async suggest(q: Queryable, text: string, limit = 25): Promise<{ id: number; title: string; category: Category }[]> {
    const t = text.trim();
    const idMatch = /^#?(\d{1,9})$/.exec(t);
    const rows = await q.query<Row>(
      `SELECT id, title, category FROM refs
       WHERE $1 = '' OR title ILIKE $2 OR map_name ILIKE $2 OR creator_name ILIKE $2 OR id = $3
       ORDER BY (id = $3) DESC, created_at DESC LIMIT $4`,
      [t, `%${escapeLike(t)}%`, idMatch ? Number(idMatch[1]) : -1, limit],
    );
    return rows.map((r) => ({ id: Number(r.id), title: r.title, category: r.category }));
  },
};
