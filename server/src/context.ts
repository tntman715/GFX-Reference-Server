import type { OriginalFile } from './archive/types.js';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import type { CommunityService } from './services/community.js';
import type { ReferenceService } from './services/references.js';
import type { PreviewStorage } from './storage/types.js';
import type { Reference } from './types.js';

/** API 가 디스코드 봇에게 부탁하는 기능 */
export interface BotBridge {
  isOnline(): boolean;
  /** 원본을 사용자 DM 으로 보내기 */
  sendOriginalDm(userId: string, ref: Reference, file: OriginalFile): Promise<void>;
  /** 사용자가 GFX References 서버 멤버인지 */
  isGuildMember(userId: string): Promise<boolean>;
  /** 웹/플러그인에서 반응을 끈 경우 아카이브 메시지의 디스코드 반응도 정리 (가능할 때만) */
  syncReactionRemoval?(ref: Reference, userId: string, emoji: string): Promise<void>;
  inviteInfo?(): { guildName: string | null; botName: string | null };
}

export interface AppContext {
  config: Config;
  db: Db;
  storage: PreviewStorage;
  refs: ReferenceService;
  community: CommunityService;
  bot: BotBridge | null;
}
