import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, type Client, EmbedBuilder, type Message } from 'discord.js';
import type { OriginalFile } from '../archive/types.js';
import type { Config } from '../config.js';
import { RESOURCE_KINDS, type Resource, type ResourceFileStore } from '../services/resources.js';
import { logger } from '../util/log.js';
import { archivedFile } from './archive.js';

const log = logger('resource-store');

/**
 * 에셋 · 플러그인 · 텍스쳐팩 파일을 디스코드 채널에 보관합니다.
 * RESOURCE_ARCHIVE_CHANNEL_ID 가 없으면 레퍼런스 아카이브 채널을 같이 씁니다.
 */
export class DiscordResourceStore implements ResourceFileStore {
  readonly kind = 'discord' as const;

  constructor(
    private readonly client: Client,
    private readonly config: Config,
    private readonly siteUrl: (res: Resource) => string,
  ) {}

  isAvailable(): boolean {
    return this.client.isReady() && !!this.channelId();
  }

  private channelId(): string | undefined {
    return this.config.discord.resourceArchiveChannelId ?? this.config.discord.archiveChannelId;
  }

  async store(res: Resource, file: { buffer: Buffer; filename: string; contentType: string }) {
    const id = this.channelId();
    if (!id) throw new Error('파일을 보관할 채널(RESOURCE_ARCHIVE_CHANNEL_ID 또는 ARCHIVE_CHANNEL_ID)이 없습니다.');
    const ch = await this.client.channels.fetch(id);
    if (!ch?.isSendable()) throw new Error(`보관 채널(${id})에 메시지를 보낼 수 없습니다.`);
    const kind = RESOURCE_KINDS[res.kind];
    const embed = new EmbedBuilder()
      .setTitle(`${kind.emoji} ${kind.label} #${res.id} · ${res.title}`.slice(0, 256))
      .setURL(this.siteUrl(res))
      .addFields(
        { name: '올린 사람', value: `<@${res.uploaderId}>`, inline: true },
        { name: '파일', value: `${file.filename} · ${(file.buffer.length / 1024 / 1024).toFixed(2)}MB`, inline: true },
        ...(res.creators.length ? [{ name: '제작자', value: res.creators.map((c) => c.name).join(', ').slice(0, 1024), inline: true }] : []),
        ...(res.tags.length ? [{ name: '태그', value: res.tags.map((t) => `\`${t}\``).join(' ').slice(0, 1024), inline: false }] : []),
      )
      .setColor(0xff7a1a)
      .setTimestamp(res.createdAt);
    if (res.description) embed.setDescription(res.description.slice(0, 600));
    const msg = await ch.send({
      embeds: [embed],
      files: [new AttachmentBuilder(file.buffer, { name: file.filename })],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setURL(this.siteUrl(res)).setLabel('사이트에서 보기').setStyle(ButtonStyle.Link),
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return { channelId: msg.channelId, messageId: msg.id };
  }

  private async message(res: Resource): Promise<Message | null> {
    if (!res.archiveChannelId || !res.archiveMessageId) return null;
    try {
      const ch = await this.client.channels.fetch(res.archiveChannelId);
      if (!ch?.isTextBased()) return null;
      return await ch.messages.fetch(res.archiveMessageId);
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 10008 || code === 10003) return null;
      throw err;
    }
  }

  async fetch(res: Resource): Promise<OriginalFile | null> {
    const msg = await this.message(res);
    const found = msg ? archivedFile(msg) : null;
    if (!found) return null;
    const r = await fetch(found.url);
    if (!r.ok) throw new Error(`파일 다운로드 실패 (${r.status})`);
    return {
      data: Buffer.from(await r.arrayBuffer()),
      contentType: found.contentType ?? res.file?.mime ?? 'application/octet-stream',
      filename: found.name,
    };
  }

  async remove(res: Resource): Promise<void> {
    const msg = await this.message(res);
    if (msg) await msg.delete();
    else log.warn(`${res.kind} #${res.id} 보관 메시지를 찾지 못했습니다.`);
  }
}
