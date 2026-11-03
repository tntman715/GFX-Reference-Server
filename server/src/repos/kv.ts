import type { Queryable } from '../db/index.js';

export const kvRepo = {
  async get<T>(q: Queryable, key: string): Promise<T | null> {
    const rows = await q.query<{ value: unknown }>('SELECT value FROM kv WHERE key = $1', [key]);
    if (!rows[0]) return null;
    const v = rows[0].value;
    return (typeof v === 'string' ? JSON.parse(v) : v) as T;
  },
  async set(q: Queryable, key: string, value: unknown): Promise<void> {
    await q.query(
      `INSERT INTO kv (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  },
};
