import type { Db } from '../db/index.js';
import { usersRepo } from '../repos/users.js';
import type { Actor, UserInfo } from '../types.js';
import { ForbiddenError, NotFoundError, UserError } from '../util/errors.js';
import { logger } from '../util/log.js';

const log = logger('reports');

export type ReportTargetType = 'ref' | 'resource' | 'showcase';
export type ReportStatus = 'open' | 'resolved' | 'dismissed';

/** 신고 이유 (화면에서 고르는 것) */
export const REPORT_REASONS = {
  duplicate: '중복 (이미 올라온 것)',
  wrong_info: '태그 · 제작자 · 이름이 틀림',
  stolen: '다른 사람 작품을 허락 없이 올림',
  inappropriate: '부적절한 내용',
  broken: '파일 · 원본이 열리지 않음',
  other: '기타',
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

export function isReportReason(v: unknown): v is ReportReason {
  return typeof v === 'string' && v in REPORT_REASONS;
}

/** 신고 대상의 간단한 정보 (알림과 관리자 화면에 씀) */
export interface ReportTarget {
  title: string;
  url: string;
  imageUrl: string | null;
  uploaderId: string;
}

export interface Report {
  id: number;
  targetType: ReportTargetType;
  targetId: number;
  reporter: { id: string; name: string | null; avatarUrl: string | null };
  reason: ReportReason;
  reasonLabel: string;
  note: string | null;
  status: ReportStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface ReportNotice {
  report: Report;
  target: ReportTarget;
  /** 관리자 화면 주소 */
  adminUrl: string;
}

type Row = Record<string, any>;

function mapRow(r: Row): Report {
  return {
    id: Number(r.id),
    targetType: r.target_type,
    targetId: Number(r.target_id),
    reporter: { id: r.reporter_id, name: r.reporter_display_name ?? r.reporter_username ?? null, avatarUrl: r.reporter_avatar ?? null },
    reason: r.reason,
    reasonLabel: REPORT_REASONS[r.reason as ReportReason] ?? r.reason,
    note: r.note ?? null,
    status: r.status,
    resolvedBy: r.resolved_by ?? null,
    resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

const SELECT = `
  SELECT p.*, u.username AS reporter_username, u.display_name AS reporter_display_name, u.avatar_url AS reporter_avatar
  FROM reports p LEFT JOIN users u ON u.discord_id = p.reporter_id`;

/**
 * 신고 받기. 누구나(로그인한 사람) 신고할 수 있고, 관리자 전용 채널에 알림이 갑니다.
 * 관리자는 사이트의 신고 목록에서 처리(삭제 등)하거나 문제 없음으로 닫습니다.
 */
export class ReportService {
  constructor(
    private readonly db: Db,
    private readonly describe: (type: ReportTargetType, id: number) => Promise<ReportTarget | null>,
    private readonly notify: () => ((notice: ReportNotice) => Promise<void>) | null,
    private readonly siteUrl: (path: string) => string,
  ) {}

  async create(type: ReportTargetType, targetId: number, reporter: UserInfo, reason: unknown, note: unknown): Promise<Report> {
    if (!isReportReason(reason)) throw new UserError('신고 이유를 골라 주세요.');
    const target = await this.describe(type, targetId);
    if (!target) throw new NotFoundError('신고할 대상을 찾을 수 없어요.');
    const cleanNote = String(note ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    if (reason === 'other' && !cleanNote) throw new UserError('기타를 골랐다면 이유를 적어 주세요.');
    const dup = await this.db.query(
      `SELECT 1 FROM reports WHERE target_type = $1 AND target_id = $2 AND reporter_id = $3 AND status = 'open'`,
      [type, targetId, reporter.id],
    );
    if (dup.length) throw new UserError('이미 신고했어요. 관리자가 확인할 때까지 기다려 주세요.', { code: 'already_reported' });

    const id = await this.db.tx(async (q) => {
      await usersRepo.upsert(q, reporter);
      const rows = await q.query<{ id: number }>(
        'INSERT INTO reports (target_type, target_id, reporter_id, reason, note) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [type, targetId, reporter.id, reason, cleanNote || null],
      );
      return Number(rows[0].id);
    });
    const report = await this.require(id);
    log.info(`신고 #${id}: ${type} #${targetId} (${reason}) by ${reporter.username}`);
    const send = this.notify();
    if (send) {
      await send({ report, target, adminUrl: this.siteUrl('#/reports') }).catch((err) => log.warn(`신고 #${id} 알림 실패`, err));
    }
    return report;
  }

  async require(id: number): Promise<Report> {
    const rows = await this.db.query<Row>(`${SELECT} WHERE p.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundError('신고를 찾을 수 없어요.');
    return mapRow(rows[0]);
  }

  async list(status: ReportStatus): Promise<Report[]> {
    const rows = await this.db.query<Row>(`${SELECT} WHERE p.status = $1 ORDER BY p.created_at DESC LIMIT 300`, [status]);
    return rows.map(mapRow);
  }

  async openCount(): Promise<number> {
    const rows = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM reports WHERE status = 'open'`);
    return Number(rows[0]?.n ?? 0);
  }

  /** 처리 완료 / 문제 없음. 같은 대상의 다른 열린 신고도 함께 닫음 */
  async close(id: number, status: 'resolved' | 'dismissed', actor: Actor): Promise<Report> {
    if (!actor.isAdmin) throw new ForbiddenError('관리자만 신고를 처리할 수 있어요.');
    const report = await this.require(id);
    await this.db.query(
      `UPDATE reports SET status = $3, resolved_by = $4, resolved_at = now()
       WHERE target_type = $1 AND target_id = $2 AND status = 'open'`,
      [report.targetType, report.targetId, status, actor.id],
    );
    return this.require(id);
  }

  target(type: ReportTargetType, id: number): Promise<ReportTarget | null> {
    return this.describe(type, id);
  }
}
