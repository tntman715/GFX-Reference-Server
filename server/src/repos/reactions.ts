import type { Queryable } from '../db/index.js';

export const reactionsRepo = {
  async add(q: Queryable, refId: number, userId: string, emoji: string): Promise<boolean> {
    const rows = await q.query(
      'INSERT INTO reactions (ref_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING ref_id',
      [refId, userId, emoji],
    );
    return rows.length > 0;
  },

  async remove(q: Queryable, refId: number, userId: string, emoji: string): Promise<boolean> {
    const rows = await q.query('DELETE FROM reactions WHERE ref_id = $1 AND user_id = $2 AND emoji = $3 RETURNING ref_id', [
      refId,
      userId,
      emoji,
    ]);
    return rows.length > 0;
  },

  /** 반응을 켜고 끔. 결과로 켜졌는지 여부 반환 */
  async toggle(q: Queryable, refId: number, userId: string, emoji: string): Promise<boolean> {
    if (await this.remove(q, refId, userId, emoji)) return false;
    await this.add(q, refId, userId, emoji);
    return true;
  },

  async mine(q: Queryable, refIds: number[], userId: string): Promise<Map<number, string[]>> {
    const out = new Map<number, string[]>();
    if (!refIds.length) return out;
    const rows = await q.query<{ ref_id: number; emoji: string }>(
      'SELECT ref_id, emoji FROM reactions WHERE user_id = $1 AND ref_id = ANY($2::int[])',
      [userId, refIds],
    );
    for (const r of rows) {
      const id = Number(r.ref_id);
      out.set(id, [...(out.get(id) ?? []), r.emoji]);
    }
    return out;
  },

  async counts(q: Queryable, refId: number): Promise<Record<string, number>> {
    const rows = await q.query<{ emoji: string; c: number }>(
      'SELECT emoji, count(*)::int AS c FROM reactions WHERE ref_id = $1 GROUP BY emoji',
      [refId],
    );
    return Object.fromEntries(rows.map((r) => [r.emoji, Number(r.c)]));
  },
};
