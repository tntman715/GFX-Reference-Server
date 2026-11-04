import type { Db } from '../db/index.js';
import { refsRepo } from '../repos/references.js';
import { usersRepo } from '../repos/users.js';
import type { Reference, UserInfo } from '../types.js';
import { ForbiddenError, NotFoundError, UserError } from '../util/errors.js';

export const BOARD_LIMITS = { name: 40, perUser: 100, itemsPerBoard: 2000 };

export interface Board {
  id: number;
  name: string;
  owner: { id: string; name: string | null; avatarUrl: string | null };
  count: number;
  /** 최근에 넣은 레퍼런스 몇 개 (표지용) */
  coverIds: number[];
  createdAt: string;
  updatedAt: string;
}

type Row = Record<string, any>;

const SELECT = `
  SELECT b.*, u.username AS owner_username, u.display_name AS owner_display_name, u.avatar_url AS owner_avatar,
    (SELECT count(*)::int FROM board_items i WHERE i.board_id = b.id) AS item_count,
    COALESCE((SELECT json_agg(x.ref_id) FROM (
      SELECT ref_id FROM board_items i WHERE i.board_id = b.id ORDER BY added_at DESC LIMIT 4
    ) x), '[]'::json) AS cover_ids
  FROM boards b LEFT JOIN users u ON u.discord_id = b.owner_id`;

function mapRow(r: Row): Board {
  const covers = typeof r.cover_ids === 'string' ? JSON.parse(r.cover_ids) : (r.cover_ids ?? []);
  return {
    id: Number(r.id),
    name: r.name,
    owner: { id: r.owner_id, name: r.owner_display_name ?? r.owner_username ?? null, avatarUrl: r.owner_avatar ?? null },
    count: Number(r.item_count ?? 0),
    coverIds: covers.map(Number),
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function cleanName(v: unknown): string {
  const s = String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) throw new UserError('보드 이름을 입력해 주세요.');
  if (s.length > BOARD_LIMITS.name) throw new UserError(`보드 이름은 ${BOARD_LIMITS.name}자까지 쓸 수 있어요.`);
  return s;
}

const isUnique = (err: unknown) => (err as { code?: string }).code === '23505';

/** 개인 보드: 마음에 드는 레퍼런스를 이름 붙인 묶음으로 모아 보기 (누구나 볼 수 있고, 주인만 고칠 수 있음) */
export class BoardService {
  constructor(private readonly db: Db) {}

  async listByOwner(ownerId: string, refId?: number): Promise<(Board & { has?: boolean })[]> {
    const rows = await this.db.query<Row>(
      `${SELECT.replace('FROM boards b', `${refId ? ', EXISTS (SELECT 1 FROM board_items h WHERE h.board_id = b.id AND h.ref_id = $2) AS has' : ''} FROM boards b`)}
       WHERE b.owner_id = $1 ORDER BY b.updated_at DESC, b.id DESC`,
      refId ? [ownerId, refId] : [ownerId],
    );
    return rows.map((r) => ({ ...mapRow(r), ...(refId ? { has: !!r.has } : {}) }));
  }

  async get(id: number): Promise<Board | null> {
    const rows = await this.db.query<Row>(`${SELECT} WHERE b.id = $1`, [id]);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async require(id: number): Promise<Board> {
    const b = await this.get(id);
    if (!b) throw new NotFoundError('보드를 찾을 수 없어요.');
    return b;
  }

  private async own(id: number, userId: string): Promise<Board> {
    const b = await this.require(id);
    if (b.owner.id !== userId) throw new ForbiddenError('내 보드만 고칠 수 있어요.');
    return b;
  }

  async create(user: UserInfo, name: unknown): Promise<Board> {
    const n = cleanName(name);
    const id = await this.db.tx(async (q) => {
      await usersRepo.upsert(q, user);
      const c = await q.query<{ n: number }>('SELECT count(*)::int AS n FROM boards WHERE owner_id = $1', [user.id]);
      if (Number(c[0]?.n ?? 0) >= BOARD_LIMITS.perUser) throw new UserError(`보드는 ${BOARD_LIMITS.perUser}개까지 만들 수 있어요.`);
      try {
        const rows = await q.query<{ id: number }>('INSERT INTO boards (owner_id, name) VALUES ($1, $2) RETURNING id', [user.id, n]);
        return Number(rows[0].id);
      } catch (err) {
        if (isUnique(err)) throw new UserError(`"${n}" 보드가 이미 있어요.`, { code: 'board_exists' });
        throw err;
      }
    });
    return this.require(id);
  }

  async rename(id: number, userId: string, name: unknown): Promise<Board> {
    await this.own(id, userId);
    const n = cleanName(name);
    try {
      await this.db.query('UPDATE boards SET name = $2, updated_at = now() WHERE id = $1', [id, n]);
    } catch (err) {
      if (isUnique(err)) throw new UserError(`"${n}" 보드가 이미 있어요.`, { code: 'board_exists' });
      throw err;
    }
    return this.require(id);
  }

  async delete(id: number, userId: string): Promise<void> {
    await this.own(id, userId);
    await this.db.query('DELETE FROM boards WHERE id = $1', [id]);
  }

  /** 보드에 넣거나 빼기 */
  async setItem(id: number, userId: string, refId: number, on: boolean): Promise<Board> {
    await this.own(id, userId);
    if (on) {
      const ref = await refsRepo.get(this.db, refId);
      if (!ref) throw new NotFoundError(`#${refId} 레퍼런스를 찾을 수 없습니다.`);
      const c = await this.db.query<{ n: number }>('SELECT count(*)::int AS n FROM board_items WHERE board_id = $1', [id]);
      if (Number(c[0]?.n ?? 0) >= BOARD_LIMITS.itemsPerBoard) throw new UserError(`보드 하나에 ${BOARD_LIMITS.itemsPerBoard}개까지 넣을 수 있어요.`);
      await this.db.query('INSERT INTO board_items (board_id, ref_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, refId]);
    } else {
      await this.db.query('DELETE FROM board_items WHERE board_id = $1 AND ref_id = $2', [id, refId]);
    }
    await this.db.query('UPDATE boards SET updated_at = now() WHERE id = $1', [id]);
    return this.require(id);
  }

  /** 보드 안의 레퍼런스 (최근에 넣은 것부터) */
  async items(id: number, limit: number, offset: number): Promise<{ items: Reference[]; total: number }> {
    await this.require(id);
    const all = await this.db.query<{ ref_id: number }>('SELECT ref_id FROM board_items WHERE board_id = $1 ORDER BY added_at DESC, ref_id DESC', [
      id,
    ]);
    const ids = all.map((r) => Number(r.ref_id));
    const page = ids.slice(offset, offset + limit);
    if (!page.length) return { items: [], total: ids.length };
    const { items } = await refsRepo.search(this.db, { ids: page, sort: 'ids', limit: page.length });
    return { items, total: ids.length };
  }
}
