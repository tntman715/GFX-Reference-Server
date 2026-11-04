import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { LocalArchive } from '../src/archive/local.js';
import { loadConfig } from '../src/config.js';
import type { AppContext, BotBridge } from '../src/context.js';
import { type Db, openDb } from '../src/db/index.js';
import { DEFAULT_TAGS } from '../src/constants.js';
import { migrate } from '../src/db/migrate.js';
import { BoardService } from '../src/services/boards.js';
import { CommunityService } from '../src/services/community.js';
import { EditService } from '../src/services/edits.js';
import { ImportService } from '../src/services/importer.js';
import { ReferenceService } from '../src/services/references.js';
import { LocalStorage } from '../src/storage/local.js';
import type { UserInfo } from '../src/types.js';

let sharedDb: Db | null = null;

/** 테스트 사이에 DB 를 비우고 기본 태그만 남김 (PGlite 를 매번 새로 띄우면 느려서 재사용) */
async function freshDb(): Promise<Db> {
  if (!sharedDb) {
    sharedDb = await openDb({ pgliteDir: 'memory' });
    await migrate(sharedDb);
  }
  await sharedDb.exec(`
    TRUNCATE board_items, boards, edit_proposals, import_items, refs, ref_tags, reactions, users, score_adjustments, api_tokens, device_codes, kv, tags RESTART IDENTITY CASCADE;
    ${DEFAULT_TAGS.map((t) => `INSERT INTO tags (name, description, created_by) VALUES ('${t.name}', '${t.description}', 'system');`).join('\n')}
  `);
  return sharedDb;
}

export async function makeContext(env: Record<string, string> = {}, bot: BotBridge | null = null): Promise<AppContext & { tmp: string }> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    BOT_ENABLED: 'false',
    DATA_DIR: tmp,
    WEB_DIR: path.resolve(import.meta.dirname, '../../web'),
    PUBLIC_BASE_URL: 'http://localhost:3000',
    ...env,
  });
  const realDb = await freshDb();
  // 테스트에서 close() 를 불러도 공유 DB 는 닫지 않음
  const db: Db = Object.assign(Object.create(Object.getPrototypeOf(realDb)), realDb, { close: async () => undefined });
  const storage = new LocalStorage(path.join(tmp, 'previews'));
  const archive = new LocalArchive(path.join(tmp, 'originals'));
  const refs = new ReferenceService(db, storage, archive, config);
  const community = new CommunityService(db, config);
  const ctx = { config, db, storage, refs, community, bot, tmp, importer: null! as ImportService, edits: null! as EditService, boards: new BoardService(db) };
  ctx.importer = new ImportService(db, refs, () => ctx.bot?.importSource ?? null);
  ctx.edits = new EditService(
    db,
    refs,
    () => (ctx.bot?.notifyUser ? ctx.bot.notifyUser.bind(ctx.bot) : null),
    (p) => `${config.publicBaseUrl}/${p}`,
  );
  return ctx;
}

export const alice: UserInfo = { id: '100000000000000001', username: 'alice', displayName: '앨리스' };
export const bob: UserInfo = { id: '100000000000000002', username: 'bob', displayName: '밥' };
export const carol: UserInfo = { id: '100000000000000003', username: 'carol', displayName: '캐롤' };

/** 단색 배경 + 가운데 원 이미지 */
export async function makeImage(bg: string, fg?: string, opts: { w?: number; h?: number; shape?: 'circle' | 'stripes' | 'text' } = {}) {
  const w = opts.w ?? 640;
  const h = opts.h ?? 360;
  let inner = '';
  if (fg && (opts.shape ?? 'circle') === 'circle') inner = `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 3}" fill="${fg}"/>`;
  if (fg && opts.shape === 'stripes')
    inner = Array.from({ length: 8 }, (_, i) => `<rect x="${(i * w) / 8}" y="0" width="${w / 16}" height="${h}" fill="${fg}"/>`).join('');
  if (fg && opts.shape === 'text') inner = `<rect x="${w * 0.1}" y="${h * 0.6}" width="${w * 0.3}" height="${h * 0.3}" fill="${fg}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/>${inner}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export function file(buffer: Buffer, filename = 'image.png') {
  return { buffer, filename, contentType: 'image/png' };
}
