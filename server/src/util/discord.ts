/** 디스코드 아바타 URL (아바타가 없으면 기본 아바타) */
export function avatarUrl(userId: string, avatarHash: string | null | undefined, size = 128): string {
  if (avatarHash) {
    const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=${size}`;
  }
  let index = 0;
  try {
    index = Number((BigInt(userId) >> 22n) % 6n);
  } catch {
    index = 0;
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export function isSnowflake(v: unknown): v is string {
  return typeof v === 'string' && /^\d{15,22}$/.test(v);
}
