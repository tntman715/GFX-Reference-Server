import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { logger } from '../util/log.js';

const log = logger('db');

/** 쿼리를 실행할 수 있는 대상 (DB 자체 또는 트랜잭션) */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  readonly kind: 'postgres' | 'pglite';
  /** 여러 SQL 문을 한 번에 실행 (마이그레이션용, 파라미터 없음) */
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class PostgresDb implements Db {
  readonly kind = 'postgres' as const;
  private pool: pg.Pool;

  constructor(url: string, ssl: boolean) {
    this.pool = new pg.Pool({
      connectionString: url,
      ssl: ssl ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
    this.pool.on('error', (err) => log.error('Postgres 연결 풀 오류', err));
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query(sql, params as unknown[]);
    return res.rows as T[];
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const q: Queryable = {
        query: async <R>(sql: string, params: unknown[] = []) => (await client.query(sql, params as unknown[])).rows as R[],
      };
      const result = await fn(q);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class PgliteDb implements Db {
  readonly kind = 'pglite' as const;
  /** PGlite 는 단일 연결이라 트랜잭션 중 다른 쿼리가 끼어들지 않도록 직렬화합니다. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly pg: PGlite) {}

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.serialize(async () => (await this.pg.query<T>(sql, params)).rows);
  }

  exec(sql: string): Promise<void> {
    return this.serialize(async () => {
      await this.pg.exec(sql);
    });
  }

  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    return this.serialize(() =>
      this.pg.transaction(async (t) => {
        const q: Queryable = { query: async <R>(sql: string, params: unknown[] = []) => (await t.query<R>(sql, params)).rows };
        return fn(q);
      }),
    );
  }

  async close(): Promise<void> {
    await this.pg.close();
  }
}

export interface OpenDbOptions {
  url?: string;
  ssl?: boolean;
  /** PGlite 데이터 폴더. 'memory' 면 메모리에만 저장 (테스트용) */
  pgliteDir?: string | 'memory';
}

export async function openDb(opts: OpenDbOptions): Promise<Db> {
  if (opts.url) {
    log.info('Postgres 에 연결합니다.');
    const db = new PostgresDb(opts.url, !!opts.ssl);
    await db.query('SELECT 1');
    return db;
  }
  const dir = opts.pgliteDir ?? 'memory';
  if (dir === 'memory') {
    return new PgliteDb(new PGlite());
  }
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  log.info(`내장 데이터베이스(PGlite)를 사용합니다: ${dir}`);
  const pgl = new PGlite(dir);
  await pgl.waitReady;
  return new PgliteDb(pgl);
}
