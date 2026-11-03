import path from 'node:path';
import type { Config } from '../config.js';
import { LocalStorage } from './local.js';
import { S3Storage } from './s3.js';
import type { PreviewStorage } from './types.js';

export type { PreviewStorage } from './types.js';

export function createStorage(config: Config): PreviewStorage {
  if (config.storage.driver === 's3' && config.storage.s3) {
    return new S3Storage({ ...config.storage.s3, publicBaseUrl: config.storage.publicBaseUrl });
  }
  return new LocalStorage(path.join(config.dataDir, 'previews'), config.storage.publicBaseUrl);
}
