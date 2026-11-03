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
];

function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
