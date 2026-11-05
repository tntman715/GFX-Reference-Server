import { DEFAULT_TAGS } from '../constants.js';

/**
 * 순서대로 한 번씩만 적용되는 스키마 마이그레이션.
 * 이미 배포된 마이그레이션은 수정하지 말고 새 항목을 추가하세요.
 */
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'initial',
    sql: `
CREATE TABLE users (
  discord_id    TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  display_name  TEXT,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "references" 는 SQL 예약어라 refs 로 씁니다.
CREATE TABLE refs (
  id                  SERIAL PRIMARY KEY,
  category            TEXT NOT NULL CHECK (category IN ('gm_thumbnail', 'gm_artwork', 'non_gm')),
  title               TEXT NOT NULL,
  map_name            TEXT,
  creator_name        TEXT NOT NULL,
  creator_id          TEXT,
  uploader_id         TEXT NOT NULL REFERENCES users(discord_id),
  archive_channel_id  TEXT,
  archive_message_id  TEXT,
  original_filename   TEXT NOT NULL,
  original_mime       TEXT NOT NULL,
  original_size       INTEGER NOT NULL,
  width               INTEGER NOT NULL,
  height              INTEGER NOT NULL,
  preview_key         TEXT NOT NULL,
  preview_width       INTEGER NOT NULL,
  preview_height      INTEGER NOT NULL,
  preview_size        INTEGER NOT NULL,
  palette             JSONB NOT NULL DEFAULT '[]',
  color_hist          JSONB NOT NULL DEFAULT '[]',
  color_shares        JSONB NOT NULL DEFAULT '{}',
  primary_color       TEXT,
  dhash               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refs_category_idx ON refs (category);
CREATE INDEX refs_uploader_idx ON refs (uploader_id);
CREATE INDEX refs_created_idx ON refs (created_at DESC);
CREATE INDEX refs_primary_color_idx ON refs (primary_color);
CREATE UNIQUE INDEX refs_archive_msg_idx ON refs (archive_message_id) WHERE archive_message_id IS NOT NULL;

CREATE TABLE tags (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  description  TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ref_tags (
  ref_id  INTEGER NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (ref_id, tag_id)
);
CREATE INDEX ref_tags_tag_idx ON ref_tags (tag_id);

CREATE TABLE reactions (
  ref_id      INTEGER NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  emoji       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ref_id, user_id, emoji)
);
CREATE INDEX reactions_created_idx ON reactions (created_at);
CREATE INDEX reactions_user_idx ON reactions (user_id);

CREATE TABLE score_adjustments (
  id          SERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  delta       INTEGER NOT NULL,
  reason      TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX score_adjustments_user_idx ON score_adjustments (user_id);

CREATE TABLE api_tokens (
  id            SERIAL PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  user_id       TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX api_tokens_user_idx ON api_tokens (user_id);

CREATE TABLE device_codes (
  device_hash  TEXT PRIMARY KEY,
  user_code    TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'consumed')),
  user_id      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE kv (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

${DEFAULT_TAGS.map(
  (t) => `INSERT INTO tags (name, description, created_by) VALUES (${sqlString(t.name)}, ${sqlString(t.description)}, 'system');`,
).join('\n')}
`,
  },
  {
    id: 2,
    name: 'import_items',
    sql: `
-- 예전에 채팅 채널(gdfx 등)에 손으로 올리던 레퍼런스를 옮겨오기 위한 후보 목록.
-- 첨부파일 하나가 후보 하나이고, 관리자가 태그를 붙여 저장하면 refs 로 들어갑니다.
CREATE TABLE import_items (
  id             SERIAL PRIMARY KEY,
  channel_id     TEXT NOT NULL,
  message_id     TEXT NOT NULL,
  attachment_id  TEXT NOT NULL UNIQUE,
  author_id      TEXT,
  author_name    TEXT,
  posted_at      TIMESTAMPTZ NOT NULL,
  content        TEXT NOT NULL DEFAULT '',
  filename       TEXT NOT NULL,
  content_type   TEXT,
  size           INTEGER,
  width          INTEGER,
  height         INTEGER,
  map_name       TEXT,
  creator_name   TEXT,
  creator_id     TEXT,
  category       TEXT NOT NULL DEFAULT 'gm_thumbnail' CHECK (category IN ('gm_thumbnail', 'gm_artwork', 'non_gm')),
  tags           JSONB NOT NULL DEFAULT '[]',
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'imported', 'skipped')),
  ref_id         INTEGER REFERENCES refs(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX import_items_status_idx ON import_items (status, posted_at);
`,
  },
  {
    id: 3,
    name: 'creators_proposals_boards',
    sql: `
-- 여러 사람이 함께 만든 작품: [{ "name": "...", "id": "디스코드 ID 또는 null" }, ...]
-- creator_name 은 검색/정렬용으로 이름을 ", " 로 이은 값, creator_id 는 첫 제작자의 ID 로 계속 맞춰 둡니다.
ALTER TABLE refs ADD COLUMN creators JSONB NOT NULL DEFAULT '[]';
UPDATE refs SET creators = jsonb_build_array(jsonb_build_object('name', creator_name, 'id', creator_id));

-- 올린 사람이 아닌 사람이 보낸 수정 제안. 올린 사람(또는 관리자)이 받아들이면 바뀝니다.
CREATE TABLE edit_proposals (
  id           SERIAL PRIMARY KEY,
  ref_id       INTEGER NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
  proposer_id  TEXT NOT NULL REFERENCES users(discord_id),
  changes      JSONB NOT NULL,
  before       JSONB NOT NULL DEFAULT '{}',
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  decided_by   TEXT,
  decided_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX edit_proposals_ref_idx ON edit_proposals (ref_id, status);
CREATE INDEX edit_proposals_proposer_idx ON edit_proposals (proposer_id, status);

-- 개인 보드: 마음에 드는 레퍼런스를 이름 붙인 묶음으로 모아 보기
CREATE TABLE boards (
  id          SERIAL PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(discord_id),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);
CREATE TABLE board_items (
  board_id  INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  ref_id    INTEGER NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, ref_id)
);
CREATE INDEX board_items_ref_idx ON board_items (ref_id);
`,
  },
  {
    id: 4,
    name: 'import_claims',
    sql: `
-- 가져오기를 여러 사람이 함께 할 때: 지금 누가 태그를 붙이는 중인지(잠깐 맡아 두기)와
-- 누가 저장/건너뛰기를 했는지 기록
ALTER TABLE import_items ADD COLUMN claimed_by TEXT;
ALTER TABLE import_items ADD COLUMN claimed_at TIMESTAMPTZ;
ALTER TABLE import_items ADD COLUMN decided_by TEXT;
`,
  },
  {
    id: 5,
    name: 'reports_resources',
    sql: `
-- 신고: 레퍼런스나 에셋 · 플러그인 · 텍스쳐팩에 문제가 있을 때 관리자에게 알림
CREATE TABLE reports (
  id           SERIAL PRIMARY KEY,
  target_type  TEXT NOT NULL CHECK (target_type IN ('ref', 'resource')),
  target_id    INTEGER NOT NULL,
  reporter_id  TEXT NOT NULL REFERENCES users(discord_id),
  reason       TEXT NOT NULL,
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by  TEXT,
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reports_status_idx ON reports (status, created_at DESC);
CREATE INDEX reports_target_idx ON reports (target_type, target_id);

-- 에셋 · 플러그인 · 텍스쳐팩: 파일(디스코드에 보관) 또는 외부 링크 + 미리보기 사진 / 유튜브 영상
CREATE TABLE resources (
  id                  SERIAL PRIMARY KEY,
  kind                TEXT NOT NULL CHECK (kind IN ('asset', 'plugin', 'texturepack')),
  title               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  creators            JSONB NOT NULL DEFAULT '[]',
  creator_name        TEXT NOT NULL DEFAULT '',
  uploader_id         TEXT NOT NULL REFERENCES users(discord_id),
  file_name           TEXT,
  file_mime           TEXT,
  file_size           INTEGER,
  archive_channel_id  TEXT,
  archive_message_id  TEXT,
  link_url            TEXT,
  preview_key         TEXT,
  preview_width       INTEGER,
  preview_height      INTEGER,
  media               JSONB NOT NULL DEFAULT '[]',
  downloads           INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX resources_kind_idx ON resources (kind, created_at DESC);
CREATE INDEX resources_uploader_idx ON resources (uploader_id);

-- 탭(종류)마다 따로 쓰는 태그
CREATE TABLE resource_tags (
  id           SERIAL PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('asset', 'plugin', 'texturepack')),
  name         TEXT NOT NULL,
  description  TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, name)
);
CREATE TABLE resource_tag_links (
  resource_id  INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  tag_id       INTEGER NOT NULL REFERENCES resource_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (resource_id, tag_id)
);
CREATE INDEX resource_tag_links_tag_idx ON resource_tag_links (tag_id);
`,
  },
  {
    id: 6,
    name: 'ref_videos',
    sql: `
-- 레퍼런스의 제작과정(스피드아트) 유튜브 영상. 누구나(서버 멤버) 남이 올린 레퍼런스에도 붙일 수 있고,
-- 붙인 사람이 점수를 받습니다. 영상이 붙은 레퍼런스에는 speedart 태그가 자동으로 붙습니다.
CREATE TABLE ref_videos (
  id          SERIAL PRIMARY KEY,
  ref_id      INTEGER NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
  youtube_id  TEXT NOT NULL,
  title       TEXT,
  added_by    TEXT NOT NULL REFERENCES users(discord_id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ref_id, youtube_id),
  UNIQUE (ref_id, added_by)
);
CREATE INDEX ref_videos_added_by_idx ON ref_videos (added_by);
INSERT INTO tags (name, description, created_by) VALUES ('speedart', '제작과정(스피드아트) 영상이 붙어 있음', 'system')
  ON CONFLICT (name) DO NOTHING;
`,
  },
  {
    id: 7,
    name: 'hq_previews',
    sql: `
-- 상세 보기용 고화질 미리보기 (긴 변 1920px WebP). 예전 레퍼런스는 서버가 천천히 채워 넣습니다.
ALTER TABLE refs ADD COLUMN hq_key TEXT;
ALTER TABLE refs ADD COLUMN hq_width INTEGER;
ALTER TABLE refs ADD COLUMN hq_height INTEGER;
`,
  },
  {
    id: 8,
    name: 'tag_groups_showcase',
    sql: `
-- 비지메는 지메와 태그를 따로 씀 (같은 이름이 두 태그군에 하나씩 있을 수 있음)
ALTER TABLE tags ADD COLUMN grp TEXT NOT NULL DEFAULT 'gd' CHECK (grp IN ('gd', 'nongd'));
ALTER TABLE tags DROP CONSTRAINT tags_name_key;
CREATE UNIQUE INDEX tags_grp_name_idx ON tags (grp, name);

-- 비지메 레퍼런스에 달려 있던 태그는 같은 이름으로 비지메 태그군에 만들고 그쪽으로 옮김
INSERT INTO tags (grp, name, description, created_by)
  SELECT DISTINCT ON (t.name) 'nongd', t.name, t.description, t.created_by
  FROM tags t JOIN ref_tags rt ON rt.tag_id = t.id JOIN refs r ON r.id = rt.ref_id
  WHERE r.category = 'non_gm'
  ORDER BY t.name;
INSERT INTO tags (grp, name, description, created_by) VALUES ('nongd', 'speedart', '제작과정(스피드아트) 영상이 붙어 있음', 'system')
  ON CONFLICT (grp, name) DO NOTHING;
UPDATE ref_tags rt SET tag_id = n.id
  FROM refs r, tags o, tags n
  WHERE r.id = rt.ref_id AND r.category = 'non_gm' AND o.id = rt.tag_id AND o.grp = 'gd' AND n.grp = 'nongd' AND n.name = o.name;

-- 쇼케이스: 유튜브 영상만. 제목 · 제작자는 유튜브 정보 그대로, 등록한 사람이 점수를 받음
CREATE TABLE showcase_requests (
  id            SERIAL PRIMARY KEY,
  playlist_id   TEXT NOT NULL,
  title         TEXT,
  channel_name  TEXT,
  item_count    INTEGER,
  requested_by  TEXT NOT NULL REFERENCES users(discord_id),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'done', 'failed')),
  decided_by    TEXT,
  decided_at    TIMESTAMPTZ,
  imported      INTEGER NOT NULL DEFAULT 0,
  skipped       INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX showcase_requests_status_idx ON showcase_requests (status, created_at);

CREATE TABLE showcases (
  id            SERIAL PRIMARY KEY,
  youtube_id    TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  channel_name  TEXT,
  channel_url   TEXT,
  added_by      TEXT NOT NULL REFERENCES users(discord_id),
  request_id    INTEGER REFERENCES showcase_requests(id) ON DELETE SET NULL,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX showcases_added_by_idx ON showcases (added_by);
CREATE INDEX showcases_created_idx ON showcases (created_at DESC);

-- 쇼케이스 영상도 신고할 수 있게
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check CHECK (target_type IN ('ref', 'resource', 'showcase'));
`,
  },
  {
    id: 9,
    name: 'audit_log_site_stats',
    sql: `
-- 감사 로그: 관리자가 관리자 권한으로 한 일 (누가 · 언제 · 무엇을)
CREATE TABLE audit_log (
  id           SERIAL PRIMARY KEY,
  actor_id     TEXT NOT NULL,
  action       TEXT NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  summary      TEXT NOT NULL,
  detail       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, created_at DESC);

-- 방문 통계: 하루 합계 숫자만 저장 (IP · 쿠키 · 계정 같은 개인 정보는 저장하지 않음)
CREATE TABLE site_stats_daily (
  day     DATE NOT NULL,
  metric  TEXT NOT NULL,
  key     TEXT NOT NULL DEFAULT '',
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, metric, key)
);
`,
  },
];

function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
