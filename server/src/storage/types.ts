/** 미리보기(압축 이미지) 저장소. 무료 10GB 를 주는 Cloudflare R2 등 S3 호환 서비스를 권장합니다. */
export interface PreviewStorage {
  readonly kind: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
  /** 공개 URL 이 있으면 반환 (없으면 서버가 /api/previews 로 중계) */
  publicUrl(key: string): string | null;
}

export function isSafeKey(key: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,200}$/.test(key) && !key.includes('..');
}
