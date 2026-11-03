import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { CATEGORIES } from '../constants.js';
import { logger } from '../util/log.js';
import type { BotRuntime } from './runtime.js';
import { BRAND_COLOR, previewMedia } from './ui/card.js';

const log = logger('highlight');
const KV_KEY = 'highlight:lastWeek';

/** 주어진 시간대 기준으로 이번 주 월요일 날짜 (YYYY-MM-DD) */
export function weekKey(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
  const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12);
  const monday = new Date(local - dow * 24 * 60 * 60 * 1000);
  return monday.toISOString().slice(0, 10);
}

/**
 * 매주 월요일(설정한 시간대 기준)에 지난 7일 동안 반응을 가장 많이 받은 레퍼런스를 게시합니다.
 * 처음 실행할 때는 이번 주를 "이미 게시함"으로 기록만 하고, 다음 주 월요일부터 게시합니다.
 */
export class HighlightScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly bot: BotRuntime) {}

  start(): void {
    if (!this.bot.config.weeklyHighlight || !this.bot.config.discord.highlightChannelId) return;
    const tick = () => void this.check().catch((err) => log.error('주간 하이라이트 확인 실패', err));
    tick();
    this.timer = setInterval(tick, 15 * 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async check(): Promise<void> {
    const key = weekKey(new Date(), this.bot.config.timezone);
    const last = await this.bot.community.kvGet<string>(KV_KEY);
    if (last === key) return;
    if (last === null) {
      await this.bot.community.kvSet(KV_KEY, key);
      return;
    }
    await this.post();
    await this.bot.community.kvSet(KV_KEY, key);
  }

  /** 지금 바로 게시. 게시했으면 true */
  async post(): Promise<boolean> {
    const channelId = this.bot.config.discord.highlightChannelId;
    if (!channelId) return false;
    const { items } = await this.bot.refs.popular({ period: 'week', limit: 5 });
    if (!items.length) return false;
    const ch = await this.bot.client.channels.fetch(channelId);
    if (!ch?.isSendable()) throw new Error('하이라이트 채널에 메시지를 보낼 수 없습니다.');

    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
    const top = items[0];
    const media = await previewMedia(this.bot.refs, top);
    const embed = new EmbedBuilder()
      .setTitle('🏆 이번 주 인기 레퍼런스 TOP 5')
      .setColor(BRAND_COLOR)
      .setDescription(
        items
          .map(
            (r, idx) =>
              `${medals[idx]} [**#${r.id} ${r.title}**](${this.bot.refs.siteUrl(r)}) — ${r.creatorName} · ${CATEGORIES[r.category].label} · 반응 **${r.periodReactions ?? r.reactionTotal}**`,
          )
          .join('\n'),
      )
      .setImage(media.imageUrl)
      .setFooter({ text: '지난 7일 동안 받은 반응 기준 · 마음에 드는 레퍼런스에 반응을 눌러주세요!' })
      .setTimestamp(new Date());
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      items.map((r, idx) => new ButtonBuilder().setURL(this.bot.refs.siteUrl(r)).setLabel(`${idx + 1}위 #${r.id}`).setStyle(ButtonStyle.Link)),
    );
    await ch.send({ embeds: [embed], components: [row], files: media.files });
    log.info('주간 하이라이트를 게시했습니다.');
    return true;
  }
}
