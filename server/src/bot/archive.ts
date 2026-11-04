import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  EmbedBuilder,
  type Message,
  type SendableChannels,
} from 'discord.js';
import type { OriginalArchive, OriginalFile, OriginalUpload } from '../archive/types.js';
import type { Config } from '../config.js';
import { CATEGORIES, type Category } from '../constants.js';
import type { Reference } from '../types.js';
import { logger } from '../util/log.js';
import { creatorLine, hexToInt, paletteLine, tagLine } from './ui/card.js';

const log = logger('archive');

type ArchiveMessageLike = Pick<Message, 'attachments' | 'embeds'>;

/**
 * 아카이브 메시지에서 원본 파일 위치를 찾습니다.
 * 임베드가 `attachment://이름` 으로 첨부파일을 이미지로 쓰면, 디스코드는 그 파일을
 * 첨부파일 목록에서 빼고 임베드 이미지(원본 그대로의 CDN 주소)로만 돌려줍니다.
 */
export function archivedFile(msg: ArchiveMessageLike): { url: string; name: string; contentType: string | null } | null {
  const att = msg.attachments.first();
  if (att) return { url: att.url, name: att.name, contentType: att.contentType };
  for (const embed of msg.embeds) {
    const url = embed.image?.url;
    if (!url) continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    // 원본이 아닌 외부 이미지·미리보기 주소는 쓰지 않음
    if (parsed.hostname !== 'cdn.discordapp.com' || !parsed.pathname.startsWith('/attachments/')) continue;
    const name = decodeURIComponent(parsed.pathname.split('/').pop() ?? '');
    if (!name) continue;
    return { url, name, contentType: null };
  }
  return null;
}

/**
 * 디스코드 아카이브 채널을 원본 저장소로 사용합니다.
 * 봇이 원본을 첨부한 메시지를 올리고, 다운로드할 때는 그 메시지에서 새 첨부파일 URL 을 받아옵니다.
 * (디스코드 CDN 링크는 일정 시간이 지나면 만료되므로 매번 메시지를 다시 조회합니다.)
 */
export class DiscordArchive implements OriginalArchive {
  readonly kind = 'discord' as const;
  /** 같은 원본을 연달아 받을 때를 위한 작은 캐시 (최대 ~100MB) */
  private cache = new Map<number, { file: OriginalFile; at: number }>();
  private cacheBytes = 0;
  private readonly cacheLimit = 100 * 1024 * 1024;

  constructor(
    private readonly client: Client,
    private readonly config: Config,
    private readonly siteUrl: (ref: Reference) => string,
  ) {}

  isAvailable(): boolean {
    return this.client.isReady();
  }

  channelIdFor(category: Category): string {
    const id = this.config.discord.archiveChannels[category] ?? this.config.discord.archiveChannelId;
    if (!id) throw new Error(`${category} 아카이브 채널이 설정되지 않았습니다.`);
    return id;
  }

  /** 아카이브로 쓰는 모든 채널 ID */
  allChannelIds(): Set<string> {
    const ids = new Set<string>();
    if (this.config.discord.archiveChannelId) ids.add(this.config.discord.archiveChannelId);
    for (const id of Object.values(this.config.discord.archiveChannels)) if (id) ids.add(id);
    return ids;
  }

  private async channel(id: string): Promise<SendableChannels> {
    const ch = await this.client.channels.fetch(id);
    if (!ch || !ch.isSendable()) throw new Error(`아카이브 채널(${id})에 메시지를 보낼 수 없습니다.`);
    return ch;
  }

