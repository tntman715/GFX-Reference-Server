import type { Queryable } from '../db/index.js';

export const kvRepo = {
  async get<T>(q: Queryable, key: string): Promise<T | null> {
    // 드라이버가 jsonb 를 미리 풀어주면 문자열 값과 JSON 텍스트를 구분할 수 없으므로 항상 텍스트로 받아서 파싱
    const rows = await q.query<{ value: string }>('SELECT value::text AS value FROM kv WHERE key = $1', [key]);
    if (!rows[0]) return null;
    return JSON.parse(rows[0].value) as T;
  },
  async set(q: Queryable, key: string, value: unknown): Promise<void> {
    await q.query(
      `INSERT INTO kv (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  },
};
