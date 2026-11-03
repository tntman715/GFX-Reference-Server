import path from 'node:path';
import { loadConfig, loadDotEnv } from '../config.js';
import { openDb } from './index.js';
import { migrate } from './migrate.js';

loadDotEnv();
const config = loadConfig();
const db = await openDb({
  url: config.database.url,
  ssl: config.database.ssl,
  pgliteDir: path.join(config.dataDir, 'pglite'),
});
const n = await migrate(db);
console.log(n ? `${n}개의 마이그레이션을 적용했습니다.` : '이미 최신 상태입니다.');
await db.close();