  private async message(ref: Reference): Promise<Message | null> {
    if (!ref.archiveChannelId || !ref.archiveMessageId) return null;
    try {
      const ch = await this.client.channels.fetch(ref.archiveChannelId);
      if (!ch || !ch.isTextBased()) return null;
      return await ch.messages.fetch(ref.archiveMessageId);
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 10008 || code === 10003) return null; // Unknown Message / Channel
      throw err;
    }
  }

  embed(ref: Reference, filename: string): EmbedBuilder {
    const cat = CATEGORIES[ref.category];
    const fields = [
      { name: '분류', value: `${cat.emoji} ${cat.label}`, inline: true },
      ...(ref.mapName ? [{ name: '맵', value: ref.mapName, inline: true }] : []),
      { name: '제작자', value: creatorLine(ref), inline: true },
      { name: '태그', value: tagLine(ref.tags).slice(0, 1024), inline: false },
      { name: '팔레트', value: paletteLine(ref) || '—', inline: false },
      { name: '올린 사람', value: `<@${ref.uploaderId}>`, inline: true },
      { name: '크기', value: `${ref.width}×${ref.height} · ${(ref.originalSize / 1024 / 1024).toFixed(2)}MB`, inline: true },
    ];
    return new EmbedBuilder()
      .setTitle(`#${ref.id} · ${ref.title}`.slice(0, 256))
      .setURL(this.siteUrl(ref))
      .addFields(fields)
      .setColor(hexToInt(ref.palette[0]?.hex))
      .setImage(`attachment://${filename}`)
      .setFooter({ text: `반응 ${this.config.reactionEmojis.join(' ')} 을 눌러 인기 레퍼런스를 뽑아주세요!` })
      .setTimestamp(ref.createdAt);
  }

  private linkRow(ref: Reference) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setURL(this.siteUrl(ref)).setLabel('사이트에서 보기').setStyle(ButtonStyle.Link),
    );
  }

  async store(ref: Reference, file: OriginalUpload) {
    const ch = await this.channel(this.channelIdFor(ref.category));
    const msg = await ch.send({
      embeds: [this.embed(ref, file.filename)],
      files: [new AttachmentBuilder(file.buffer, { name: file.filename })],
      components: [this.linkRow(ref)],
      allowedMentions: { parse: [] },
    });
    // 반응 버튼처럼 쓸 수 있도록 미리 이모지를 달아둠 (실패해도 무시)
    void (async () => {
      for (const e of this.config.reactionEmojis) await msg.react(e).catch(() => undefined);
    })();
    return { channelId: msg.channelId, messageId: msg.id };
  }

  async refresh(ref: Reference): Promise<void> {
    const msg = await this.message(ref);
    if (!msg) return;
    const original = archivedFile(msg);
    // 파일 이름을 못 찾으면 임베드를 다시 쓰지 않음 (잘못된 이름을 쓰면 임베드에서 이미지가 빠짐)
    if (!original) return void log.warn(`#${ref.id} 아카이브 메시지에서 원본을 찾지 못해 갱신하지 않았습니다.`);
    await msg.edit({ embeds: [this.embed(ref, original.name)], components: [this.linkRow(ref)], allowedMentions: { parse: [] } });
    // 분류가 바뀌어 다른 채널로 가야 하면 그대로 둠 (원본 위치는 유지)
  }

  async fetch(ref: Reference): Promise<OriginalFile | null> {
    const hit = this.cache.get(ref.id);
    if (hit) return hit.file;
    const msg = await this.message(ref);
    const original = msg ? archivedFile(msg) : null;
    if (!original) return null;
    const res = await fetch(original.url);
    if (!res.ok) throw new Error(`원본 다운로드 실패 (${res.status})`);
    const file: OriginalFile = {
      data: Buffer.from(await res.arrayBuffer()),
      contentType: original.contentType ?? ref.originalMime,
      filename: original.name,
    };
    this.remember(ref.id, file);
    return file;
  }

  private remember(id: number, file: OriginalFile) {
    if (file.data.length > this.cacheLimit / 4) return;
    this.cache.set(id, { file, at: Date.now() });
    this.cacheBytes += file.data.length;
    for (const [k, v] of this.cache) {
      if (this.cacheBytes <= this.cacheLimit) break;
      this.cache.delete(k);
      this.cacheBytes -= v.file.data.length;
    }
  }

  async remove(ref: Reference): Promise<void> {
    const hit = this.cache.get(ref.id);
    if (hit) {
      this.cache.delete(ref.id);
      this.cacheBytes -= hit.file.data.length;
    }
    const msg = await this.message(ref);
    if (msg) await msg.delete();
    else log.warn(`#${ref.id} 아카이브 메시지를 찾지 못했습니다.`);
  }

  async removeUserReaction(ref: Reference, userId: string, emoji: string): Promise<void> {
    const msg = await this.message(ref);
    if (!msg) return;
    const reaction = msg.reactions.cache.find((r) => r.emoji.name?.replace(/️/g, '') === emoji);
    await reaction?.users.remove(userId);
  }
}
