import type { Queryable } from '../db/index.js';
import { logger } from '../util/log.js';

const log = logger('audit');

/** 감사 로그 한 줄: 관리자가 관리자 권한으로 한 일 */
export interface AuditEntry {
  id: number;
  actor: { id: string; name: string | null; avatarUrl: string | null };
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditInput {
  actorId: string;
  /** 예: tag.add, ref.delete, score.adjust */
  action: string;
  targetType?: string | null;
  targetId?: string | number | null;
  /** 사람이 읽는 한 줄 설명 */
  summary: string;
  detail?: Record<string, unknown> | null;
}

export const auditRepo = {
  /** 기록에 실패해도 관리자가 한 일 자체는 막지 않음 (서버 기록에만 남김) */
  async add(q: Queryable, e: AuditInput): Promise<void> {
    try {
      await q.query(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, summary, detail) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [e.actorId, e.action, e.targetType ?? null, e.targetId == null ? null : String(e.targetId), e.summary.slice(0, 500), e.detail ? JSON.stringify(e.detail) : null],
      );
    } catch (err) {
      log.warn(`감사 로그 기록 실패: ${e.action} by ${e.actorId}`, err);
    }
  },

  async list(q: Queryable, f: { actorId?: string; action?: string; limit?: number; offset?: number } = {}): Promise<{ items: AuditEntry[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.actorId) {
      params.push(f.actorId);
      where.push(`a.actor_id = $${params.length}`);
    }
    if (f.action) {
      // 'tag' 처럼 앞부분만 주면 tag.add · tag.remove 등을 모두
      params.push(f.action, `${f.action}.%`);
      where.push(`(a.action = $${params.length - 1} OR a.action LIKE $${params.length})`);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log a ${w}`, params);
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
    const offset = Math.max(f.offset ?? 0, 0);
    const rows = await q.query<{
      id: number;
      actor_id: string;
      action: string;
      target_type: string | null;
      target_id: string | null;
      summary: string;
      detail: unknown;
      created_at: Date | string;
      display_name: string | null;
      username: string | null;
      avatar_url: string | null;
    }>(
      `SELECT a.*, u.display_name, u.username, u.avatar_url FROM audit_log a LEFT JOIN users u ON u.discord_id = a.actor_id
       ${w} ORDER BY a.created_at DESC, a.id DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    return {
      total: Number(total[0]?.n ?? 0),
      items: rows.map((r) => ({
        id: Number(r.id),
        actor: { id: r.actor_id, name: r.display_name ?? r.username ?? null, avatarUrl: r.avatar_url },
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        summary: r.summary,
        detail: (typeof r.detail === 'string' ? JSON.parse(r.detail) : r.detail) as Record<string, unknown> | null,
        createdAt: new Date(r.created_at).toISOString(),
      })),
    };
  },
};
