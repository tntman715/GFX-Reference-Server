import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { isSafeKey, type PreviewStorage } from './types.js';

export interface S3Options {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
  publicBaseUrl?: string;
}

/**
 * S3 호환 저장소 (Cloudflare R2 / Backblaze B2 / MinIO …)
 * R2 예: endpoint = https://<ACCOUNT_ID>.r2.cloudflarestorage.com, region = auto
 */
export class S3Storage implements PreviewStorage {
  readonly kind = 's3';
  private client: S3Client;

  constructor(private readonly opts: S3Options) {
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      forcePathStyle: !!opts.endpoint,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }

  private objectKey(key: string): string {
    if (!isSafeKey(key)) throw new Error(`잘못된 저장소 키: ${key}`);
    return this.opts.prefix ? `${this.opts.prefix}/${key}` : key;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: this.objectKey(key),
        Body: data,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async get(key: string) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: this.objectKey(key) }));
      if (!res.Body) return null;
      const bytes = await res.Body.transformToByteArray();
      return { data: Buffer.from(bytes), contentType: res.ContentType ?? 'application/octet-stream' };
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string }).name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: this.objectKey(key) }));
  }

  publicUrl(key: string): string | null {
    return this.opts.publicBaseUrl ? `${this.opts.publicBaseUrl}/${this.objectKey(key)}` : null;
  }
}
