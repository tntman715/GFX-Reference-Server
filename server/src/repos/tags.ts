import type { TagGroup } from '../constants.js';
import type { Queryable } from '../db/index.js';

export interface Tag {
  id: number;
  name: string;
  description: string | null;
  count: number;
  /** 지메(gd) 태그인지 비지메(nongd) 태그인지 */
  group: TagGroup;
}

/** 레퍼런스 태그. 지메와 비지메는 태그를 따로 쓰므로 모든 조회에 태그군을 넘깁니다. */
export const tagsRepo = {
  /** group 을 비우면 두 태그군 모두 */
  async list(q: Queryable, group?: TagGroup): Promise<Tag[]> {
    const rows = await q.query<{ id: number; name: string; description: string | null; n: number; grp: TagGroup }>(
      `SELECT t.id, t.name, t.description, t.grp, count(rt.ref_id)::int AS n
       FROM tags t LEFT JOIN ref_tags rt ON rt.tag_id = t.id
       WHERE ($1::text IS NULL OR t.grp = $1)
       GROUP BY t.id ORDER BY t.id`,
      [group ?? null],
    );
    return rows.map((r) => ({ id: Number(r.id), name: r.name, description: r.description, count: Number(r.n), group: r.grp }));
  },

  async names(q: Queryable, group: TagGroup): Promise<string[]> {
    const rows = await q.query<{ name: string }>('SELECT name FROM tags WHERE grp = $1 ORDER BY id', [group]);
    return rows.map((r) => r.name);
  },

  async findByNames(q: Queryable, group: TagGroup, names: string[]): Promise<{ id: number; name: string }[]> {
    if (!names.length) return [];
    const rows = await q.query<{ id: number; name: string }>('SELECT id, name FROM tags WHERE grp = $1 AND name = ANY($2::text[])', [
      group,
      names,
    ]);
    return rows.map((r) => ({ id: Number(r.id), name: r.name }));
  },

  async add(q: Queryable, group: TagGroup, name: string, description: string | null, createdBy: string): Promise<Tag | null> {
    const rows = await q.query<{ id: number }>(
      'INSERT INTO tags (grp, name, description, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT (grp, name) DO NOTHING RETURNING id',
      [group, name, description, createdBy],
    );
    if (!rows[0]) return null;
    return { id: Number(rows[0].id), name, description, count: 0, group };
  },

  /** 없으면 만들고 번호를 돌려줌 (speedart 처럼 시스템이 붙이는 태그) */
  async ensure(q: Queryable, group: TagGroup, name: string, description: string): Promise<number> {
    await q.query(`INSERT INTO tags (grp, name, description, created_by) VALUES ($1, $2, $3, 'system') ON CONFLICT (grp, name) DO NOTHING`, [
      group,
      name,
      description,
    ]);
    const rows = await q.query<{ id: number }>('SELECT id FROM tags WHERE grp = $1 AND name = $2', [group, name]);
    return Number(rows[0].id);
  },

  async remove(q: Queryable, group: TagGroup, name: string): Promise<boolean> {
    const rows = await q.query('DELETE FROM tags WHERE grp = $1 AND name = $2 RETURNING id', [group, name]);
    return rows.length > 0;
  },

  async rename(q: Queryable, group: TagGroup, from: string, to: string): Promise<boolean> {
    const rows = await q.query('UPDATE tags SET name = $3 WHERE grp = $1 AND name = $2 RETURNING id', [group, from, to]);
    return rows.length > 0;
  },

  async setDescription(q: Queryable, group: TagGroup, name: string, description: string | null): Promise<boolean> {
    const rows = await q.query('UPDATE tags SET description = $3 WHERE grp = $1 AND name = $2 RETURNING id', [group, name, description]);
    return rows.length > 0;
  },

  async setRefTags(q: Queryable, refId: number, tagIds: number[]): Promise<void> {
    await q.query('DELETE FROM ref_tags WHERE ref_id = $1', [refId]);
    for (const tagId of new Set(tagIds)) {
      await q.query('INSERT INTO ref_tags (ref_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [refId, tagId]);
    }
  },
};
