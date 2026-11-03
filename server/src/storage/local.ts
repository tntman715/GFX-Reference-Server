import fs from 'node:fs/promises';
import path from 'node:path';
import { isSafeKey, type PreviewStorage } from './types.js';

const TYPES: Record<string, string> = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png' };

/** 서버 디스크에 미리보기를 저장 (개발용 / 자체 서버용) */
export class LocalStorage implements PreviewStorage {
  readonly kind = 'local';
  constructor(
    private readonly root: string,
    private readonly publicBase?: string,
  ) {}

  private file(key: string): string {
    if (!isSafeKey(key)) throw new Error(`잘못된 저장소 키: ${key}`);
    return path.join(this.root, key);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, data);
  }

  async get(key: string) {
    try {
      const data = await fs.readFile(this.file(key));
      return { data, contentType: TYPES[path.extname(key)] ?? 'application/octet-stream' };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.file(key), { force: true });
  }

  publicUrl(key: string): string | null {
    return this.publicBase ? `${this.publicBase}/${key}` : null;
  }
}
