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
];

function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
