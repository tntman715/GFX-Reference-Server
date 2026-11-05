import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Category } from './constants.js';

/** `.env` 파일이 있으면 읽어옵니다 (Node 20.12+ 내장 기능). */
export function loadDotEnv(file = '.env'): void {
  const full = path.resolve(file);
  if (fs.existsSync(full)) process.loadEnvFile(full);
}

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  /** 사이트/API 가 외부에서 접근되는 주소 (OAuth 리다이렉트, 임베드 링크에 사용) */
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  /** 웹사이트를 다른 도메인에서 호스팅할 때 허용할 Origin 목록 */
  CORS_ORIGINS: csv,
  /** 정적 웹사이트 폴더 (기본: ../web) */
  WEB_DIR: z.string().default('../web'),
  DATA_DIR: z.string().default('./data'),

  // ── 디스코드 ────────────────────────────────────────────
  BOT_ENABLED: bool(true),
  /** 메모리가 1GB 정도인 작은 서버: 이미지 처리를 한 번에 하나씩, 임시 보관(캐시)을 작게 */
  LOW_MEMORY: bool(false),
  DISCORD_TOKEN: optionalString,
  DISCORD_CLIENT_ID: optionalString,
  DISCORD_CLIENT_SECRET: optionalString,
  /** GFX References 서버(길드) ID */
  DISCORD_GUILD_ID: optionalString,
  /** 원본 사진을 보관하는 채널 */
  ARCHIVE_CHANNEL_ID: optionalString,
  ARCHIVE_CHANNEL_GM_THUMBNAIL: optionalString,
  ARCHIVE_CHANNEL_GM_ARTWORK: optionalString,
  ARCHIVE_CHANNEL_NON_GM: optionalString,
  /** 주간 인기 썸네일을 올릴 채널 (비우면 자동 게시 안 함) */
  HIGHLIGHT_CHANNEL_ID: optionalString,
  /** 신고가 들어오면 봇이 알림을 올리는 관리자 전용 채널 */
  REPORT_CHANNEL_ID: optionalString,
  /** 에셋 · 플러그인 · 텍스쳐팩 파일을 보관할 채널 (비우면 ARCHIVE_CHANNEL_ID) */
  RESOURCE_ARCHIVE_CHANNEL_ID: optionalString,
  /** 랭킹 티어에 맞춰 디스코드 역할(다이아몬드 ~ 브론즈)을 자동으로 주기 */
  TIER_ROLES: bool(true),
  /** /업로드 를 사용할 수 있는 채널 (비우면 모든 채널) */
  UPLOAD_CHANNEL_IDS: csv,
  /** 관리자 역할 ID 목록 (서버 관리 권한이 있는 사람은 자동으로 관리자) */
  ADMIN_ROLE_IDS: csv,
  /** 웹 로그인 시 길드 멤버인지 확인할지 */
  REQUIRE_GUILD_MEMBERSHIP: bool(true),

  // ── 데이터베이스 ─────────────────────────────────────────
  /** postgres://... (비우면 DATA_DIR/pglite 에 내장 Postgres 사용) */
  DATABASE_URL: optionalString,
  DATABASE_SSL: bool(false),

  // ── 미리보기 저장소 ──────────────────────────────────────
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_ENDPOINT: optionalString,
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_PREFIX: z.string().default(''),
  /** R2 공개 버킷 / 커스텀 도메인 주소. 비우면 서버가 /api/previews 로 직접 제공 */
  PREVIEW_PUBLIC_BASE_URL: optionalString,

  /** 원본 보관 방식: discord(기본) 또는 local(디스코드 없이 테스트할 때) */
  ARCHIVE_DRIVER: z.enum(['discord', 'local']).optional(),

  // ── 업로드 / 이미지 ─────────────────────────────────────
  /** 봇이 아카이브 채널에 다시 올려야 하므로 서버 부스트 등급의 첨부 한도 이하로 (기본 10MB, 부스트 2레벨 50MB, 3레벨 100MB) */
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  PREVIEW_MAX_SIZE: z.coerce.number().int().positive().default(720),
  PREVIEW_QUALITY: z.coerce.number().int().min(30).max(100).default(72),
  /** 상세 보기용 고화질 미리보기 (긴 변 px · WebP 품질) */
  HQ_PREVIEW_MAX_SIZE: z.coerce.number().int().positive().default(1920),
  HQ_PREVIEW_QUALITY: z.coerce.number().int().min(30).max(100).default(90),
  /** 고화질 미리보기가 없는 예전 레퍼런스를 서버가 천천히 만들어 채울지 */
  HQ_BACKFILL: bool(true),
  /** dHash 해밍 거리 이하이면 중복으로 의심 (0~64, 0 이면 검사 안 함) */
  DUPLICATE_THRESHOLD: z.coerce.number().int().min(0).max(64).default(5),

  // ── 점수 / 반응 ─────────────────────────────────────────
  POINTS_PER_UPLOAD: z.coerce.number().int().default(10),
  POINTS_PER_EDIT: z.coerce.number().min(0).optional(),
  POINTS_PER_ASSET: z.coerce.number().min(0).default(10),
  /** 레퍼런스에 제작과정 유튜브 영상을 붙이면 받는 점수 */
  POINTS_PER_VIDEO: z.coerce.number().min(0).default(10),
  /** 쇼케이스에 유튜브 영상을 올리면 영상마다 받는 점수 (재생목록도 영상마다) */
  POINTS_PER_SHOWCASE: z.coerce.number().min(0).default(3),
  /** 쇼케이스 재생목록 가져오기용 유튜브 Data API 키 (없으면 영상 하나씩만) */
  YOUTUBE_API_KEY: optionalString,
  POINTS_PER_PLUGIN: z.coerce.number().min(0).default(20),
  POINTS_PER_TEXTUREPACK: z.coerce.number().min(0).default(20),
  /** 에셋 · 플러그인 · 텍스쳐팩 파일 최대 크기 (디스코드 봇 첨부 한도: 부스트 없는 서버 10MB) */
  MAX_RESOURCE_MB: z.coerce.number().positive().default(10),
  /** REACTION_POINTS 에 없는 반응의 점수 */
  POINTS_PER_REACTION: z.coerce.number().min(0).default(1),
  REACTION_EMOJIS: z.string().default('⭐,🔥,👍'),
  /** 반응별 점수 (이모지:점수, 쉼표로 구분) */
  REACTION_POINTS: z.string().default('⭐:2,🔥:1.5,👍:1'),
  WEEKLY_HIGHLIGHT: bool(true),
  /** 주간 하이라이트 기준 시간대 */
  TIMEZONE: z.string().default('Asia/Seoul'),

  // ── 인증 ────────────────────────────────────────────────
  SESSION_DAYS: z.coerce.number().int().positive().default(30),
  PLUGIN_TOKEN_DAYS: z.coerce.number().int().positive().default(180),
});

