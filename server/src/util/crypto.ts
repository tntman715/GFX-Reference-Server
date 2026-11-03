import crypto from 'node:crypto';

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** 헷갈리는 글자(0/O, 1/I/L)를 뺀 사람이 입력하기 쉬운 코드. 예: "KQ7M-X3PD" */
export function humanCode(groups = 2, groupLen = 4): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const parts: string[] = [];
  for (let g = 0; g < groups; g++) {
    let s = '';
    for (let i = 0; i < groupLen; i++) s += alphabet[crypto.randomInt(alphabet.length)];
    parts.push(s);
  }
  return parts.join('-');
}

export function normalizeHumanCode(input: string): string {
  const clean = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length !== 8) return clean;
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}
