import { serve } from '@hono/node-server';
import { createApi } from './api/app.js';
import { createContext } from './app.js';
import { BotRuntime } from './bot/runtime.js';
import { ConfigError, loadConfig, loadDotEnv } from './config.js';
import { logger } from './util/log.js';

const log = logger('main');

async function main() {
  loadDotEnv();
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n${err.message}\n\n.env.example 을 참고해 .env 파일을 설정해 주세요.\n`);
      process.exit(1);
    }
    throw err;
  }

  const ctx = await createContext(config);
  log.info(
    `DB: ${ctx.db.kind} · 미리보기 저장소: ${ctx.storage.kind} · 원본 보관: ${config.archiveDriver} · 봇: ${config.discord.botEnabled ? '사용' : '사용 안 함'}`,
  );

  let bot: BotRuntime | null = null;
  if (config.discord.botEnabled) {
    bot = new BotRuntime(ctx);
    ctx.bot = bot;
    if (config.archiveDriver === 'discord') ctx.refs.setArchive(bot.archive);
  }

  const app = createApi(ctx);
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    log.info(`웹사이트 / API: http://localhost:${info.port}  (공개 주소: ${config.publicBaseUrl})`);
  });

  if (bot) {
    // 봇 로그인이 실패해도 사이트 검색은 계속 동작하도록 HTTP 서버를 먼저 띄움
    bot.start().catch((err) => log.error('디스코드 봇 로그인 실패 — DISCORD_TOKEN 과 봇 권한을 확인해 주세요.', err));
  } else {
    log.warn('디스코드 봇 없이 실행 중입니다. 업로드는 할 수 없고, 원본은 로컬 폴더(data/originals)에서 제공합니다.');
  }

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`${signal} 수신 — 종료합니다.`);
    server.close();
    await bot?.stop().catch(() => undefined);
    await ctx.db.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('시작 실패', err);
  process.exit(1);
});