export interface Config {
  env: string;
  isProduction: boolean;
  port: number;
  host: string;
  publicBaseUrl: string;
  corsOrigins: string[];
  webDir: string;
  dataDir: string;
  discord: {
    botEnabled: boolean;
    token?: string;
    clientId?: string;
    clientSecret?: string;
    guildId?: string;
    archiveChannelId?: string;
    archiveChannels: Partial<Record<Category, string>>;
    highlightChannelId?: string;
    reportChannelId?: string;
    resourceArchiveChannelId?: string;
    tierRoles: boolean;
    uploadChannelIds: string[];
    adminRoleIds: string[];
    requireGuildMembership: boolean;
    oauthEnabled: boolean;
  };
  database: { url?: string; ssl: boolean };
  storage: {
    driver: 'local' | 's3';
    s3?: { endpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; prefix: string };
    publicBaseUrl?: string;
  };
  archiveDriver: 'discord' | 'local';
  /** 작은 서버용 절약 모드 (LOW_MEMORY) */
  lowMemory: boolean;
  upload: {
    maxBytes: number;
    previewMaxSize: number;
    previewQuality: number;
    hqMaxSize: number;
    hqQuality: number;
    hqBackfill: boolean;
    duplicateThreshold: number;
    /** 에셋 · 플러그인 · 텍스쳐팩 파일 최대 크기 */
    resourceMaxBytes: number;
  };
  scoring: ScoringConfig;
  youtube: { apiKey?: string };
  reactionEmojis: string[];
  weeklyHighlight: boolean;
  timezone: string;
  auth: { sessionDays: number; pluginTokenDays: number };
}

