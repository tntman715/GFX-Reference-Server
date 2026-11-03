import type { Db } from './index.js';
import { MIGRATIONS } from './migrations.js';
import { logger } from '../util/log.js';

const log = logger('migrate');

export async function migrate(db: Db): Promise<number> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const rows = await db.query<{ id: number }>('SELECT id FROM schema_migrations');
  const done = new Set(rows.map((r) => Number(r.id)));
  let applied = 0;
  for (const m of [...MIGRATIONS].sort((a, b) => a.id - b.id)) {
    if (done.has(m.id)) continue;
    log.info(`마이그레이션 적용: ${m.id}_${m.name}`);
    await db.tx(async (q) => {
      // 여러 문장을 하나씩 실행 (PGlite 의 확장 쿼리는 한 번에 한 문장만 받음)
      for (const stmt of splitSql(m.sql)) await q.query(stmt);
      await q.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [m.id, m.name]);
    });
    applied++;
  }
  return applied;
}

/** 세미콜론 기준으로 SQL 을 나눔 (작은따옴표 문자열 안의 세미콜론은 무시) */
export function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") inStr = !inStr;
    if (ch === '-' && sql[i + 1] === '-' && !inStr) {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl;
      cur += '\n';
      continue;
    }
    if (ch === ';' && !inStr) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
