import path from 'node:path';
import { LocalArchive } from './archive/local.js';
import { LocalResourceStore } from './archive/local-resources.js';
import type { Config } from './config.js';
import type { AppContext } from './context.js';
import { openDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { reactionsRepo } from './repos/reactions.js';
import { BoardService } from './services/boards.js';
import { CommunityService } from './services/community.js';
import { EditService } from './services/edits.js';
import { ImportService } from './services/importer.js';
import { ReferenceService } from './services/references.js';
import { ReportService } from './services/reports.js';
import { RESOURCE_KINDS, ResourceService } from './services/resources.js';
import { ShowcaseService, youtubePlaylistApi } from './services/showcase.js';
import { VideoService } from './services/videos.js';
import { createStorage } from './storage/index.js';
import { logger } from './util/log.js';

const log = logger('app');

/**
 * 반응 이모지를 바꿨을 때 예전 반응을 새 반응으로 옮김 (예전 → 새).
 * 새 이모지가 설정에 있고 예전 이모지는 없을 때만 옮깁니다.
 */
const REACTION_RENAMES: [from: string, to: string][] = [['💎', '👍']];

/** 설정으로부터 DB / 저장소 / 서비스를 만듭니다 (봇은 따로 붙입니다). */
export async function createContext(config: Config): Promise<AppContext> {
  const db = await openDb({
    url: config.database.url,
    ssl: config.database.ssl,
    pgliteDir: path.join(config.dataDir, 'pglite'),
  });
  await migrate(db);
  for (const [from, to] of REACTION_RENAMES) {
    if (config.reactionEmojis.includes(to) && !config.reactionEmojis.includes(from)) {
      const n = await reactionsRepo.renameEmoji(db, from, to);
      if (n) log.info(`예전 ${from} 반응 ${n}개를 ${to} 로 옮겼습니다.`);
    }
  }
  const storage = createStorage(config);
  const archive = new LocalArchive(path.join(config.dataDir, 'originals'));
  const refs = new ReferenceService(db, storage, archive, config);
  const community = new CommunityService(db, config);
  const ctx: AppContext = { config, db, storage, refs, community, bot: null, importer: null!, edits: null!, boards: new BoardService(db), resources: null!, reports: null!, showcase: null!, videos: new VideoService(db, refs) };
  ctx.resources = new ResourceService(db, storage, new LocalResourceStore(path.join(config.dataDir, 'resources')), config);
  ctx.showcase = createShowcase(ctx);
  ctx.reports = createReports(ctx);
  ctx.importer = new ImportService(db, refs, () => ctx.bot?.importSource ?? null);
  ctx.edits = new EditService(
    db,
    refs,
    () => (ctx.bot?.isOnline() && ctx.bot.notifyUser ? ctx.bot.notifyUser.bind(ctx.bot) : null),
    (p) => `${config.publicBaseUrl}/${p}`,
  );
  return ctx;
}

/** 쇼케이스: 유튜브 API 키가 있으면 재생목록 가져오기, 봇이 켜져 있으면 관리자 알림 · DM */
export function createShowcase(ctx: AppContext, overrides: Partial<ConstructorParameters<typeof ShowcaseService>[1]> = {}): ShowcaseService {
  const { config } = ctx;
  const api = config.youtube.apiKey ? youtubePlaylistApi(config.youtube.apiKey) : null;
  return new ShowcaseService(ctx.db, {
    pointsPerVideo: config.scoring.pointsPerShowcase,
    playlistApi: () => api,
    notifier: () => (ctx.bot?.isOnline() ? ctx.bot : null),
    siteUrl: (p) => `${config.publicBaseUrl}/${p}`,
    ...overrides,
  });
}

/** 신고: 대상 정보 찾기와 관리자 채널 알림을 붙여서 만듦 */
export function createReports(ctx: AppContext): ReportService {
  const { refs, resources, config } = ctx;
  return new ReportService(
    ctx.db,
    async (type, id) => {
      if (type === 'ref') {
        const r = await refs.get(id);
        return r ? { title: `#${r.id} ${r.title}`, url: refs.siteUrl(r), imageUrl: refs.previewUrl(r), uploaderId: r.uploaderId } : null;
      }
      if (type === 'showcase') {
        const s = await ctx.showcase.get(id);
        if (!s) return null;
        const pub = ctx.showcase.toPublic(s);
        return { title: `쇼케이스 #${s.id} ${s.title}`, url: pub.siteUrl, imageUrl: pub.thumbUrl, uploaderId: s.addedBy.id };
      }
      const r = await resources.get(id);
      if (!r) return null;
      const pub = resources.toPublic(r);
      return { title: `${RESOURCE_KINDS[r.kind].label} #${r.id} ${r.title}`, url: pub.siteUrl, imageUrl: pub.preview?.url ?? null, uploaderId: r.uploaderId };
    },
    () => (ctx.bot?.isOnline() && ctx.bot.postReport ? ctx.bot.postReport.bind(ctx.bot) : null),
    (p) => `${config.publicBaseUrl}/${p}`,
  );
}