export interface ScoringConfig {
  pointsPerUpload: number;
  /** 수정 제안이 받아들여졌을 때 제안한 사람이 받는 점수 (기본: 업로드 점수의 절반) */
  pointsPerEdit: number;
  /** 에셋 · 플러그인 · 텍스쳐팩 올리기 점수 */
  pointsPerResource: Record<'asset' | 'plugin' | 'texturepack', number>;
  /** 제작과정 영상 붙이기 점수 */
  pointsPerVideo: number;
  /** 쇼케이스 영상 하나 올리기 점수 */
  pointsPerShowcase: number;
  /** reactionPoints 에 없는 반응의 점수 */
  pointsPerReaction: number;
  /** 반응 이모지별 점수. 설정된 반응 이모지는 모두 들어 있음 */
  reactionPoints: Record<string, number>;
}

export class ConfigError extends Error {}

/** 반응 하나가 주는 점수 */
export function reactionPoints(scoring: ScoringConfig, emoji: string): number {
  return scoring.reactionPoints[normalizeEmoji(emoji)] ?? scoring.pointsPerReaction;
}

/** "⭐ +2 · 🔥 +1.5 · 👍 +1" */
export function reactionPointsText(config: Pick<Config, 'scoring' | 'reactionEmojis'>): string {
  return config.reactionEmojis.map((e) => `${e} +${reactionPoints(config.scoring, e)}`).join(' · ');
}

function parseReactionPoints(raw: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of raw.split(',')) {
    if (!part.trim()) continue;
    const i = part.lastIndexOf(':');
    const emoji = normalizeEmoji(i > 0 ? part.slice(0, i) : '');
    const points = Number(i > 0 ? part.slice(i + 1).trim() : NaN);
    if (!emoji || !Number.isFinite(points) || points < 0) {
      throw new ConfigError(`REACTION_POINTS 형식이 올바르지 않습니다: "${part.trim()}" (예: ⭐:2,🔥:1.5,👍:1)`);
    }
    out[emoji] = points;
  }
  return out;
}

