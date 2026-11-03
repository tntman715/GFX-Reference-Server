import type { Category, ColorFamily } from './constants.js';
import type { PaletteColor } from './services/color.js';

export interface UserInfo {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface Reference {
  id: number;
  category: Category;
  title: string;
  mapName: string | null;
  creatorName: string;
  creatorId: string | null;
  uploaderId: string;
  uploaderName: string | null;
  uploaderAvatar: string | null;
  archiveChannelId: string | null;
  archiveMessageId: string | null;
  originalFilename: string;
  originalMime: string;
  originalSize: number;
  width: number;
  height: number;
  previewKey: string;
  previewWidth: number;
  previewHeight: number;
  previewSize: number;
  palette: PaletteColor[];
  colorHist: number[];
  colorShares: Record<ColorFamily, number>;
  primaryColor: ColorFamily | null;
  dhash: string | null;
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
  reactions: Record<string, number>;
  reactionTotal: number;
  /** 인기순 정렬 시 해당 기간 동안 받은 반응 수 */
  periodReactions?: number;
}

/** 외부(웹/플러그인)로 내보내는 형태 */
export interface PublicReference {
  id: number;
  category: Category;
  categoryLabel: string;
  title: string;
  mapName: string | null;
  creator: { name: string; id: string | null };
  uploader: { id: string; name: string | null; avatarUrl: string | null };
  width: number;
  height: number;
  originalSize: number;
  originalMime: string;
  preview: { url: string; width: number; height: number };
  thumbUrl: string;
  siteUrl: string;
  palette: PaletteColor[];
  primaryColor: ColorFamily | null;
  colorShares: Record<ColorFamily, number>;
  tags: string[];
  reactions: Record<string, number>;
  reactionTotal: number;
  periodReactions?: number;
  myReactions?: string[];
  createdAt: string;
}

export interface Actor {
  id: string;
  isAdmin: boolean;
}
