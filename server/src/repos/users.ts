import type { Queryable } from '../db/index.js';
import type { UserInfo } from '../types.js';

export const usersRepo = {
  async upsert(q: Queryable, u: UserInfo): Promise<void> {
    await q.query(
      `INSERT INTO users (discord_id, username, display_name, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (discord_id) DO UPDATE SET
         username = EXCLUDED.username,
         display_name = COALESCE(EXCLUDED.display_name, users.display_name),
         avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
         updated_at = now()`,
      [u.id, u.username, u.displayName ?? null, u.avatarUrl ?? null],
    );
  },

  async get(q: Queryable, id: string): Promise<UserInfo | null> {
    const rows = await q.query<{ discord_id: string; username: string; display_name: string | null; avatar_url: string | null }>(
      'SELECT discord_id, username, display_name, avatar_url FROM users WHERE discord_id = $1',
      [id],
    );
    const r = rows[0];
    return r ? { id: r.discord_id, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url } : null;
  },
};
