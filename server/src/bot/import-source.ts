import { ChannelType, type Client, type Message } from 'discord.js';
import type { Config } from '../config.js';
import type { ImportSource, SourceChannel, SourceMessage } from '../services/importer.js';

/**
 * 예전 채팅 채널을 읽는 기능.
 * 다른 사람이 쓴 메시지의 내용/첨부파일을 보려면 개발자 포털에서 Message Content Intent 를 켜야 합니다.
 * (REST 로만 읽으므로 게이트웨이 intent 는 추가하지 않음 — 포털에서 꺼져 있어도 봇 로그인은 정상)
 */
export class DiscordImportSource implements ImportSource {
  constructor(
    private readonly client: Client,
    private readonly config: Config,
  ) {}

  private async textChannel(id: string) {
    const ch = await this.client.channels.fetch(id);
    if (!ch || !ch.isTextBased() || ch.isDMBased()) throw new Error(`채널(${id})을 읽을 수 없습니다.`);
    return ch;
  }

  async listChannels(): Promise<SourceChannel[]> {
    const guildId = this.config.discord.guildId;
    if (!guildId) return [];
    const guild = await this.client.guilds.fetch(guildId);
    const channels = await guild.channels.fetch();
    return [...channels.values()]
      .filter((c) => c && (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement))
      .map((c) => ({ id: c!.id, name: c!.name, parentName: c!.parent?.name ?? null, position: c!.rawPosition }))
      .sort((a, b) => (a.parentName ?? '').localeCompare(b.parentName ?? '') || a.position - b.position)
      .map(({ position: _, ...c }) => c);
  }

  async fetchMessages(channelId: string, before?: string): Promise<SourceMessage[]> {
    const ch = await this.textChannel(channelId);
    const page = await ch.messages.fetch({ limit: 100, before, cache: false });
    return [...page.values()].map((m) => toSource(m));
  }

  async fetchAttachment(channelId: string, messageId: string, attachmentId: string) {
    const ch = await this.textChannel(channelId);
    let msg: Message;
    try {
      msg = await ch.messages.fetch({ message: messageId, cache: false });
    } catch (err) {
      if ((err as { code?: number }).code === 10008) return null; // Unknown Message
      throw err;
    }
    const att = msg.attachments.get(attachmentId);
    if (!att) return null;
    const res = await fetch(att.url);
    if (!res.ok) throw new Error(`원본 다운로드 실패 (${res.status})`);
    return { buffer: Buffer.from(await res.arrayBuffer()), filename: att.name, contentType: att.contentType };
  }
}

function toSource(m: Message): SourceMessage {
  return {
    id: m.id,
    channelId: m.channelId,
    authorId: m.author.id,
    authorName: m.member?.displayName ?? m.author.globalName ?? m.author.username,
    content: m.content,
    postedAt: m.createdAt,
    mentions: [...m.mentions.users.values()].map((u) => ({ id: u.id, name: m.mentions.members?.get(u.id)?.displayName ?? u.globalName ?? u.username })),
    attachments: [...m.attachments.values()].map((a) => ({
      id: a.id,
      filename: a.name,
      contentType: a.contentType,
      size: a.size,
      width: a.width,
      height: a.height,
    })),
  };
}
