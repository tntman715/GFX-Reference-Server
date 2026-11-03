import path from 'node:path';
import { LocalArchive } from './archive/local.js';
import type { Config } from './config.js';
import type { AppContext } from './context.js';
import { openDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { CommunityService } from './services/community.js';
import { ReferenceService } from './services/references.js';
import { createStorage } from './storage/index.js';

/** 설정으로부터 DB / 저장소 / 서비스를 만듭니다 (봇은 따로 붙입니다). */
export async function createContext(config: Config): Promise<AppContext> {
  const db = await openDb({
    url: config.database.url,
    ssl: config.database.ssl,
    pgliteDir: path.join(config.dataDir, 'pglite'),
  });
  await migrate(db);
  const storage = createStorage(config);
  const archive = new LocalArchive(path.join(config.dataDir, 'originals'));
  const refs = new ReferenceService(db, storage, archive, config);
  const community = new CommunityService(db, config);
  return { config, db, storage, refs, community, bot: null };
}
