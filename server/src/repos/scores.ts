import type { Queryable } from '../db/index.js';

export interface ScoreRow {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  uploads: number;
  reactionsReceived: number;
  adjustments: number;
  score: number;
  rank: number;
}

export interface ScoringRules {
  pointsPerUpload: number;
  pointsPerReaction: number;
}

/**
 * 점수 = 업로드 수 × 업로드 점수 + 받은 반응 수 × 반응 점수 + 관리자 조정
 * (자기 레퍼런스에 단 반응은 점수에 들어가지 않습니다)
 * 저장된 값이 아니라 매번 계산하므로 레퍼런스를 지우면 점수도 자동으로 빠집니다.
 */
function scoreCte(): string {
  return `
  WITH uploads AS (
    SELECT uploader_id AS uid, count(*)::int AS n FROM refs GROUP BY uploader_id
  ), received AS (
    SELECT r.uploader_id AS uid, count(*)::int AS n
    FROM reactions x JOIN refs r ON r.id = x.ref_id
    WHERE x.user_id <> r.uploader_id
    GROUP BY r.uploader_id
  ), adj AS (
    SELECT user_id AS uid, sum(delta)::int AS n FROM score_adjustments GROUP BY user_id
  ), scored AS (
    SELECT u.discord_id, u.username, u.display_name, u.avatar_url,
      COALESCE(up.n, 0) AS uploads,
      COALESCE(rc.n, 0) AS reactions_received,
      COALESCE(a.n, 0) AS adjustments,
      (COALESCE(up.n, 0) * $1::int + COALESCE(rc.n, 0) * $2::int + COALESCE(a.n, 0))::int AS score
    FROM users u
    LEFT JOIN uploads up ON up.uid = u.discord_id
    LEFT JOIN received rc ON rc.uid = u.discord_id
    LEFT JOIN adj a ON a.uid = u.discord_id
    WHERE COALESCE(up.n, 0) > 0 OR COALESCE(a.n, 0) <> 0
  ), ranked AS (
    SELECT *, rank() OVER (ORDER BY score DESC)::int AS rnk FROM scored
  )`;
}

type Row = {
  discord_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  uploads: number;
  reactions_received: number;
  adjustments: number;
  score: number;
  rnk: number;
};

function mapRow(r: Row): ScoreRow {
  return {
    userId: r.discord_id,
    username: r.username,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    uploads: Number(r.uploads),
    reactionsReceived: Number(r.reactions_received),
    adjustments: Number(r.adjustments),
    score: Number(r.score),
    rank: Number(r.rnk),
  };
}

export const scoresRepo = {
  async leaderboard(q: Queryable, rules: ScoringRules, limit = 10, offset = 0): Promise<{ rows: ScoreRow[]; total: number }> {
    const rows = await q.query<Row & { total: number }>(
      `${scoreCte()}
       SELECT *, count(*) OVER()::int AS total FROM ranked
       ORDER BY score DESC, uploads DESC, discord_id
       LIMIT $3 OFFSET $4`,
      [rules.pointsPerUpload, rules.pointsPerReaction, limit, offset],
    );
    let total = Number(rows[0]?.total ?? 0);
    if (!rows.length && offset > 0) {
      const c = await q.query<{ n: number }>(`${scoreCte()} SELECT count(*)::int AS n FROM ranked`, [
        rules.pointsPerUpload,
        rules.pointsPerReaction,
      ]);
      total = Number(c[0]?.n ?? 0);
    }
    return { rows: rows.map(mapRow), total };
  },

  async forUser(q: Queryable, rules: ScoringRules, userId: string): Promise<ScoreRow | null> {
    const rows = await q.query<Row>(`${scoreCte()} SELECT * FROM ranked WHERE discord_id = $3`, [
      rules.pointsPerUpload,
      rules.pointsPerReaction,
      userId,
    ]);
    return rows[0] ? mapRow(rows[0]) : null;
  },

  async adjust(q: Queryable, userId: string, delta: number, reason: string | null, createdBy: string): Promise<void> {
    await q.query('INSERT INTO score_adjustments (user_id, delta, reason, created_by) VALUES ($1, $2, $3, $4)', [
      userId,
      delta,
      reason,
      createdBy,
    ]);
  },

  async categoryBreakdown(q: Queryable, userId: string): Promise<Record<string, number>> {
    const rows = await q.query<{ category: string; n: number }>(
      'SELECT category, count(*)::int AS n FROM refs WHERE uploader_id = $1 GROUP BY category',
      [userId],
    );
    return Object.fromEntries(rows.map((r) => [r.category, Number(r.n)]));
  },
};
