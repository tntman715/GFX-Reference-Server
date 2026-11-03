import crypto from 'node:crypto';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  type AutocompleteInteraction,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  Partials,
  REST,
  Routes,
  type User,
} from 'discord.js';
import type { OriginalFile } from '../archive/types.js';
import {
  CATEGORIES,
  type Category,
  COLOR_FAMILIES,
  type ColorFamily,
  isCategory,
  isColorFamily,
  isPopularPeriod,
  parseTagList,
  POPULAR_PERIODS,
} from '../constants.js';
import type { AppContext, BotBridge } from '../context.js';
import type { SearchOptions } from '../repos/references.js';
import { type CreateReferenceInput, DuplicateError } from '../services/references.js';
import type { Reference } from '../types.js';
import { sha256 } from '../util/crypto.js';
import { UserError } from '../util/errors.js';
import { logger } from '../util/log.js';
import { TtlMap } from '../util/ttl-map.js';
import { DiscordArchive } from './archive.js';
import { commandsJson } from './commands/definitions.js';
import { HighlightScheduler } from './highlight.js';
import { BRAND_COLOR, previewMedia, withUpdatedReactionCounts } from './ui/card.js';
import { actorOf, ephemeralFlag, replyError, userInfo } from './util.js';
import { Viewer } from './viewer.js';

const log = logger('bot');

interface PendingUpload {
  input: CreateReferenceInput;
  userId: string;
}

export class BotRuntime implements BotBridge {
  readonly client: Client;
  readonly archive: DiscordArchive;
  readonly viewer: Viewer;
  private pendingUploads = new TtlMap<string, PendingUpload>(10 * 60_000, 200);
  private highlight: HighlightScheduler;
  private tagCache: { at: number; names: string[] } | null = null;

