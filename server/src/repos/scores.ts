import type { Queryable } from '../db/index.js';
import { type TierKey, tierFor } from '../tiers.js';

export interface ScoreRow {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  uploads: number;
  /** 에셋 · 플러그인 · 텍스쳐팩 올린 수 */
  resourceUploads: number;
  /** 붙인 제작과정 영상 수 */
  videos: number;
  /** 쇼케이스에 올린 영상 수 */
  showcases: number;
  /** 받아들여진 수정 제안 수 */
  acceptedEdits: number;
  reactionsReceived: number;
  adjustments: number;
  score: number;
  rank: number;
  /** 상대평가 티어 (5위 안 다이아몬드, 상위 20% 티타늄 …) */
  tier: TierKey;
}

export interface ScoringRules {
  pointsPerUpload: number;
  pointsPerEdit: number;
  pointsPerResource: Record<'asset' | 'plugin' | 'texturepack', number>;
  pointsPerVideo: number;
  pointsPerShowcase: number;
  /** reactionPoints 에 없는 반응의 점수 */
  pointsPerReaction: number;
  /** 반응 이모지별 점수 (예: ⭐ 2, 🔥 1.5, 👍 1) */
  reactionPoints: Record<string, number>;
}

/**
 * 점수 = 업로드 수 × 업로드 점수 + 받아들여진 수정 제안 × 수정 점수 + 받은 반응마다 그 반응의 점수 + 관리자 조정
 * (자기 레퍼런스에 단 반응은 점수에 들어가지 않습니다)
 * 저장된 값이 아니라 매번 계산하므로 레퍼런스를 지우면 점수도 자동으로 빠집니다.
 * 매개변수: $1 업로드 점수, $2 반응별 점수(JSON), $3 그 밖의 반응 점수, $4 수정 점수, $5~$7 에셋/플러그인/텍스쳐팩 점수, $8 제작과정 영상 점수, $9 쇼케이스 영상 점수
 */
function scoreCte(): string {
  return `
  WITH uploads AS (
    SELECT uploader_id AS uid, count(*)::int AS n FROM refs GROUP BY uploader_id
  ), received AS (
    SELECT r.uploader_id AS uid, count(*)::int AS n,
      sum(COALESCE((($2::jsonb) ->> x.emoji)::numeric, $3::numeric)) AS pts
    FROM reactions x JOIN refs r ON r.id = x.ref_id
    WHERE x.user_id <> r.uploader_id
    GROUP BY r.uploader_id
  ), res AS (
    SELECT uploader_id AS uid, count(*)::int AS n,
      sum(CASE kind WHEN 'asset' THEN $5::numeric WHEN 'plugin' THEN $6::numeric ELSE $7::numeric END) AS pts
    FROM resources GROUP BY uploader_id
  ), vids AS (
    SELECT added_by AS uid, count(*)::int AS n FROM ref_videos GROUP BY added_by
  ), shows AS (
    SELECT added_by AS uid, count(*)::int AS n FROM showcases GROUP BY added_by
  ), edits AS (
    SELECT proposer_id AS uid, count(*)::int AS n FROM edit_proposals WHERE status = 'accepted' GROUP BY proposer_id
  ), adj AS (
    SELECT user_id AS uid, sum(delta)::int AS n FROM score_adjustments GROUP BY user_id
  ), scored AS (
    SELECT u.discord_id, u.username, u.display_name, u.avatar_url,
      COALESCE(up.n, 0) AS uploads,
      COALESCE(ed.n, 0) AS accepted_edits,
      COALESCE(rs.n, 0) AS resource_uploads,
      COALESCE(vd.n, 0) AS videos,
      COALESCE(sh.n, 0) AS showcases,
      COALESCE(rc.n, 0) AS reactions_received,
      COALESCE(a.n, 0) AS adjustments,
      round(COALESCE(up.n, 0) * $1::numeric + COALESCE(ed.n, 0) * $4::numeric + COALESCE(rs.pts, 0) + COALESCE(vd.n, 0) * $8::numeric
        + COALESCE(sh.n, 0) * $9::numeric + COALESCE(rc.pts, 0) + COALESCE(a.n, 0), 2) AS score
    FROM users u
    LEFT JOIN uploads up ON up.uid = u.discord_id
    LEFT JOIN received rc ON rc.uid = u.discord_id
    LEFT JOIN edits ed ON ed.uid = u.discord_id
    LEFT JOIN res rs ON rs.uid = u.discord_id
    LEFT JOIN vids vd ON vd.uid = u.discord_id
    LEFT JOIN shows sh ON sh.uid = u.discord_id
    LEFT JOIN adj a ON a.uid = u.discord_id
    WHERE COALESCE(up.n, 0) > 0 OR COALESCE(rs.n, 0) > 0 OR COALESCE(vd.n, 0) > 0 OR COALESCE(sh.n, 0) > 0 OR COALESCE(ed.n, 0) > 0
      OR COALESCE(a.n, 0) <> 0
  ), ranked AS (
    SELECT *, rank() OVER (ORDER BY score DESC)::int AS rnk, count(*) OVER ()::int AS n_ranked FROM scored
  )`;
}

type Row = {
  discord_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  uploads: number;
  accepted_edits: number;
  resource_uploads: number;
  videos: number;
  showcases: number;
  reactions_received: number;
  adjustments: number;
  score: number;
  rnk: number;
  n_ranked: number;
};

function mapRow(r: Row): ScoreRow {
  return {
    userId: r.discord_id,
    username: r.username,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    uploads: Number(r.uploads),
    acceptedEdits: Number(r.accepted_edits),
    resourceUploads: Number(r.resource_uploads),
    videos: Number(r.videos),
    showcases: Number(r.showcases ?? 0),
    reactionsReceived: Number(r.reactions_received),
    adjustments: Number(r.adjustments),
    score: Number(r.score),
    rank: Number(r.rnk),
    tier: tierFor(Number(r.rnk), Number(r.n_ranked)),
  };
}

function params(rules: ScoringRules): [number, string, number, number, number, number, number, number, number] {
  const r = rules.pointsPerResource;
  return [
    rules.pointsPerUpload,
    JSON.stringify(rules.reactionPoints),
    rules.pointsPerReaction,
    rules.pointsPerEdit,
    r.asset,
    r.plugin,
    r.texturepack,
    rules.pointsPerVideo,
    rules.pointsPerShowcase,
  ];
}

export const scoresRepo = {
  async leaderboard(q: Queryable, rules: ScoringRules, limit = 10, offset = 0): Promise<{ rows: ScoreRow[]; total: number }> {
    const rows = await q.query<Row & { total: number }>(
      `${scoreCte()}
       SELECT *, count(*) OVER()::int AS total FROM ranked
       ORDER BY score DESC, uploads DESC, discord_id
       LIMIT $10 OFFSET $11`,
      [...params(rules), limit, offset],
    );
    let total = Number(rows[0]?.total ?? 0);
    if (!rows.length && offset > 0) {
      const c = await q.query<{ n: number }>(`${scoreCte()} SELECT count(*)::int AS n FROM ranked`, params(rules));
      total = Number(c[0]?.n ?? 0);
    }
    return { rows: rows.map(mapRow), total };
  },

  async forUser(q: Queryable, rules: ScoringRules, userId: string): Promise<ScoreRow | null> {
    const rows = await q.query<Row>(`${scoreCte()} SELECT * FROM ranked WHERE discord_id = $10`, [...params(rules), userId]);
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