/** 이모지 비교용 정규화 (❤️ vs ❤ 처럼 variation selector 차이를 무시) */
export function normalizeEmoji(e: string): string {
  return e.replace(/️/g, '').trim();
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new ConfigError(`환경 변수 설정이 올바르지 않습니다:\n${msg}`);
  }
  const e = parsed.data;

  const botEnabled = e.BOT_ENABLED && !!e.DISCORD_TOKEN;
  const archiveDriver = e.ARCHIVE_DRIVER ?? (botEnabled ? 'discord' : 'local');

  if (archiveDriver === 'discord') {
    if (!e.DISCORD_TOKEN) throw new ConfigError('ARCHIVE_DRIVER=discord 이면 DISCORD_TOKEN 이 필요합니다.');
    if (!e.ARCHIVE_CHANNEL_ID && !(e.ARCHIVE_CHANNEL_GM_THUMBNAIL && e.ARCHIVE_CHANNEL_GM_ARTWORK && e.ARCHIVE_CHANNEL_NON_GM)) {
      throw new ConfigError('원본 보관 채널(ARCHIVE_CHANNEL_ID)을 설정해 주세요.');
    }
  }

  let s3: Config['storage']['s3'];
  if (e.STORAGE_DRIVER === 's3') {
    if (!e.S3_BUCKET || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY) {
      throw new ConfigError('STORAGE_DRIVER=s3 이면 S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY 가 필요합니다.');
    }
    s3 = {
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      bucket: e.S3_BUCKET,
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      prefix: e.S3_PREFIX.replace(/^\/+|\/+$/g, ''),
    };
  }

  const reactionEmojis = [...new Set(e.REACTION_EMOJIS.split(',').map(normalizeEmoji).filter(Boolean))];
  if (reactionEmojis.length === 0) throw new ConfigError('REACTION_EMOJIS 에 최소 1개의 이모지가 필요합니다.');
  if (reactionEmojis.length > 5) throw new ConfigError('REACTION_EMOJIS 는 최대 5개까지 설정할 수 있습니다.');
  const pointsByEmoji = parseReactionPoints(e.REACTION_POINTS);
  for (const emoji of reactionEmojis) pointsByEmoji[emoji] ??= e.POINTS_PER_REACTION;

  return {
    env: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    port: e.PORT,
    host: e.HOST,
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/+$/, ''),
    corsOrigins: e.CORS_ORIGINS,
    webDir: path.resolve(e.WEB_DIR),
    dataDir: path.resolve(e.DATA_DIR),
    discord: {
      botEnabled,
      token: e.DISCORD_TOKEN,
      clientId: e.DISCORD_CLIENT_ID,
      clientSecret: e.DISCORD_CLIENT_SECRET,
      guildId: e.DISCORD_GUILD_ID,
      archiveChannelId: e.ARCHIVE_CHANNEL_ID,
      archiveChannels: {
        gm_thumbnail: e.ARCHIVE_CHANNEL_GM_THUMBNAIL,
        gm_artwork: e.ARCHIVE_CHANNEL_GM_ARTWORK,
        non_gm: e.ARCHIVE_CHANNEL_NON_GM,
      },
      highlightChannelId: e.HIGHLIGHT_CHANNEL_ID,
      reportChannelId: e.REPORT_CHANNEL_ID,
      resourceArchiveChannelId: e.RESOURCE_ARCHIVE_CHANNEL_ID,
      tierRoles: e.TIER_ROLES,
      uploadChannelIds: e.UPLOAD_CHANNEL_IDS,
      adminRoleIds: e.ADMIN_ROLE_IDS,
      requireGuildMembership: e.REQUIRE_GUILD_MEMBERSHIP,
      oauthEnabled: !!(e.DISCORD_CLIENT_ID && e.DISCORD_CLIENT_SECRET),
    },
    database: { url: e.DATABASE_URL, ssl: e.DATABASE_SSL },
    storage: {
      driver: e.STORAGE_DRIVER,
      s3,
      publicBaseUrl: e.PREVIEW_PUBLIC_BASE_URL?.replace(/\/+$/, ''),
    },
    archiveDriver,
    lowMemory: e.LOW_MEMORY,
    upload: {
      maxBytes: Math.round(e.MAX_UPLOAD_MB * 1024 * 1024),
      previewMaxSize: e.PREVIEW_MAX_SIZE,
      previewQuality: e.PREVIEW_QUALITY,
      hqMaxSize: e.HQ_PREVIEW_MAX_SIZE,
      hqQuality: e.HQ_PREVIEW_QUALITY,
      hqBackfill: e.HQ_BACKFILL,
      duplicateThreshold: e.DUPLICATE_THRESHOLD,
      resourceMaxBytes: Math.round(e.MAX_RESOURCE_MB * 1024 * 1024),
    },
    scoring: {
      pointsPerUpload: e.POINTS_PER_UPLOAD,
      pointsPerEdit: e.POINTS_PER_EDIT ?? e.POINTS_PER_UPLOAD / 2,
      pointsPerResource: { asset: e.POINTS_PER_ASSET, plugin: e.POINTS_PER_PLUGIN, texturepack: e.POINTS_PER_TEXTUREPACK },
      pointsPerVideo: e.POINTS_PER_VIDEO,
      pointsPerShowcase: e.POINTS_PER_SHOWCASE,
      pointsPerReaction: e.POINTS_PER_REACTION,
      reactionPoints: pointsByEmoji,
    },
    youtube: { apiKey: e.YOUTUBE_API_KEY },
    reactionEmojis,
    weeklyHighlight: e.WEEKLY_HIGHLIGHT,
    timezone: e.TIMEZONE,
    auth: { sessionDays: e.SESSION_DAYS, pluginTokenDays: e.PLUGIN_TOKEN_DAYS },
  };
}