  constructor(private readonly ctx: AppContext) {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessageReactions],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
      allowedMentions: { parse: [] },
    });
    this.archive = new DiscordArchive(this.client, ctx.config, (ref) => ctx.refs.siteUrl(ref));
    this.viewer = new Viewer(ctx.refs, ctx.config.reactionEmojis);
    this.highlight = new HighlightScheduler(this);
  }

  get refs() {
    return this.ctx.refs;
  }
  get community() {
    return this.ctx.community;
  }
  get config() {
    return this.ctx.config;
  }

  // ── 시작 ────────────────────────────────────────────────

  async start(): Promise<void> {
    const ready = new Promise<void>((resolve) => {
      this.client.once(Events.ClientReady, async (c) => {
        log.info(`디스코드 봇 로그인: ${c.user.tag}`);
        await this.deployCommandsIfChanged().catch((err) => log.error('명령어 등록 실패', err));
        this.highlight.start();
        resolve();
      });
    });
    this.client.on(Events.InteractionCreate, (i) => {
      void this.onInteraction(i);
    });
    this.client.on(Events.MessageReactionAdd, (r, u) => void this.onReaction(r, u, true));
    this.client.on(Events.MessageReactionRemove, (r, u) => void this.onReaction(r, u, false));
    this.client.on(Events.Error, (err) => log.error('디스코드 클라이언트 오류', err));
    await this.client.login(this.config.discord.token);
    await ready;
  }

  async stop(): Promise<void> {
    this.highlight.stop();
    await this.client.destroy();
  }

  /** 명령어 정의가 바뀌었을 때만 디스코드에 다시 등록 */
  private async deployCommandsIfChanged(): Promise<void> {
    const body = commandsJson();
    const guildId = this.config.discord.guildId;
    const hash = sha256(JSON.stringify({ body, guildId }));
    const prev = await this.community.kvGet<string>('commands:hash');
    if (prev === hash) return;
    const rest = new REST().setToken(this.config.discord.token!);
    const appId = this.client.application!.id;
    await rest.put(guildId ? Routes.applicationGuildCommands(appId, guildId) : Routes.applicationCommands(appId), { body });
    await this.community.kvSet('commands:hash', hash);
    log.info(`슬래시 명령어 ${body.length}개를 ${guildId ? '서버' : '전역'}에 등록했습니다.`);
  }

  // ── BotBridge ───────────────────────────────────────────

  isOnline(): boolean {
    return this.client.isReady();
  }

  inviteInfo() {
    const guild = this.config.discord.guildId ? this.client.guilds.cache.get(this.config.discord.guildId) : null;
    return { guildName: guild?.name ?? null, botName: this.client.user?.username ?? null };
  }

  async sendOriginalDm(userId: string, ref: Reference, file: OriginalFile): Promise<void> {
    const user = await this.client.users.fetch(userId);
    try {
      await user.send({
        content: `📥 요청하신 원본입니다 — **#${ref.id} · ${ref.title}** (제작자: ${ref.creatorName})\n${this.refs.siteUrl(ref)}`,
        files: [new AttachmentBuilder(file.data, { name: this.refs.downloadFilename(ref, file) })],
      });
    } catch (err) {
      if ((err as { code?: number }).code === 50007) {
        throw new UserError('DM 을 보낼 수 없어요. 디스코드 설정 → 개인정보 보호에서 "서버 멤버가 보내는 DM 허용"을 켜주세요.', {
          status: 400,
          code: 'dm_closed',
        });
      }
      throw err;
    }
  }

  async syncReactionRemoval(ref: Reference, userId: string, emoji: string): Promise<void> {
    await this.archive.removeUserReaction(ref, userId, emoji).catch(() => undefined);
  }

  // ── 라우팅 ──────────────────────────────────────────────

  private async onInteraction(i: import('discord.js').Interaction): Promise<void> {
    try {
      if (i.isAutocomplete()) return await this.onAutocomplete(i);
      if (i.isChatInputCommand()) {
        void this.community.upsertUser(userInfo(i.user, i.member)).catch(() => undefined);
        return await this.onCommand(i);
      }
      if (i.isButton()) return await this.onButton(i);
    } catch (err) {
      if (i.isRepliable()) await replyError(i, err);
      else log.error('인터랙션 처리 실패', err);
    }
  }

  private async onCommand(i: ChatInputCommandInteraction): Promise<void> {
    switch (i.commandName) {
      case 'upload':
        return this.cmdUpload(i);
      case 'search':
        return this.cmdSearch(i);
      case 'random':
        return this.cmdRandom(i);
      case 'popular':
        return this.cmdPopular(i);
      case 'color':
        return this.cmdColor(i);
      case 'view':
        return this.cmdView(i);
      case 'edit':
        return this.cmdEdit(i);
      case 'delete':
        return this.cmdDelete(i);
      case 'leaderboard':
        return this.cmdLeaderboard(i);
      case 'profile':
        return this.cmdProfile(i);
      case 'tags':
        return this.cmdTags(i);
      case 'admin':
        return this.cmdAdmin(i);
      case 'link':
        return this.cmdLink(i);
      case 'help':
        return this.cmdHelp(i);
      default:
        await i.reply({ content: '알 수 없는 명령어입니다.', flags: MessageFlags.Ephemeral });
    }
  }

  // ── 업로드 ──────────────────────────────────────────────

  private async cmdUpload(i: ChatInputCommandInteraction): Promise<void> {
    const allowed = this.config.discord.uploadChannelIds;
    if (allowed.length && !allowed.includes(i.channelId)) {
      throw new UserError(`업로드는 ${allowed.map((c) => `<#${c}>`).join(', ')} 채널에서만 할 수 있어요.`);
    }
    const att = i.options.getAttachment('image', true);
    if (att.contentType && !att.contentType.startsWith('image/')) throw new UserError('이미지 파일만 올릴 수 있어요.');
    if (att.size > this.config.upload.maxBytes) {
      throw new UserError(`파일이 너무 커요. 최대 ${Math.round(this.config.upload.maxBytes / 1024 / 1024)}MB 까지 올릴 수 있어요.`);
    }
    const category = i.options.getString('category', true);
    if (!isCategory(category)) throw new UserError('분류를 선택해 주세요.');
    if (CATEGORIES[category].requiresMapName && !i.options.getString('map')) {
      throw new UserError(`**${CATEGORIES[category].label}** 는 \`맵이름\` 옵션이 필요해요.`);
    }
    // 태그는 이미지 다운로드 전에 먼저 확인 (오타 시 빠르게 안내)
    const tags = parseTagList(i.options.getString('tags'));
    await this.refs.resolveTags(tags);

    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const res = await fetch(att.url);
    if (!res.ok) throw new UserError('디스코드에서 이미지를 받아오지 못했어요. 다시 시도해 주세요.');
    const buffer = Buffer.from(await res.arrayBuffer());

    const creatorUser = i.options.getUser('creator_user');
    let creatorName = i.options.getString('creator');
    if (!creatorName && creatorUser) {
      const member = await i.guild?.members.fetch(creatorUser.id).catch(() => null);
      creatorName = member?.displayName ?? creatorUser.globalName ?? creatorUser.username;
    }

    const input: CreateReferenceInput = {
      file: { buffer, filename: att.name, contentType: att.contentType },
      category,
      title: i.options.getString('title'),
      mapName: i.options.getString('map'),
      creatorName,
      creatorId: creatorUser?.id ?? null,
      tags,
      uploader: userInfo(i.user, i.member),
    };
    await this.finishUpload(i, input, false);
  }

  private async finishUpload(i: ChatInputCommandInteraction | ButtonInteraction, input: CreateReferenceInput, force: boolean) {
    try {
      const ref = await this.refs.create(input, { allowDuplicate: force });
      const score = await this.community.score(input.uploader.id);
      const rendered = await this.viewer.single(ref.id);
      await i.editReply({
        content: `✅ **#${ref.id}** 등록 완료! **+${this.config.scoring.pointsPerUpload}점** (현재 ${score?.score ?? 0}점 · ${score?.rank ?? '-'}위)`,
        embeds: rendered.embeds,
        components: rendered.components,
        files: rendered.files,
      });
    } catch (err) {
      if (!(err instanceof DuplicateError)) throw err;
      const pid = crypto.randomBytes(6).toString('base64url');
      this.pendingUploads.set(pid, { input, userId: input.uploader.id });
      const list = err.matches
        .map((m) => `• **#${m.id}** ${m.title} — ${m.creatorName} (${CATEGORIES[m.category].label})`)
        .join('\n');
      const first = err.matches[0];
      const media = await previewMedia(this.refs, first);
      await i.editReply({
        content: `⚠️ 이미 비슷한 레퍼런스가 있어요!\n${list}\n\n그래도 올릴까요?`,
        embeds: [new EmbedBuilder().setTitle(`#${first.id} · ${first.title}`).setURL(this.refs.siteUrl(first)).setImage(media.imageUrl).setColor(0xffb020)],
        files: media.files,
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`up:force:${pid}`).setLabel('그래도 올리기').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`up:cancel:${pid}`).setLabel('취소').setStyle(ButtonStyle.Secondary),
          ),
        ],
      });
    }
  }

  // ── 검색 / 보기 ─────────────────────────────────────────

  private filtersFrom(i: ChatInputCommandInteraction): SearchOptions {
    const f: SearchOptions = {};
    const category = i.options.getString('category');
    if (isCategory(category)) f.category = category;
    const tags = parseTagList(i.options.getString('tags'));
    if (tags.length) f.tags = tags;
    const color = i.options.getString('color');
    if (isColorFamily(color)) f.color = color;
    const creator = i.options.getString('creator');
    if (creator) f.creator = creator;
    const query = i.options.getString('query');
    if (query) f.q = query;
    return f;
  }

  private describeFilters(f: SearchOptions): string {
    const parts: string[] = [];
    if (f.q) parts.push(`"${f.q}"`);
    if (f.category) parts.push(CATEGORIES[f.category].label);
    if (f.tags?.length) parts.push(f.tags.map((t) => `#${t}`).join(' '));
    if (f.color) parts.push(COLOR_FAMILIES[f.color].label);
    if (f.creator) parts.push(`제작자 ${f.creator}`);
    return parts.join(' · ');
  }

  private async openViewer(
    i: ChatInputCommandInteraction | ButtonInteraction,
    opts: { title: string; mode?: 'list' | 'random'; load: (offset: number) => Promise<import('../services/references.js').ListResult>; emptyText: string; isPublic?: boolean | null },
  ) {
    const session = this.viewer.create({ ownerId: i.user.id, title: opts.title, mode: opts.mode ?? 'list', emptyText: opts.emptyText, load: opts.load });
    if (!i.deferred && !i.replied) await i.deferReply({ flags: ephemeralFlag(opts.isPublic) });
    const msg = await this.viewer.render(session, 0);
    await i.editReply(msg);
  }

  private async cmdSearch(i: ChatInputCommandInteraction) {
    const f = this.filtersFrom(i);
    const sort = i.options.getString('sort') ?? (f.color ? 'color' : 'newest');
    const seed = crypto.randomBytes(6).toString('hex');
    const desc = this.describeFilters(f);
    await this.openViewer(i, {
      title: `🔎 ${desc || '전체'}`.slice(0, 80),
      isPublic: i.options.getBoolean('public'),
      emptyText: `🔎 ${desc ? `**${desc}** 에 맞는` : ''} 레퍼런스가 없어요.`,
      load: (offset) =>
        sort === 'popular'
          ? this.refs.popular({ ...f, period: 'all', limit: 1, offset })
          : this.refs.search({ ...f, sort: sort as SearchOptions['sort'], seed, limit: 1, offset }),
    });
  }

  private async cmdRandom(i: ChatInputCommandInteraction) {
    const f = this.filtersFrom(i);
    const desc = this.describeFilters(f);
    await this.openViewer(i, {
      title: `🎲 랜덤 레퍼런스${desc ? ` (${desc})` : ''}`.slice(0, 80),
      mode: 'random',
      isPublic: i.options.getBoolean('public'),
      emptyText: '🎲 조건에 맞는 레퍼런스가 없어요.',
      load: async () => {
        const r = await this.refs.random(f);
        return { items: r ? [r] : [], total: r ? 1 : 0 };
      },
    });
  }

  private async cmdPopular(i: ChatInputCommandInteraction) {
    const p = i.options.getString('period');
    const period = isPopularPeriod(p) ? p : 'week';
    const category = i.options.getString('category');
    const cat = isCategory(category) ? category : undefined;
    const label = `${POPULAR_PERIODS[period].label}${cat ? ` ${CATEGORIES[cat].label}` : ''}`;
    await this.openViewer(i, {
      title: `🏆 ${label} 인기`,
      isPublic: i.options.getBoolean('public'),
      emptyText: `🏆 ${label} 반응을 받은 레퍼런스가 아직 없어요. ${this.config.reactionEmojis.join(' ')} 반응을 눌러주세요!`,
      load: (offset) => this.refs.popular({ category: cat, period, limit: 1, offset }),
    });
  }

  private async cmdColor(i: ChatInputCommandInteraction) {
    const sub = i.options.getSubcommand();
    const category = i.options.getString('category');
    const cat: Category | undefined = isCategory(category) ? category : undefined;
    const isPublic = i.options.getBoolean('public');
    if (sub === 'family') {
      const color = i.options.getString('color', true) as ColorFamily;
      const label = COLOR_FAMILIES[color].label;
      return this.openViewer(i, {
        title: `🎨 ${label}`,
        isPublic,
        emptyText: `🎨 ${label} 계열 레퍼런스가 없어요.`,
        load: (offset) => this.refs.search({ color, category: cat, sort: 'color', limit: 1, offset }),
      });
    }
    if (sub === 'hex') {
      const code = i.options.getString('code', true);
      const hex = code.startsWith('#') ? code : `#${code}`;
      await this.refs.byHex(hex, { limit: 1 }); // 형식 검증
      return this.openViewer(i, {
        title: `🎨 ${hex}`,
        isPublic,
        emptyText: `🎨 ${hex} 와 비슷한 색이 들어간 레퍼런스가 없어요.`,
        load: (offset) => this.refs.byHex(hex, { category: cat, limit: 1, offset }),
      });
    }
    const id = i.options.getInteger('id', true);
    await this.refs.require(id);
    return this.openViewer(i, {
      title: `🎨 #${id} 와 비슷한 색감`,
      isPublic,
      emptyText: `🎨 #${id} 와 색감이 비슷한 레퍼런스가 아직 없어요.`,
      load: (offset) => this.refs.similar(id, { category: cat, limit: 1, offset }),
    });
  }

  private async cmdView(i: ChatInputCommandInteraction) {
    const id = i.options.getInteger('id', true);
    await i.deferReply({ flags: ephemeralFlag(i.options.getBoolean('public')) });
    await i.editReply(await this.viewer.single(id));
  }

  // ── 수정 / 삭제 ─────────────────────────────────────────

  private async cmdEdit(i: ChatInputCommandInteraction) {
    const id = i.options.getInteger('id', true);
    const o = i.options;
    const patch: Parameters<typeof this.refs.update>[1] = {};
    if (o.getString('title') !== null) patch.title = o.getString('title');
    if (o.getString('map') !== null) patch.mapName = o.getString('map');
    if (o.getString('creator') !== null) patch.creatorName = o.getString('creator');
    const cu = o.getUser('creator_user');
    if (cu) {
      patch.creatorId = cu.id;
      if (patch.creatorName === undefined) patch.creatorName = cu.globalName ?? cu.username;
    }
    const category = o.getString('category');
    if (isCategory(category)) patch.category = category;
    const tags = o.getString('tags');
    if (tags !== null) patch.tags = tags.trim() === '-' ? [] : parseTagList(tags);
    if (o.getString('add_tags')) patch.addTags = parseTagList(o.getString('add_tags'));
    if (o.getString('remove_tags')) patch.removeTags = parseTagList(o.getString('remove_tags'));
    if (!Object.keys(patch).length) throw new UserError('바꿀 항목을 하나 이상 입력해 주세요.');

    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const ref = await this.refs.update(id, patch, actorOf(i, this.config));
    const rendered = await this.viewer.single(ref.id);
    await i.editReply({ ...rendered, content: `✏️ **#${ref.id}** 수정 완료` });
  }

  private async cmdDelete(i: ChatInputCommandInteraction) {
    const id = i.options.getInteger('id', true);
    const ref = await this.refs.require(id);
    if (!this.refs.canEdit(ref, actorOf(i, this.config))) throw new UserError('올린 사람이나 관리자만 삭제할 수 있어요.');
    await i.reply({
      content: `🗑️ **#${ref.id} · ${ref.title}** 을(를) 정말 삭제할까요? 원본과 미리보기, 받은 반응이 모두 지워지고 점수도 빠져요.`,
      flags: MessageFlags.Ephemeral,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`del:yes:${ref.id}`).setLabel('삭제').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`del:no:${ref.id}`).setLabel('취소').setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
  }

  // ── 랭킹 / 프로필 / 태그 ────────────────────────────────

  private async leaderboardMessage(page: number) {
    const pageSize = 10;
    const { rows, total } = await this.community.leaderboard(page, pageSize);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const medal = (rank: number) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `\`${String(rank).padStart(2)}\``);
    const lines = rows.map(
      (r) =>
        `${medal(r.rank)} <@${r.userId}> — **${r.score.toLocaleString()}점** · 업로드 ${r.uploads} · 받은 반응 ${r.reactionsReceived}${
          r.adjustments ? ` · 보너스 ${r.adjustments > 0 ? '+' : ''}${r.adjustments}` : ''
        }`,
    );
    const embed = new EmbedBuilder()
      .setTitle('🏆 GFX References 기여 랭킹')
      .setColor(BRAND_COLOR)
      .setDescription(lines.join('\n') || '아직 레퍼런스를 올린 사람이 없어요. `/업로드` 로 첫 번째가 되어보세요!')
      .setFooter({
        text: `업로드 +${this.config.scoring.pointsPerUpload}점 · 받은 반응 +${this.config.scoring.pointsPerReaction}점 · ${page}/${pages} 페이지`,
      });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`lb:${page - 1}`).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
      new ButtonBuilder().setCustomId(`lb:${page + 1}`).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages),
      new ButtonBuilder().setURL(`${this.config.publicBaseUrl}/#/leaderboard`).setLabel('사이트에서 보기').setStyle(ButtonStyle.Link),
    );
    return { embeds: [embed], components: [row], allowedMentions: { parse: [] as never[] } };
  }

  private async cmdLeaderboard(i: ChatInputCommandInteraction) {
    await i.reply(await this.leaderboardMessage(i.options.getInteger('page') ?? 1));
  }

  private async cmdProfile(i: ChatInputCommandInteraction) {
    const target = i.options.getUser('user') ?? i.user;
    await i.deferReply();
    const member = await i.guild?.members.fetch(target.id).catch(() => null);
    await this.community.upsertUser(userInfo(target, member));
    const p = await this.community.profile(target.id);
    const s = p.score;
    const cats = Object.entries(CATEGORIES)
      .map(([k, v]) => `${v.emoji} ${v.label}: **${p.categories[k] ?? 0}**`)
      .join('\n');
    const embed = new EmbedBuilder()
      .setAuthor({ name: p.user.displayName ?? p.user.username, iconURL: p.user.avatarUrl ?? undefined })
      .setTitle(s ? `${s.score.toLocaleString()}점 · ${s.rank}위` : '아직 점수가 없어요')
      .setURL(`${this.config.publicBaseUrl}/#/user/${target.id}`)
      .setColor(BRAND_COLOR)
      .addFields(
        { name: '업로드', value: String(s?.uploads ?? 0), inline: true },
        { name: '받은 반응', value: String(s?.reactionsReceived ?? 0), inline: true },
        { name: '보너스', value: String(s?.adjustments ?? 0), inline: true },
        { name: '분류별', value: cats },
      );
    if (p.recent.length) {
      embed.addFields({
        name: '최근 올린 레퍼런스',
        value: p.recent
          .slice(0, 6)
          .map((r) => `[#${r.id} ${r.title}](${this.refs.siteUrl(r)})`)
          .join('\n')
          .slice(0, 1024),
      });
    }
    let files: AttachmentBuilder[] = [];
    const best = p.top[0] ?? p.recent[0];
    if (best) {
      const media = await previewMedia(this.refs, best);
      embed.setImage(media.imageUrl);
      files = media.files;
      if (p.top[0]) embed.setFooter({ text: `가장 인기 있는 레퍼런스: #${best.id} ${best.title} (반응 ${best.reactionTotal})` });
    }
    await i.editReply({ embeds: [embed], files });
  }

  private async cmdTags(i: ChatInputCommandInteraction) {
    const tags = await this.community.listTags();
    const embed = new EmbedBuilder()
      .setTitle(`🏷️ 태그 목록 (${tags.length}개)`)
      .setColor(BRAND_COLOR)
      .setDescription(
        tags
          .map((t) => `\`${t.name}\` — ${t.description ?? ''} (${t.count})`)
          .join('\n')
          .slice(0, 4000) || '태그가 없어요.',
      )
      .setFooter({ text: '업로드할 때 "태그" 옵션에 쉼표로 구분해서 입력하세요. 관리자는 /관리 태그추가 로 늘릴 수 있어요.' });
    await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  private async cmdAdmin(i: ChatInputCommandInteraction) {
    const actor = actorOf(i, this.config);
    if (!actor.isAdmin) throw new UserError('관리자만 사용할 수 있어요.');
    const sub = i.options.getSubcommand();
    const done = (content: string) => i.reply({ content, flags: MessageFlags.Ephemeral });
    this.tagCache = null;
    switch (sub) {
      case 'tag-add': {
        const t = await this.community.addTag(i.options.getString('name', true), i.options.getString('description'), actor);
        return void (await done(`🏷️ \`${t.name}\` 태그를 추가했어요.`));
      }
      case 'tag-remove': {
        const name = i.options.getString('name', true);
        await this.community.removeTag(name, actor);
        return void (await done(`🗑️ \`${name}\` 태그를 삭제했어요.`));
      }
      case 'tag-rename': {
        const from = i.options.getString('from', true);
        const to = i.options.getString('to', true);
        await this.community.renameTag(from, to, actor);
        return void (await done(`✏️ \`${from}\` → \`${to}\``));
      }
      case 'tag-describe': {
        const name = i.options.getString('name', true);
        await this.community.describeTag(name, i.options.getString('description'), actor);
        return void (await done(`✏️ \`${name}\` 설명을 바꿨어요.`));
      }
      case 'score': {
        const user = i.options.getUser('user', true);
        const amount = i.options.getInteger('amount', true);
        const member = await i.guild?.members.fetch(user.id).catch(() => null);
        await this.community.upsertUser(userInfo(user, member));
        const s = await this.community.adjustScore(user.id, amount, i.options.getString('reason'), actor);
        return void (await done(`✅ <@${user.id}> 점수 ${amount > 0 ? '+' : ''}${amount} → 현재 **${s?.score ?? 0}점** (${s?.rank ?? '-'}위)`));
      }
      case 'highlight': {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const posted = await this.highlight.post();
        return void (await i.editReply(posted ? '📣 주간 인기 레퍼런스를 게시했어요.' : '게시할 채널(HIGHLIGHT_CHANNEL_ID)이 없거나 이번 주 반응이 없어요.'));
      }
      case 'stats': {
        const stats = await this.community.stats();
        const lines = Object.entries(CATEGORIES).map(([k, v]) => `${v.emoji} ${v.label}: **${stats.categories[k] ?? 0}**`);
        return void (await done(`📊 전체 레퍼런스 **${stats.total}개**\n${lines.join('\n')}`));
      }
    }
  }

  private async cmdLink(i: ChatInputCommandInteraction) {
    await this.community.approveDeviceCode(i.options.getString('code', true), userInfo(i.user, i.member));
    await i.reply({
      content: '🔗 연동 완료! 포토샵 플러그인이나 사이트로 돌아가면 자동으로 로그인돼요.\n(내가 요청한 코드가 아니라면 관리자에게 알려주세요.)',
      flags: MessageFlags.Ephemeral,
    });
  }

  private async cmdHelp(i: ChatInputCommandInteraction) {
    const site = this.config.publicBaseUrl;
    const embed = new EmbedBuilder()
      .setTitle('📚 GFX References 사용법')
      .setColor(BRAND_COLOR)
      .setURL(site)
      .setDescription(
        [
          '**레퍼런스 올리기**',
          '`/업로드` 이미지 · 분류 · (맵이름) · 제작자 · 태그 — 원본은 서버 아카이브에, 미리보기는 데이터베이스에 저장돼요.',
          `올릴 때마다 **+${this.config.scoring.pointsPerUpload}점**, 내 레퍼런스가 반응을 받으면 **+${this.config.scoring.pointsPerReaction}점**!`,
          '',
          '**찾기**',
          '`/검색` 검색어 · 분류 · 태그 · 색상 · 제작자 · 정렬',
          '`/랜덤` 랜덤 레퍼런스 · `/인기` 기간별 인기 · `/보기` 번호로 보기',
          '`/색상 계열` 색 계열 · `/색상 코드` #hex 로 찾기 · `/색상 비슷한` 색감이 비슷한 것',
          '',
          '**반응 / 점수**',
          `카드 아래 ${this.config.reactionEmojis.join(' ')} 버튼이나 아카이브 메시지 반응으로 투표해요.`,
          '`/랭킹` 기여 랭킹 · `/프로필` 내 점수',
          '',
          '**관리**',
          '`/수정` `/삭제` 내가 올린 레퍼런스 · `/태그목록` · `/관리` (관리자)',
          '',
          '**사이트 & 포토샵 플러그인**',
          `${site} 에서 검색하고 원본을 받을 수 있어요 (디스코드 로그인).`,
          '포토샵 플러그인에서 표시되는 코드를 `/연동 코드:XXXX-XXXX` 로 입력하면 연결돼요.',
        ].join('\n'),
      );
    await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // ── 버튼 ────────────────────────────────────────────────

  private async onButton(i: ButtonInteraction): Promise<void> {
    const [kind, a, b] = i.customId.split(':');
    switch (kind) {
      case 'v': {
        if (b === 'noop') return void (await i.deferUpdate());
        const session = this.viewer.get(a);
        if (!session) {
          return void (await i.reply({ content: '⌛ 결과가 만료되었어요. 명령어를 다시 실행해 주세요.', flags: MessageFlags.Ephemeral }));
        }
        if (session.ownerId !== i.user.id) {
          return void (await i.reply({ content: '직접 명령어를 실행해서 넘겨보세요! (`/검색`, `/랜덤` …)', flags: MessageFlags.Ephemeral }));
        }
        await i.deferUpdate();
        const msg = await this.viewer.render(session, Number(b));
        await i.editReply({ ...msg, attachments: [] });
        return;
      }
      case 'rx': {
        const refId = Number(a);
        const emoji = this.config.reactionEmojis[Number(b)];
        if (!emoji) return void (await i.deferUpdate());
        const res = await this.refs.toggleReaction(refId, userInfo(i.user, i.member), emoji);
        const rows = i.message.components.filter((r) => r.type === 1).map((r) => r.toJSON()) as Parameters<typeof withUpdatedReactionCounts>[0];
        await i.update({ components: withUpdatedReactionCounts(rows, refId, this.config.reactionEmojis, res.reactions) });
        if (!res.active) {
          const ref = await this.refs.get(refId);
          if (ref) void this.syncReactionRemoval(ref, i.user.id, emoji);
        }
        await i.followUp({ content: res.active ? `${emoji} 반응을 남겼어요!` : `${emoji} 반응을 취소했어요.`, flags: MessageFlags.Ephemeral });
        return;
      }
      case 'og': {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const ref = await this.refs.require(Number(a));
        const file = await this.refs.fetchOriginal(ref);
        const jump = ref.archiveChannelId && ref.archiveMessageId && this.config.discord.guildId
          ? `https://discord.com/channels/${this.config.discord.guildId}/${ref.archiveChannelId}/${ref.archiveMessageId}`
          : null;
        await i.editReply({
          content: `📥 **#${ref.id} · ${ref.title}** 원본 (${ref.width}×${ref.height})${jump ? `\n아카이브: ${jump}` : ''}`,
          files: [new AttachmentBuilder(file.data, { name: this.refs.downloadFilename(ref, file) })],
        });
        return;
      }
      case 'sm': {
        const id = Number(a);
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        await this.openViewer(i, {
          title: `🎨 #${id} 와 비슷한 색감`,
          emptyText: `🎨 #${id} 와 색감이 비슷한 레퍼런스가 아직 없어요.`,
          load: (offset) => this.refs.similar(id, { limit: 1, offset }),
        });
        return;
      }
      case 'up': {
        const pending = this.pendingUploads.get(b);
        if (!pending) return void (await i.update({ content: '⌛ 업로드 대기 시간이 지났어요. 다시 올려주세요.', embeds: [], components: [], files: [] }));
        if (pending.userId !== i.user.id) return void (await i.reply({ content: '본인 업로드만 결정할 수 있어요.', flags: MessageFlags.Ephemeral }));
        this.pendingUploads.delete(b);
        if (a === 'cancel') return void (await i.update({ content: '업로드를 취소했어요.', embeds: [], components: [], attachments: [] }));
        await i.update({ content: '⏳ 업로드 중…', embeds: [], components: [], attachments: [] });
        await this.finishUpload(i, pending.input, true);
        return;
      }
      case 'del': {
        if (a === 'no') return void (await i.update({ content: '삭제를 취소했어요.', components: [] }));
        const ref = await this.refs.delete(Number(b), actorOf(i, this.config));
        await i.update({ content: `🗑️ **#${ref.id} · ${ref.title}** 을(를) 삭제했어요.`, components: [] });
        return;
      }
      case 'lb': {
        await i.update(await this.leaderboardMessage(Math.max(1, Number(a))));
        return;
      }
    }
    await i.deferUpdate();
  }

  // ── 자동완성 ────────────────────────────────────────────

  private async tagNames(): Promise<string[]> {
    if (this.tagCache && Date.now() - this.tagCache.at < 60_000) return this.tagCache.names;
    const names = await this.community.tagNames();
    this.tagCache = { at: Date.now(), names };
    return names;
  }

  private async onAutocomplete(i: AutocompleteInteraction): Promise<void> {
    const focused = i.options.getFocused(true);
    const value = String(focused.value ?? '');
    let choices: { name: string; value: string | number }[] = [];

    if (['tags', 'add_tags', 'remove_tags'].includes(focused.name)) {
      const all = await this.tagNames();
      const parts = value.split(',');
      const last = parts.pop()!.trim().toLowerCase();
      const prefix = parts.map((p) => p.trim()).filter(Boolean);
      const used = new Set(prefix.map((p) => p.toLowerCase()));
      const matches = all.filter((t) => !used.has(t) && t.includes(last)).slice(0, 25);
      choices = matches.map((t) => {
        const v = [...prefix, t].join(', ').slice(0, 100);
        return { name: v, value: v };
      });
      if (!choices.length && value) choices = [{ name: value.slice(0, 100), value: value.slice(0, 100) }];
    } else if (focused.name === 'name' || focused.name === 'from') {
      const all = await this.tagNames();
      choices = all.filter((t) => t.includes(value.toLowerCase())).slice(0, 25).map((t) => ({ name: t, value: t }));
    } else if (focused.name === 'creator') {
      const names = await this.refs.creators(value, 25);
      choices = names.map((n) => ({ name: n.slice(0, 100), value: n.slice(0, 100) }));
    } else if (focused.name === 'id') {
      const rows = await this.refs.suggest(value, 25);
      choices = rows.map((r) => ({ name: `#${r.id} · ${r.title} (${CATEGORIES[r.category].shortLabel})`.slice(0, 100), value: r.id }));
    }
    await i.respond(choices);
  }

  // ── 아카이브 메시지 반응 동기화 ─────────────────────────

  private async onReaction(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, added: boolean) {
    try {
      if (user.bot) return;
      if (!this.archive.allChannelIds().has(reaction.message.channelId)) return;
      const emoji = reaction.emoji.name;
      if (!this.refs.isReactionEmoji(emoji)) return;
      const ref = await this.refs.getByArchiveMessage(reaction.message.id);
      if (!ref) return;
      const full = user.partial ? await user.fetch() : user;
      const member = reaction.message.guild ? await reaction.message.guild.members.fetch(full.id).catch(() => null) : null;
      await this.refs.setReaction(ref.id, userInfo(full, member), emoji!, added);
    } catch (err) {
      log.warn('반응 동기화 실패', err);
    }
  }
}

export async function startBot(ctx: AppContext): Promise<BotRuntime> {
  const bot = new BotRuntime(ctx);
  if (ctx.config.archiveDriver === 'discord') ctx.refs.setArchive(bot.archive);
  await bot.start();
  return bot;
}
