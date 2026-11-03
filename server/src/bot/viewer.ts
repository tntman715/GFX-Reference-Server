import {
  ActionRowBuilder,
  type AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
} from 'discord.js';
import crypto from 'node:crypto';
import type { ListResult, ReferenceService } from '../services/references.js';
import { TtlMap } from '../util/ttl-map.js';
import { actionRow, previewMedia, reactionRow, refEmbed } from './ui/card.js';

export interface ViewerSession {
  id: string;
  ownerId: string;
  title: string;
  /** 'list' = 페이지 넘기기, 'random' = 다시 뽑기 */
  mode: 'list' | 'random';
  emptyText: string;
  load: (offset: number) => Promise<ListResult>;
}

export interface RenderedMessage {
  content: string;
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
  files: AttachmentBuilder[];
}

/** 검색 결과를 한 장씩 넘겨보는 뷰어 (세션은 30분 동안 유지) */
export class Viewer {
  private sessions = new TtlMap<string, ViewerSession>(30 * 60_000);

  constructor(
    private readonly refs: ReferenceService,
    private readonly emojis: string[],
  ) {}

  create(s: Omit<ViewerSession, 'id'>): ViewerSession {
    const session = { ...s, id: crypto.randomBytes(6).toString('base64url') };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): ViewerSession | undefined {
    const s = this.sessions.get(id);
    if (s) this.sessions.touch(id);
    return s;
  }

  async render(session: ViewerSession, index: number): Promise<RenderedMessage> {
    let page = await session.load(Math.max(0, index));
    if (page.total > 0 && !page.items.length) {
      index = page.total - 1;
      page = await session.load(index);
    }
    const ref = page.items[0];
    if (!ref) return { content: session.emptyText, embeds: [], components: [], files: [] };

    const media = await previewMedia(this.refs, ref);
    const counter = session.mode === 'random' ? session.title : `${session.title} · ${index + 1}/${page.total}`;
    const embed = refEmbed(this.refs, ref, media.imageUrl, counter);

    const nav = new ActionRowBuilder<ButtonBuilder>();
    if (session.mode === 'random') {
      nav.addComponents(new ButtonBuilder().setCustomId(`v:${session.id}:0`).setEmoji('🎲').setLabel('다른 거 뽑기').setStyle(ButtonStyle.Success));
    } else {
      nav.addComponents(
        new ButtonBuilder().setCustomId(`v:${session.id}:${Math.max(0, index - 10)}:f`).setEmoji('⏪').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
        new ButtonBuilder().setCustomId(`v:${session.id}:${index - 1}`).setEmoji('◀️').setStyle(ButtonStyle.Primary).setDisabled(index === 0),
        new ButtonBuilder().setCustomId(`v:${session.id}:noop`).setLabel(`${index + 1} / ${page.total}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`v:${session.id}:${index + 1}`).setEmoji('▶️').setStyle(ButtonStyle.Primary).setDisabled(index >= page.total - 1),
        new ButtonBuilder()
          .setCustomId(`v:${session.id}:${Math.min(page.total - 1, index + 10)}:f`)
          .setEmoji('⏩')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(index >= page.total - 1),
      );
    }

    return {
      content: '',
      embeds: [embed],
      components: [nav, reactionRow(ref, this.emojis), actionRow(this.refs, ref)],
      files: media.files,
    };
  }

  /** 페이지 넘기기 없이 한 장만 */
  async single(refId: number): Promise<RenderedMessage> {
    const ref = await this.refs.require(refId);
    const media = await previewMedia(this.refs, ref);
    return {
      content: '',
      embeds: [refEmbed(this.refs, ref, media.imageUrl)],
      components: [reactionRow(ref, this.emojis), actionRow(this.refs, ref)],
      files: media.files,
    };
  }
}
