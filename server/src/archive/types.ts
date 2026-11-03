import type { Reference } from '../types.js';

export interface OriginalUpload {
  buffer: Buffer;
  /** 아카이브에 저장될 파일 이름 (예: ref-12.png) */
  filename: string;
  contentType: string;
}

export interface OriginalFile {
  data: Buffer;
  contentType: string;
  filename: string;
}

/**
 * 원본 이미지 보관소.
 * 기본은 디스코드 아카이브 채널(봇이 원본을 첨부한 메시지를 올림)이고,
 * 디스코드 없이 개발할 때는 로컬 폴더를 씁니다.
 */
export interface OriginalArchive {
  readonly kind: 'discord' | 'local';
  /** 지금 원본을 가져올 수 있는 상태인지 (디스코드 봇 연결 여부) */
  isAvailable(): boolean;
  store(ref: Reference, file: OriginalUpload): Promise<{ channelId: string; messageId: string }>;
  /** 레퍼런스 정보가 바뀌었을 때 아카이브 메시지(임베드)를 갱신 */
  refresh(ref: Reference): Promise<void>;
  fetch(ref: Reference): Promise<OriginalFile | null>;
  remove(ref: Reference): Promise<void>;
}
