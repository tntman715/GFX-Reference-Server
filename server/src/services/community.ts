import type { Config } from '../config.js';
import { normalizeTagName, TAG_NAME_RE } from '../constants.js';
import type { Db } from '../db/index.js';
import { authRepo } from '../repos/auth.js';
import { kvRepo } from '../repos/kv.js';
import { refsRepo } from '../repos/references.js';
import { type ScoreRow, scoresRepo } from '../repos/scores.js';
import { type Tag, tagsRepo } from '../repos/tags.js';
import { usersRepo } from '../repos/users.js';
import type { Actor, Reference, UserInfo } from '../types.js';
import { normalizeHumanCode } from '../util/crypto.js';
import { ForbiddenError, NotFoundError, UserError } from '../util/errors.js';

export interface Profile {
  user: UserInfo;
  score: ScoreRow | null;
  categories: Record<string, number>;
  recent: Reference[];
  top: Reference[];
}

/** 태그 관리, 점수/랭킹, 계정 연동 */
export class CommunityService {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
  ) {}

  // ── 태그 ────────────────────────────────────────────────

  listTags(): Promise<Tag[]> {
    return tagsRepo.list(this.db);
  }

  tagNames(): Promise<string[]> {
    return tagsRepo.names(this.db);
  }

  private validTagName(raw: string): string {
    const name = normalizeTagName(raw);
    if (!TAG_NAME_RE.test(name)) {
      throw new UserError('태그 이름은 영문 소문자/숫자/한글로 시작하고, 기호는 / + . _ - 만 쓸 수 있습니다 (최대 40자).');
    }
    return name;
  }

  async addTag(raw: string, description: string | null, actor: Actor): Promise<Tag> {
    if (!actor.isAdmin) throw new ForbiddenError('관리자만 태그를 추가할 수 있습니다.');
    const name = this.validTagName(raw);
    const tag = await tagsRepo.add(this.db, name, description?.trim() || null, actor.id);
    if (!tag) throw new UserError(`\`${name}\` 태그는 이미 있습니다.`);
    return tag;
  }

  /** 태그 지우기. 그 태그가 달려 있던 레퍼런스 번호를 돌려줌 (아카이브 메시지 갱신용) */
  async removeTag(raw: string, actor: Actor): Promise<{ refIds: number[] }> {
    if (!actor.isAdmin) throw new ForbiddenError('관리자만 태그를 삭제할 수 있습니다.');
    const name = normalizeTagName(raw);
    const refIds = await this.refIdsWithTag(name);
    const ok = await this.db.tx(async (q) => {
      if (!(await tagsRepo.remove(q, name))) return false;
      // 아직 옮기지 않은 가져오기 후보에서도 빼기
      await q.query(
        `UPDATE import_items SET tags = COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements_text(tags) x WHERE x <> $1), '[]'::jsonb)
         WHERE tags ? $1`,
        [name],
      );
      return true;
    });
    if (!ok) throw new NotFoundError(`\`${name}\` 태그가 없습니다.`);
    return { refIds };
  }

  /**
   * 태그 이름 바꾸기. 레퍼런스는 태그 번호로 연결돼 있어 모두 한꺼번에 바뀌고,
   * 아직 옮기지 않은 가져오기 후보(태그를 이름으로 저장)도 함께 바꿈.
   * 그 태그가 달린 레퍼런스 번호를 돌려줌 (아카이브 메시지 갱신용)
   */
  async renameTag(fromRaw: string, toRaw: string, actor: Actor): Promise<{ from: string; to: string; refIds: number[] }> {
    if (!actor.isAdmin) throw new ForbiddenError('관리자만 태그 이름을 바꿀 수 있습니다.');
    const from = normalizeTagName(fromRaw);
    const to = this.validTagName(toRaw);
    if (from === to) throw new UserError('새 이름이 지금 이름과 같아요.');
    const existing = await tagsRepo.findByNames(this.db, [to]);
    if (existing.length) throw new UserError(`\`${to}\` 태그가 이미 있습니다.`);
    const ok = await this.db.tx(async (q) => {
      if (!(await tagsRepo.rename(q, from, to))) return false;
      await q.query(
        `UPDATE import_items SET tags = (SELECT jsonb_agg(CASE WHEN x = $1 THEN $2 ELSE x END) FROM jsonb_array_elements_text(tags) x)
         WHERE tags ? $1`,
        [from, to],
      );
      return true;
    });
    if (!ok) throw new NotFoundError(`\`${from}\` 태그가 없습니다.`);
    return { from, to, refIds: await this.refIdsWithTag(to) };
  }

  private async refIdsWithTag(name: string): Promise<number[]> {
    const rows = await this.db.query<{ ref_id: number }>(
      'SELECT rt.ref_id FROM ref_tags rt JOIN tags t ON t.id = rt.tag_id WHERE t.name = $1 ORDER BY rt.ref_id',
      [name],
    );
    return rows.map((r) => Number(r.ref_id));
  }

  async describeTag(raw: string, description: string | null, actor: Actor): Promise<void> {
    if (!actor.isAdmin) throw new ForbiddenError('관리자만 태그 설명을 바꿀 수 있습니다.');
    const name = normalizeTagName(raw);
    if (!(await tagsRepo.setDescription(this.db, name, description?.trim() || null))) throw new NotFoundError(`\`${name}\` 태그가 없습니다.`);
  }

  // ── 점수 ────────────────────────────────────────────────

  leaderboard(page = 1, pageSize = 10) {
    const p = Math.max(1, Math.floor(page));
    return scoresRepo.leaderboard(this.db, this.config.scoring, pageSize, (p - 1) * pageSize);
  }

  score(userId: string): Promise<ScoreRow | null> {
    return scoresRepo.forUser(this.db, this.config.scoring, userId);
  }

  async adjustScore(userId: string, delta: number, reason: string | null, actor: Actor): Promise<ScoreRow | null> {
    if (!actor.isAdmin) throw new ForbiddenError('관리자만 점수를 조정할 수 있습니다.');
    if (!Number.isInteger(delta) || delta === 0) throw new UserError('0 이 아닌 정수를 입력해 주세요.');
    await scoresRepo.adjust(this.db, userId, delta, reason, actor.id);
    return this.score(userId);
  }

  async profile(userId: string): Promise<Profile> {
    const user = await usersRepo.get(this.db, userId);
    if (!user) throw new NotFoundError('사용자를 찾을 수 없습니다.');
    const [score, categories, recent, top] = await Promise.all([
      this.score(userId),
      scoresRepo.categoryBreakdown(this.db, userId),
      refsRepo.search(this.db, { uploaderId: userId, sort: 'newest', limit: 12 }),
      refsRepo.search(this.db, { uploaderId: userId, sort: 'popular', limit: 6 }),
    ]);
    return { user, score, categories, recent: recent.items, top: top.items };
  }

  upsertUser(user: UserInfo): Promise<void> {
    return usersRepo.upsert(this.db, user);
  }

  // ── 연동 ────────────────────────────────────────────────

  createDeviceCode(label: 'plugin' | 'web') {
    return authRepo.createDeviceCode(this.db, label);
  }

  /** 디스코드 /연동 명령어에서 호출 */
  async approveDeviceCode(rawCode: string, user: UserInfo): Promise<void> {
    const code = normalizeHumanCode(rawCode);
    await usersRepo.upsert(this.db, user);
    const res = await authRepo.approveDeviceCode(this.db, code, user.id);
    if (res === 'invalid') throw new UserError('코드를 찾을 수 없습니다. 플러그인/사이트에 표시된 코드를 다시 확인해 주세요.');
    if (res === 'expired') throw new UserError('코드가 만료되었습니다. 새 코드를 받아 주세요.');
    if (res === 'used') throw new UserError('이미 사용된 코드입니다.');
  }

  pollDeviceCode(deviceCode: string) {
    return this.db.tx((q) =>
      authRepo.pollDeviceCode(q, deviceCode, (label) =>
        label === 'plugin' ? this.config.auth.pluginTokenDays : this.config.auth.sessionDays,
      ),
    );
  }

  async createSession(user: UserInfo, label: string): Promise<string> {
    await usersRepo.upsert(this.db, user);
    return authRepo.createToken(this.db, user.id, label, this.config.auth.sessionDays);
  }

  userForToken(token: string) {
    return authRepo.userForToken(this.db, token);
  }

  revokeToken(token: string) {
    return authRepo.revokeToken(this.db, token);
  }

  revokeAllTokens(userId: string) {
    return authRepo.revokeAll(this.db, userId);
  }

  // ── 기타 ────────────────────────────────────────────────

  kvGet<T>(key: string) {
    return kvRepo.get<T>(this.db, key);
  }

  kvSet(key: string, value: unknown) {
    return kvRepo.set(this.db, key, value);
  }

  async stats() {
    const [total, categories] = await Promise.all([refsRepo.count(this.db), refsRepo.categoryCounts(this.db)]);
    return { total, categories };
  }
}
