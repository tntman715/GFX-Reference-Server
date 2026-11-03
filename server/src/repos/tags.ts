import type { Queryable } from '../db/index.js';

export interface Tag {
  id: number;
  name: string;
  description: string | null;
  count: number;
}

export const tagsRepo = {
  async list(q: Queryable): Promise<Tag[]> {
    const rows = await q.query<{ id: number; name: string; description: string | null; n: number }>(
      `SELECT t.id, t.name, t.description, count(rt.ref_id)::int AS n
       FROM tags t LEFT JOIN ref_tags rt ON rt.tag_id = t.id
       GROUP BY t.id ORDER BY t.id`,
    );
    return rows.map((r) => ({ id: Number(r.id), name: r.name, description: r.description, count: Number(r.n) }));
  },

  async names(q: Queryable): Promise<string[]> {
    const rows = await q.query<{ name: string }>('SELECT name FROM tags ORDER BY id');
    return rows.map((r) => r.name);
  },

  async findByNames(q: Queryable, names: string[]): Promise<{ id: number; name: string }[]> {
    if (!names.length) return [];
    const rows = await q.query<{ id: number; name: string }>('SELECT id, name FROM tags WHERE name = ANY($1::text[])', [names]);
    return rows.map((r) => ({ id: Number(r.id), name: r.name }));
  },

  async add(q: Queryable, name: string, description: string | null, createdBy: string): Promise<Tag | null> {
    const rows = await q.query<{ id: number }>(
      'INSERT INTO tags (name, description, created_by) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING RETURNING id',
      [name, description, createdBy],
    );
    if (!rows[0]) return null;
    return { id: Number(rows[0].id), name, description, count: 0 };
  },

  async remove(q: Queryable, name: string): Promise<boolean> {
    const rows = await q.query('DELETE FROM tags WHERE name = $1 RETURNING id', [name]);
    return rows.length > 0;
  },

  async rename(q: Queryable, from: string, to: string): Promise<boolean> {
    const rows = await q.query('UPDATE tags SET name = $2 WHERE name = $1 RETURNING id', [from, to]);
    return rows.length > 0;
  },

  async setDescription(q: Queryable, name: string, description: string | null): Promise<boolean> {
    const rows = await q.query('UPDATE tags SET description = $2 WHERE name = $1 RETURNING id', [name, description]);
    return rows.length > 0;
  },

  async setRefTags(q: Queryable, refId: number, tagIds: number[]): Promise<void> {
    await q.query('DELETE FROM ref_tags WHERE ref_id = $1', [refId]);
    for (const tagId of new Set(tagIds)) {
      await q.query('INSERT INTO ref_tags (ref_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [refId, tagId]);
    }
  },
};
