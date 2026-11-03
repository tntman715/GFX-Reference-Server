import {
  type Interaction,
  type GuildMember,
  type APIInteractionGuildMember,
  MessageFlags,
  PermissionFlagsBits,
  type RepliableInteraction,
  type User,
} from 'discord.js';
import type { Config } from '../config.js';
import type { Actor, UserInfo } from '../types.js';
import { UserError } from '../util/errors.js';
import { logger } from '../util/log.js';

const log = logger('bot');

export function userInfo(user: User, member?: GuildMember | APIInteractionGuildMember | null): UserInfo {
  const nick = member && 'displayName' in member ? member.displayName : (member as APIInteractionGuildMember | null)?.nick;
  return {
    id: user.id,
    username: user.username,
    displayName: nick ?? user.globalName ?? user.username,
    avatarUrl: user.displayAvatarURL({ size: 128, extension: 'png' }),
  };
}

export function isAdmin(i: Interaction, config: Config): boolean {
  if (i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (!config.discord.adminRoleIds.length || !i.member) return false;
  const roles = i.member.roles;
  const ids = Array.isArray(roles) ? roles : [...roles.cache.keys()];
  return ids.some((r) => config.discord.adminRoleIds.includes(r));
}

export function actorOf(i: Interaction, config: Config): Actor {
  return { id: i.user.id, isAdmin: isAdmin(i, config) };
}

/** 오류를 사용자에게 보여주기 (UserError 는 메시지 그대로, 나머지는 일반 문구) */
export async function replyError(i: RepliableInteraction, err: unknown): Promise<void> {
  const message =
    err instanceof UserError ? `⚠️ ${err.message}` : '❌ 처리 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.';
  if (!(err instanceof UserError)) log.error('인터랙션 처리 실패', err);
  try {
    if (i.deferred || i.replied) await i.editReply({ content: message.slice(0, 2000), embeds: [], components: [], files: [] });
    else await i.reply({ content: message.slice(0, 2000), flags: MessageFlags.Ephemeral });
  } catch (e) {
    log.warn('오류 메시지 전송 실패', e);
  }
}

export function ephemeralFlag(isPublic: boolean | null | undefined) {
  return isPublic ? undefined : MessageFlags.Ephemeral;
}
