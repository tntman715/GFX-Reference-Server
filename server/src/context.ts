import type { OriginalFile } from './archive/types.js';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import type { BoardService } from './services/boards.js';
import type { CommunityService } from './services/community.js';
import type { EditService } from './services/edits.js';
import type { ImportService, ImportSource } from './services/importer.js';
import type { ReferenceService } from './services/references.js';
import type { PreviewStorage } from './storage/types.js';
import type { Reference } from './types.js';

/** API 가 디스코드 봇에게 부탁하는 기능 */
export interface BotBridge {
  isOnline(): boolean;
  /** 원본을 사용자 DM 으로 보내기 */
  sendOriginalDm(userId: string, ref: Reference, file: OriginalFile): Promise<void>;
  /** 웹/플러그인에서 반응을 끈 경우 아카이브 메시지의 디스코드 반응도 정리 (가능할 때만) */
  syncReactionRemoval?(ref: Reference, userId: string, emoji: string): Promise<void>;
  inviteInfo?(): { guildName: string | null; botName: string | null };
  /** 서버 관리 권한 또는 ADMIN_ROLE_IDS 역할이 있는지 (웹 관리자 화면용) */
  isGuildAdmin?(userId: string): Promise<boolean>;
  /** 사용자에게 디스코드 DM 알림 보내기 (DM 을 막아 두었으면 조용히 실패) */
  notifyUser?(userId: string, content: string): Promise<void>;
  /** 예전 채팅 채널에서 레퍼런스를 옮겨올 때 메시지/원본을 읽는 기능 */
  importSource?: ImportSource;
}

export interface AppContext {
  config: Config;
  db: Db;
  storage: PreviewStorage;
  refs: ReferenceService;
  community: CommunityService;
  importer: ImportService;
  edits: EditService;
  boards: BoardService;
  bot: BotBridge | null;
}
