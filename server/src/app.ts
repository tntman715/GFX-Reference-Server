import path from 'node:path';
import { LocalArchive } from './archive/local.js';
import type { Config } from './config.js';
import type { AppContext } from './context.js';
import { openDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { reactionsRepo } from './repos/reactions.js';
import { CommunityService } from './services/community.js';
import { ReferenceService } from './services/references.js';
import { createStorage } from './storage/index.js';
import { logger } from './util/log.js';

const log = logger('app');

/**
 * 반응 이모지를 바꿨을 때 예전 반응을 새 반응으로 옮김 (예전 → 새).
 * 새 이모지가 설정에 있고 예전 이모지는 없을 때만 옮깁니다.
 */
const REACTION_RENAMES: [from: string, to: string][] = [['💎', '👍']];

/** 설정으로부터 DB / 저장소 / 서비스를 만듭니다 (봇은 따로 붙입니다). */
export async function createContext(config: Config): Promise<AppContext> {
  const db = await openDb({
    url: config.database.url,
    ssl: config.database.ssl,
    pgliteDir: path.join(config.dataDir, 'pglite'),
  });
  await migrate(db);
  for (const [from, to] of REACTION_RENAMES) {
    if (config.reactionEmojis.includes(to) && !config.reactionEmojis.includes(from)) {
      const n = await reactionsRepo.renameEmoji(db, from, to);
      if (n) log.info(`예전 ${from} 반응 ${n}개를 ${to} 로 옮겼습니다.`);
    }
  }
  const storage = createStorage(config);
  const archive = new LocalArchive(path.join(config.dataDir, 'originals'));
  const refs = new ReferenceService(db, storage, archive, config);
  const community = new CommunityService(db, config);
  return { config, db, storage, refs, community, bot: null };
}
