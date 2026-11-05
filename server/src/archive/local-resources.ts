import fs from 'node:fs/promises';
import path from 'node:path';
import type { Resource, ResourceFileStore } from '../services/resources.js';
import type { OriginalFile } from './types.js';

/** 디스코드 없이 테스트할 때 에셋 · 플러그인 · 텍스쳐팩 파일을 로컬 폴더에 보관 */
export class LocalResourceStore implements ResourceFileStore {
  readonly kind = 'local' as const;
  constructor(private readonly root: string) {}

  isAvailable(): boolean {
    return true;
  }

  private dir(id: number): string {
    return path.join(this.root, String(id));
  }

  async store(res: Resource, file: { buffer: Buffer; filename: string; contentType: string }) {
    const dir = this.dir(res.id);
    await fs.mkdir(dir, { recursive: true });
    const name = path.basename(file.filename);
    await fs.writeFile(path.join(dir, name), file.buffer);
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ filename: name, contentType: file.contentType }));
    return { channelId: 'local', messageId: `local-res-${res.id}` };
  }

  async fetch(res: Resource): Promise<OriginalFile | null> {
    try {
      const meta = JSON.parse(await fs.readFile(path.join(this.dir(res.id), 'meta.json'), 'utf8')) as { filename: string; contentType: string };
      const data = await fs.readFile(path.join(this.dir(res.id), meta.filename));
      return { data, contentType: meta.contentType, filename: meta.filename };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async remove(res: Resource): Promise<void> {
    await fs.rm(this.dir(res.id), { recursive: true, force: true });
  }
}
