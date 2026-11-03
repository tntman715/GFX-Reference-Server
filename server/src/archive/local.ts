import fs from 'node:fs/promises';
import path from 'node:path';
import type { Reference } from '../types.js';
import type { OriginalArchive, OriginalFile, OriginalUpload } from './types.js';

/** 디스코드 없이 테스트할 때 원본을 로컬 폴더에 보관 */
export class LocalArchive implements OriginalArchive {
  readonly kind = 'local' as const;
  constructor(private readonly root: string) {}

  isAvailable(): boolean {
    return true;
  }

  private dir(id: number): string {
    return path.join(this.root, String(id));
  }

  async store(ref: Reference, file: OriginalUpload) {
    const dir = this.dir(ref.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, path.basename(file.filename)), file.buffer);
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ filename: path.basename(file.filename), contentType: file.contentType }));
    return { channelId: 'local', messageId: `local-${ref.id}` };
  }

  async refresh(): Promise<void> {}

  async fetch(ref: Reference): Promise<OriginalFile | null> {
    try {
      const meta = JSON.parse(await fs.readFile(path.join(this.dir(ref.id), 'meta.json'), 'utf8')) as {
        filename: string;
        contentType: string;
      };
      const data = await fs.readFile(path.join(this.dir(ref.id), meta.filename));
      return { data, contentType: meta.contentType, filename: meta.filename };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async remove(ref: Reference): Promise<void> {
    await fs.rm(this.dir(ref.id), { recursive: true, force: true });
  }
}
