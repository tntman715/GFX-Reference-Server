import { CATEGORIES, type Category, isCategory, normalizeTagName, tagGroupOf } from '../constants.js';
import type { Db } from '../db/index.js';
import { usersRepo } from '../repos/users.js';
import type { Actor, Creator, Reference, UserInfo } from '../types.js';
import { ForbiddenError, NotFoundError, UserError } from '../util/errors.js';
import { logger } from '../util/log.js';
import { auditRepo } from '../repos/audit.js';
import { LIMITS, normalizeCreators, type ReferenceService, splitCreatorNames } from './references.js';

const log = logger('edits');

/** 사이트의 수정 화면에서 보내는 값 (모두 선택) */
export interface EditInput {
  title?: string | null;
  mapName?: string | null;
  category?: string;
  /** "A, B" 처럼 쉼표로 이은 제작자 */
  creators?: string | null;
  /** 태그 전체 */
  tags?: string[];
  /** 제안할 때 올린 사람에게 남기는 한마디 */
  note?: string | null;
}

/** 바뀌는 값만 담음 */
export interface ProposalChanges {
  title?: string;
  mapName?: string | null;
  category?: Category;
  creators?: Creator[];
  addTags?: string[];
  removeTags?: string[];
}

export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

export interface EditProposal {
  id: number;
  refId: number;
  refUploaderId: string;
  proposer: { id: string; name: string | null; avatarUrl: string | null };
  changes: ProposalChanges;
  /** 제안할 때의 원래 값 (바뀌는 항목만, 태그는 전체) */
  before: { title?: string; mapName?: string | null; category?: Category; creators?: Creator[]; tags?: string[] };
  note: string | null;
  status: ProposalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/** 디스코드 DM 알림 (봇이 꺼져 있으면 null) */
export type Notify = (userId: string, content: string) => Promise<void>;

type Row = Record<string, any>;

function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function mapRow(r: Row): EditProposal {
  return {
    id: Number(r.id),
    refId: Number(r.ref_id),
    refUploaderId: r.ref_uploader_id,
    proposer: { id: r.proposer_id, name: r.proposer_display_name ?? r.proposer_username ?? null, avatarUrl: r.proposer_avatar ?? null },
    changes: json(r.changes, {}),
    before: json(r.before, {}),
    note: r.note ?? null,
    status: r.status,
    decidedBy: r.decided_by ?? null,
    decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

const SELECT = `
  SELECT p.*, r.uploader_id AS ref_uploader_id,
    u.username AS proposer_username, u.display_name AS proposer_display_name, u.avatar_url AS proposer_avatar
  FROM edit_proposals p
  JOIN refs r ON r.id = p.ref_id
  LEFT JOIN users u ON u.discord_id = p.proposer_id`;

function cleanText(v: string | null | undefined, max: number): string | null {
  const s = (v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

const sameCreators = (a: Creator[], b: Creator[]) =>
  a.length === b.length && a.every((c, i) => c.name === b[i].name && (c.id ?? null) === (b[i].id ?? null));

/**
 * 레퍼런스 수정.
 * 올린 사람과 관리자는 바로 고치고, 다른 사람은 "수정 제안"을 보냅니다.
 * 올린 사람(또는 관리자)이 제안을 받아들이면 바뀌고, 제안한 사람은 수정 점수를 받습니다.
 */
export class EditService {
  constructor(
    private readonly db: Db,
    private readonly refs: ReferenceService,
    private readonly notify: () => Notify | null,
    private readonly siteUrl: (path: string) => string,
  ) {}

  /** 입력과 지금 값을 비교해 바뀌는 것만 골라냄 (검증 포함) */
  async diff(ref: Reference, input: EditInput): Promise<{ changes: ProposalChanges; before: EditProposal['before'] }> {
    const changes: ProposalChanges = {};
    const before: EditProposal['before'] = {};

    const category = input.category ?? ref.category;
    if (!isCategory(category)) throw new UserError('잘못된 분류입니다.');
    if (category !== ref.category) {
      changes.category = category;
      before.category = ref.category;
    }
    const cat = CATEGORIES[category];

    if (input.title !== undefined) {
      const title = cleanText(input.title, LIMITS.title);
      if (!title) throw new UserError('제목을 입력해 주세요.');
      if (title !== ref.title) {
        changes.title = title;
        before.title = ref.title;
      }
    }

    let mapName = input.mapName !== undefined ? cleanText(input.mapName, LIMITS.mapName) : ref.mapName;
    if (!cat.hasMapName) mapName = null;
    if (cat.requiresMapName && !mapName) throw new UserError(`${cat.label} 는 맵 이름이 필요합니다.`, { code: 'map_required' });
    if (mapName !== ref.mapName) {
      changes.mapName = mapName;
      before.mapName = ref.mapName;
    }

    if (input.creators !== undefined) {
      const names = splitCreatorNames(input.creators);
      if (!names.length) throw new UserError('제작자를 입력해 주세요.');
      // 이름이 같은 제작자는 연결된 디스코드 계정을 그대로 둠
      const creators = normalizeCreators(
        names.map((name) => ({ name, id: ref.creators.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id ?? null })),
      );
      if (!sameCreators(creators, ref.creators)) {
        changes.creators = creators;
        before.creators = ref.creators;
      }
    }

    if (input.tags !== undefined) {
      const tags = (await this.refs.resolveTags(input.tags, tagGroupOf(category))).map((t) => t.name);
      const add = tags.filter((t) => !ref.tags.includes(t));
      const remove = ref.tags.filter((t) => !tags.includes(t));
      if (add.length) changes.addTags = add;
      if (remove.length) changes.removeTags = remove;
      if (add.length || remove.length) before.tags = ref.tags;
    }
    return { changes, before };
  }

  /**
   * 사이트에서 수정 버튼을 눌렀을 때.
   * 고칠 수 있는 사람이면 바로 바꾸고, 아니면 올린 사람에게 제안을 보냅니다.
   */
  async submit(
    refId: number,
    input: EditInput,
    user: UserInfo,
    isAdmin: boolean,
  ): Promise<{ mode: 'applied'; ref: Reference } | { mode: 'proposed'; proposal: EditProposal }> {
    const ref = await this.refs.require(refId);
    const actor: Actor = { id: user.id, isAdmin };
    const { changes, before } = await this.diff(ref, input);
    if (!Object.keys(changes).length) throw new UserError('바뀐 내용이 없어요.', { code: 'no_changes' });

    if (this.refs.canEdit(ref, actor)) {
      const updated = await this.applyChanges(ref, changes, actor);
      return { mode: 'applied', ref: updated };
    }

    const note = cleanText(input.note, 300);
    const id = await this.db.tx(async (q) => {
      await usersRepo.upsert(q, user);
      // 같은 사람이 같은 레퍼런스에 다시 제안하면 예전 제안은 새 제안으로 바꿈
      await q.query(
        `UPDATE edit_proposals SET status = 'cancelled', decided_by = $2, decided_at = now()
         WHERE ref_id = $1 AND proposer_id = $2 AND status = 'pending'`,
        [ref.id, user.id],
      );
      const rows = await q.query<{ id: number }>(
        `INSERT INTO edit_proposals (ref_id, proposer_id, changes, before, note) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5) RETURNING id`,
        [ref.id, user.id, JSON.stringify(changes), JSON.stringify(before), note],
      );
      return Number(rows[0].id);
    });
    const proposal = await this.require(id);
    log.info(`#${ref.id} 수정 제안 #${id} by ${user.username}`);
    const who = user.displayName || user.username;
    await this.send(
      ref.uploaderId,
      `✏️ **${who}** 님이 **#${ref.id} · ${ref.title}** 에 수정을 제안했어요.\n${describe(changes)}${note ? `\n> ${note}` : ''}\n확인하기: ${this.siteUrl('#/edits')}`,
    );
    return { mode: 'proposed', proposal };
  }

  private async applyChanges(ref: Reference, c: ProposalChanges, actor: Actor, audit = true): Promise<Reference> {
    return this.refs.update(
      ref.id,
      {
        ...(c.title !== undefined ? { title: c.title } : {}),
        ...(c.mapName !== undefined ? { mapName: c.mapName } : {}),
        ...(c.category !== undefined ? { category: c.category } : {}),
        ...(c.creators !== undefined ? { creators: c.creators } : {}),
        ...(c.addTags?.length ? { addTags: c.addTags } : {}),
        ...(c.removeTags?.length ? { removeTags: c.removeTags } : {}),
      },
      actor,
      { audit },
    );
  }

  async get(id: number): Promise<EditProposal | null> {
    const rows = await this.db.query<Row>(`${SELECT} WHERE p.id = $1`, [id]);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async require(id: number): Promise<EditProposal> {
    const p = await this.get(id);
    if (!p) throw new NotFoundError('수정 제안을 찾을 수 없어요.');
    return p;
  }

  /** 내가 올린 레퍼런스에 들어온 제안 (관리자가 all 이면 모든 레퍼런스) */
  async received(userId: string, opts: { all?: boolean; status?: ProposalStatus } = {}): Promise<EditProposal[]> {
    const status = opts.status ?? 'pending';
    const rows = opts.all
      ? await this.db.query<Row>(`${SELECT} WHERE p.status = $1 ORDER BY p.created_at DESC LIMIT 200`, [status])
      : await this.db.query<Row>(`${SELECT} WHERE r.uploader_id = $1 AND p.status = $2 ORDER BY p.created_at DESC LIMIT 200`, [userId, status]);
    return rows.map(mapRow);
  }

  /** 내가 보낸 제안 (최근 것부터) */
  async sent(userId: string): Promise<EditProposal[]> {
    const rows = await this.db.query<Row>(
      `${SELECT} WHERE p.proposer_id = $1 AND p.status <> 'cancelled' ORDER BY p.created_at DESC LIMIT 200`,
      [userId],
    );
    return rows.map(mapRow);
  }

  /** 이 레퍼런스에 대기 중인 제안 */
  async pendingFor(refId: number): Promise<EditProposal[]> {
    const rows = await this.db.query<Row>(`${SELECT} WHERE p.ref_id = $1 AND p.status = 'pending' ORDER BY p.created_at`, [refId]);
    return rows.map(mapRow);
  }

  /** 내가 처리해야 할 제안 수 (메뉴에 숫자로 표시) */
  async pendingCount(userId: string): Promise<number> {
    const rows = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM edit_proposals p JOIN refs r ON r.id = p.ref_id WHERE r.uploader_id = $1 AND p.status = 'pending'`,
      [userId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  private canDecide(p: EditProposal, actor: Actor): boolean {
    return actor.isAdmin || p.refUploaderId === actor.id;
  }

  async accept(id: number, actor: Actor): Promise<{ proposal: EditProposal; ref: Reference }> {
    const p = await this.require(id);
    if (!this.canDecide(p, actor)) throw new ForbiddenError('올린 사람이나 관리자만 받아들일 수 있어요.');
    if (p.status !== 'pending') throw new UserError('이미 처리된 제안이에요.', { code: 'already_decided' });
    const ref = await this.refs.require(p.refId);
    // 위에서 올린 사람 또는 관리자인지 확인했으므로 그대로 고침
    const updated = await this.applyChanges(ref, p.changes, { id: actor.id, isAdmin: true }, false);
    const rows = await this.db.query(
      `UPDATE edit_proposals SET status = 'accepted', decided_by = $2, decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING id`,
      [id, actor.id],
    );
    if (!rows.length) throw new UserError('이미 처리된 제안이에요.', { code: 'already_decided' });
    log.info(`수정 제안 #${id} 받아들임 (#${ref.id}) by ${actor.id}`);
    if (actor.id !== ref.uploaderId) {
      await auditRepo.add(this.db, {
        actorId: actor.id,
        action: 'edit.accept',
        targetType: 'ref',
        targetId: ref.id,
        summary: `다른 사람의 레퍼런스 #${ref.id} 에 온 수정 제안 #${id} 받아들임`,
        detail: { proposalId: id, proposerId: p.proposer.id, uploaderId: ref.uploaderId },
      });
    }
    await this.send(p.proposer.id, `✅ **#${ref.id} · ${updated.title}** 에 보낸 수정 제안이 받아들여졌어요! 점수를 받았어요.\n${this.siteUrl(`#/ref/${ref.id}`)}`);
    return { proposal: await this.require(id), ref: updated };
  }

  async reject(id: number, actor: Actor, reason?: string | null): Promise<EditProposal> {
    const p = await this.require(id);
    if (!this.canDecide(p, actor)) throw new ForbiddenError('올린 사람이나 관리자만 거절할 수 있어요.');
    if (p.status !== 'pending') throw new UserError('이미 처리된 제안이에요.', { code: 'already_decided' });
    await this.db.query(`UPDATE edit_proposals SET status = 'rejected', decided_by = $2, decided_at = now() WHERE id = $1`, [id, actor.id]);
    if (actor.id !== p.refUploaderId) {
      await auditRepo.add(this.db, {
        actorId: actor.id,
        action: 'edit.reject',
        targetType: 'ref',
        targetId: p.refId,
        summary: `다른 사람의 레퍼런스 #${p.refId} 에 온 수정 제안 #${id} 거절`,
        detail: { proposalId: id, proposerId: p.proposer.id, reason: reason ?? null },
      });
    }
    const ref = await this.refs.get(p.refId);
    const why = cleanText(reason, 300);
    await this.send(
      p.proposer.id,
      `↩️ **#${p.refId}${ref ? ` · ${ref.title}` : ''}** 에 보낸 수정 제안이 반영되지 않았어요.${why ? `\n> ${why}` : ''}`,
    );
    return this.require(id);
  }

  /** 제안한 사람이 거둬들이기 */
  async cancel(id: number, userId: string): Promise<EditProposal> {
    const p = await this.require(id);
    if (p.proposer.id !== userId) throw new ForbiddenError('내가 보낸 제안만 취소할 수 있어요.');
    if (p.status !== 'pending') throw new UserError('이미 처리된 제안이에요.', { code: 'already_decided' });
    await this.db.query(`UPDATE edit_proposals SET status = 'cancelled', decided_by = $2, decided_at = now() WHERE id = $1`, [id, userId]);
    return this.require(id);
  }

  private async send(userId: string, content: string) {
    const notify = this.notify();
    if (!notify) return;
    await notify(userId, content.slice(0, 1900)).catch((err) => log.warn(`DM 알림 실패 (${userId})`, err));
  }
}

/** DM 에 쓸 짧은 변경 요약 */
export function describe(c: ProposalChanges): string {
  const lines: string[] = [];
  if (c.title !== undefined) lines.push(`• 제목 → ${c.title}`);
  if (c.mapName !== undefined) lines.push(`• 맵 → ${c.mapName ?? '(없음)'}`);
  if (c.category !== undefined) lines.push(`• 분류 → ${CATEGORIES[c.category].label}`);
  if (c.creators !== undefined) lines.push(`• 제작자 → ${c.creators.map((x) => x.name).join(', ')}`);
  if (c.addTags?.length) lines.push(`• 태그 추가: ${c.addTags.map((t) => `#${normalizeTagName(t)}`).join(' ')}`);
  if (c.removeTags?.length) lines.push(`• 태그 빼기: ${c.removeTags.map((t) => `#${t}`).join(' ')}`);
  return lines.join('\n');
}
