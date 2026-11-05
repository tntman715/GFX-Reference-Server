import { type Guild, PermissionFlagsBits } from 'discord.js';
import { kvRepo } from '../repos/kv.js';
import { scoresRepo } from '../repos/scores.js';
import { TIERS, type TierKey } from '../tiers.js';
import { logger } from '../util/log.js';
import type { BotRuntime } from './runtime.js';

const log = logger('tiers');
const ROLES_KEY = 'tier:roles';
const ASSIGNED_KEY = 'tier:assigned';
const INTERVAL_MS = 10 * 60_000;
/** 가끔은 기록과 상관없이 모든 사람의 역할을 다시 확인 (누가 손으로 역할을 바꿨을 때 대비) */
const FULL_CHECK_MS = 6 * 60 * 60_000;

/**
 * 랭킹 티어에 맞춰 디스코드 역할을 줍니다.
 * 역할(💎 다이아몬드 ~ 🥉 브론즈)이 없으면 만들고, 10분마다 티어가 바뀐 사람만 역할을 바꿉니다.
 * 봇에게 "역할 관리" 권한이 있어야 하고, 봇 역할이 티어 역할보다 위에 있어야 합니다.
 */
export class TierRoleSync {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastFull = 0;
  private warned = false;

  constructor(private readonly bot: BotRuntime) {}

  start(): void {
    if (!this.bot.config.discord.tierRoles || !this.bot.config.discord.guildId) return;
    const run = () => void this.sync().catch((err) => log.warn('티어 역할 갱신 실패', err));
    setTimeout(run, 15_000);
    this.timer = setInterval(run, INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 역할이 없으면 만들고, 역할 ID 를 돌려줌 */
  private async ensureRoles(guild: Guild): Promise<Record<TierKey, string>> {
    const saved = (await kvRepo.get<Partial<Record<TierKey, string>>>(this.bot.ctxDb, ROLES_KEY)) ?? {};
    const roles = await guild.roles.fetch();
    const out = {} as Record<TierKey, string>;
    // 낮은 티어부터 만들어야 높은 티어가 목록 위쪽에 생김
    for (const tier of [...TIERS].reverse()) {
      let role = (saved[tier.key] && roles.get(saved[tier.key]!)) || roles.find((r) => r.name === tier.roleName);
      if (!role) {
        role = await guild.roles.create({
          name: tier.roleName,
          color: tier.color as `#${string}`,
          hoist: false,
          mentionable: false,
          reason: 'GFX References 랭킹 티어 역할',
        });
        log.info(`티어 역할 만듦: ${tier.roleName}`);
      }
      out[tier.key] = role.id;
    }
    await kvRepo.set(this.bot.ctxDb, ROLES_KEY, out);
    return out;
  }

  async sync(): Promise<{ changed: number; total: number } | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const guildId = this.bot.config.discord.guildId;
      if (!guildId || !this.bot.client.isReady()) return null;
      const guild = await this.bot.client.guilds.fetch(guildId);
      const me = await guild.members.fetchMe();
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        if (!this.warned) log.warn('봇에게 "역할 관리" 권한이 없어 티어 역할을 줄 수 없습니다.');
        this.warned = true;
        return null;
      }
      const roleIds = await this.ensureRoles(guild);
      const allTierRoles = new Set(Object.values(roleIds));

      const { rows } = await scoresRepo.leaderboard(this.bot.ctxDb, this.bot.config.scoring, 5000, 0);
      const want = new Map<string, TierKey>(rows.map((r) => [r.userId, r.tier]));
      const prev = (await kvRepo.get<Record<string, TierKey>>(this.bot.ctxDb, ASSIGNED_KEY)) ?? {};
      const full = Date.now() - this.lastFull > FULL_CHECK_MS;

      let changed = 0;
      const assigned: Record<string, TierKey> = {};
      for (const userId of new Set([...want.keys(), ...Object.keys(prev)])) {
        const tier = want.get(userId) ?? null;
        if (!full && prev[userId] === tier && tier) {
          assigned[userId] = tier;
          continue;
        }
        const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
        if (!member) continue; // 서버를 나간 사람
        const target = tier ? roleIds[tier] : null;
        const remove = member.roles.cache.filter((r) => allTierRoles.has(r.id) && r.id !== target).map((r) => r.id);
        const add = !!target && !member.roles.cache.has(target);
        try {
          if (remove.length) await member.roles.remove(remove, '랭킹 티어 변경');
          if (add) await member.roles.add(target!, '랭킹 티어 변경');
          if (remove.length || add) changed++;
        } catch (err) {
          log.warn(`${member.user.tag} 티어 역할 변경 실패 (봇 역할이 티어 역할보다 위에 있는지 확인)`, err);
          continue;
        }
        if (tier) assigned[userId] = tier;
      }
      await kvRepo.set(this.bot.ctxDb, ASSIGNED_KEY, assigned);
      if (full) this.lastFull = Date.now();
      if (changed) log.info(`티어 역할 갱신: ${changed}명`);
      return { changed, total: want.size };
    } finally {
      this.running = false;
    }
  }
}
