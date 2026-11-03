import type { Queryable } from '../db/index.js';
import type { UserInfo } from '../types.js';
import { humanCode, randomToken, sha256 } from '../util/crypto.js';

export type DeviceStatus = 'pending' | 'approved' | 'consumed' | 'expired' | 'invalid';

export const authRepo = {
  async createToken(q: Queryable, userId: string, label: string, days: number): Promise<string> {
    const token = randomToken(32);
    await q.query(
      `INSERT INTO api_tokens (token_hash, user_id, label, expires_at) VALUES ($1, $2, $3, now() + ($4::int * interval '1 day'))`,
      [sha256(token), userId, label, days],
    );
    return token;
  },

  async userForToken(q: Queryable, token: string): Promise<(UserInfo & { tokenLabel: string }) | null> {
    const rows = await q.query<{
      discord_id: string;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
      label: string;
      stale: boolean;
    }>(
      `SELECT u.discord_id, u.username, u.display_name, u.avatar_url, t.label,
         (t.last_used_at IS NULL OR t.last_used_at < now() - interval '1 hour') AS stale
       FROM api_tokens t JOIN users u ON u.discord_id = t.user_id
       WHERE t.token_hash = $1 AND t.expires_at > now()`,
      [sha256(token)],
    );
    const r = rows[0];
    if (!r) return null;
    if (r.stale) await q.query('UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1', [sha256(token)]);
    return { id: r.discord_id, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url, tokenLabel: r.label };
  },

  async revokeToken(q: Queryable, token: string): Promise<void> {
    await q.query('DELETE FROM api_tokens WHERE token_hash = $1', [sha256(token)]);
  },

  async revokeAll(q: Queryable, userId: string): Promise<number> {
    const rows = await q.query('DELETE FROM api_tokens WHERE user_id = $1 RETURNING id', [userId]);
    return rows.length;
  },

  /** 기기 연동 코드 발급 (플러그인/사이트 → 디스코드에서 /연동 으로 승인) */
  async createDeviceCode(q: Queryable, label: string, ttlSeconds = 600): Promise<{ deviceCode: string; userCode: string; expiresAt: Date }> {
    await q.query("DELETE FROM device_codes WHERE expires_at < now() - interval '1 hour'");
    for (let attempt = 0; attempt < 5; attempt++) {
      const deviceCode = randomToken(32);
      const userCode = humanCode();
      const rows = await q.query<{ expires_at: Date }>(
        `INSERT INTO device_codes (device_hash, user_code, label, expires_at)
         VALUES ($1, $2, $3, now() + ($4::int * interval '1 second'))
         ON CONFLICT DO NOTHING RETURNING expires_at`,
        [sha256(deviceCode), userCode, label, ttlSeconds],
      );
      if (rows[0]) return { deviceCode, userCode, expiresAt: new Date(rows[0].expires_at) };
    }
    throw new Error('연동 코드를 만들지 못했습니다.');
  },

  async approveDeviceCode(q: Queryable, userCode: string, userId: string): Promise<'ok' | 'invalid' | 'expired' | 'used'> {
    const rows = await q.query<{ status: string; expired: boolean }>(
      'SELECT status, expires_at < now() AS expired FROM device_codes WHERE user_code = $1',
      [userCode],
    );
    const r = rows[0];
    if (!r) return 'invalid';
    if (r.expired) return 'expired';
    if (r.status !== 'pending') return 'used';
    await q.query("UPDATE device_codes SET status = 'approved', user_id = $2 WHERE user_code = $1", [userCode, userId]);
    return 'ok';
  },

  /** 승인되었으면 토큰을 발급하고 코드를 소진 처리 */
  async pollDeviceCode(
    q: Queryable,
    deviceCode: string,
    tokenDays: (label: string) => number,
  ): Promise<{ status: DeviceStatus; token?: string; userId?: string; label?: string }> {
    const hash = sha256(deviceCode);
    const rows = await q.query<{ status: string; user_id: string | null; label: string; expired: boolean }>(
      'SELECT status, user_id, label, expires_at < now() AS expired FROM device_codes WHERE device_hash = $1',
      [hash],
    );
    const r = rows[0];
    if (!r) return { status: 'invalid' };
    if (r.status === 'consumed') return { status: 'consumed' };
    if (r.status === 'approved' && r.user_id) {
      const claimed = await q.query("UPDATE device_codes SET status = 'consumed' WHERE device_hash = $1 AND status = 'approved' RETURNING 1", [
        hash,
      ]);
      if (!claimed.length) return { status: 'consumed' };
      const token = await authRepo.createToken(q, r.user_id, r.label, tokenDays(r.label));
      return { status: 'approved', token, userId: r.user_id, label: r.label };
    }
    if (r.expired) return { status: 'expired' };
    return { status: 'pending' };
  },
};
