import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
} from 'discord.js';
import { CATEGORIES, COLOR_FAMILIES } from '../../constants.js';
import type { ReferenceService } from '../../services/references.js';
import type { Reference } from '../../types.js';

export const BRAND_COLOR = 0x7c5cff;

export function hexToInt(hex: string | undefined | null, fallback = BRAND_COLOR): number {
  if (!hex) return fallback;
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return Number.isFinite(n) ? n : fallback;
}

/** 디스코드가 직접 가져갈 수 있는 공개 URL 인지 (localhost 는 불가 → 파일 첨부로 대체) */
export function discordCanFetch(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return !/^(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0)/.test(u.hostname);
  } catch {
    return false;
  }
}

export interface CardMedia {
  imageUrl: string;
  files: AttachmentBuilder[];
}

/** 임베드에 넣을 미리보기 이미지 (공개 URL 이 없으면 미리보기를 첨부) */
export async function previewMedia(refs: ReferenceService, ref: Reference): Promise<CardMedia> {
  const url = refs.previewUrl(ref);
  if (discordCanFetch(url)) return { imageUrl: url, files: [] };
  const data = await refs.getPreview(ref);
  if (!data) return { imageUrl: url, files: [] };
  const name = `preview-${ref.id}.webp`;
  return { imageUrl: `attachment://${name}`, files: [new AttachmentBuilder(data, { name })] };
}

export function tagLine(tags: string[]): string {
  return tags.length ? tags.map((t) => `\`${t}\``).join(' ') : '—';
}

export function paletteLine(ref: Reference): string {
  return ref.palette
    .slice(0, 5)
    .map((p) => `\`${p.hex}\``)
    .join(' ');
}

export function creatorLine(ref: Reference): string {
  const list = ref.creators?.length ? ref.creators : [{ name: ref.creatorName, id: ref.creatorId }];
  return list.map((c) => (c.id ? `<@${c.id}> (${c.name})` : c.name)).join(', ');
}

export function refEmbed(refs: ReferenceService, ref: Reference, imageUrl: string, footerExtra?: string): EmbedBuilder {
  const cat = CATEGORIES[ref.category];
  const color = COLOR_FAMILIES[ref.primaryColor ?? 'black'];
  const lines = [`${cat.emoji} **${cat.label}**`];
  if (ref.mapName) lines.push(`🗺️ 맵: **${ref.mapName}**`);
  lines.push(`👤 제작자: ${creatorLine(ref)}`);
  const embed = new EmbedBuilder()
    .setTitle(`#${ref.id} · ${ref.title}`.slice(0, 256))
    .setURL(refs.siteUrl(ref))
    .setDescription(lines.join('\n'))
    .addFields(
      { name: '태그', value: tagLine(ref.tags).slice(0, 1024), inline: false },
      { name: '색상', value: `${color.label} · ${paletteLine(ref) || '—'}`.slice(0, 1024), inline: false },
    )
    .setColor(hexToInt(ref.palette[0]?.hex))
    .setImage(imageUrl)
    .setTimestamp(ref.createdAt)
    .setFooter({
      text: [`올린 사람: ${ref.uploaderName ?? ref.uploaderId}`, `${ref.width}×${ref.height}`, footerExtra].filter(Boolean).join(' · '),
    });
  return embed;
}

export function reactionRow(ref: Reference, emojis: string[]): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    emojis.map((e, i) =>
      new ButtonBuilder()
        .setCustomId(`rx:${ref.id}:${i}`)
        .setEmoji(e)
        .setLabel(String(ref.reactions[e] ?? 0))
        .setStyle(ButtonStyle.Secondary),
    ),
  );
}

export function actionRow(refs: ReferenceService, ref: Reference): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`og:${ref.id}`).setEmoji('📥').setLabel('원본 받기').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`sm:${ref.id}`).setEmoji('🎨').setLabel('비슷한 색감').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setURL(refs.siteUrl(ref)).setLabel('사이트에서 보기').setStyle(ButtonStyle.Link),
  );
}

/** 이미 보낸 메시지의 반응 버튼 숫자만 갱신 */
export function withUpdatedReactionCounts(
  rows: APIActionRowComponent<APIComponentInMessageActionRow>[],
  refId: number,
  emojis: string[],
  counts: Record<string, number>,
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  return rows.map((row) => ({
    ...row,
    components: row.components.map((c) => {
      if (c.type !== 2 || !('custom_id' in c)) return c;
      const m = /^rx:(\d+):(\d+)$/.exec(c.custom_id);
      if (!m || Number(m[1]) !== refId) return c;
      const emoji = emojis[Number(m[2])];
      return { ...c, label: String(counts[emoji] ?? 0) };
    }),
  }));
}
