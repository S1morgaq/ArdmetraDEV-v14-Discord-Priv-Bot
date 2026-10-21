import { PermissionFlagsBits, type Guild, type GuildMember } from 'discord.js';
import type { PunishAction } from '../types/protection';
import { addWarning } from '../services/moderationService';
import { notifyModeration, type DmAction } from '../services/dmService';
import { hasDangerousPermission } from '../utils/hierarchy';
import { TtlCache } from '../utils/cache';
import { errorMessage } from '../utils/logger';

export interface PunishResult {
  action: PunishAction;
  success: boolean;
  note: string;
}

/** Same target + same action is applied at most once per 30s: no duplicate ban/kick requests. */
const recent = new TtlCache<string, PunishResult>({ ttlMs: 30_000, max: 3000 });

const REQUIRED: Record<Exclude<PunishAction, 'LOG' | 'WARN'>, { flag: bigint; label: string }> = {
  BAN: { flag: PermissionFlagsBits.BanMembers, label: 'Ban Members' },
  KICK: { flag: PermissionFlagsBits.KickMembers, label: 'Kick Members' },
  TIMEOUT: { flag: PermissionFlagsBits.ModerateMembers, label: 'Moderate Members' },
  REMOVE_ROLES: { flag: PermissionFlagsBits.ManageRoles, label: 'Manage Roles' },
};

const AUTO_NAME = 'Priv Bot koruma sistemi';

const fail = (action: PunishAction, note: string): PunishResult => ({ action, success: false, note });
const ok = (action: PunishAction, note: string): PunishResult => ({ action, success: true, note });

export function describeResult(result: PunishResult): string {
  return `${result.action} ${result.success ? '✅' : '❌'} — ${result.note}`;
}

export async function punish(
  guild: Guild,
  userId: string,
  action: PunishAction,
  reason: string,
  timeoutSeconds = 3600,
): Promise<PunishResult> {
  const key = `${guild.id}:${userId}:${action}`;
  const previous = recent.get(key);
  if (previous) return { ...previous, note: `${previous.note} (already applied)` };

  let result: PunishResult;
  try {
    result = await execute(guild, userId, action, reason.slice(0, 500), timeoutSeconds);
  } catch (error) {
    result = fail(action, `error: ${errorMessage(error)}`);
  }
  recent.set(key, result);
  return result;
}

async function execute(
  guild: Guild,
  userId: string,
  action: PunishAction,
  reason: string,
  timeoutSeconds: number,
): Promise<PunishResult> {
  if (action === 'LOG') return ok(action, 'Logged only');
  if (userId === guild.client.user.id) return fail(action, 'Target is this bot');
  if (userId === guild.ownerId) return fail(action, 'Target is the server owner');

  const me = guild.members.me;
  if (!me) return fail(action, 'Bot member is not available');

  const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));

  if (action === 'WARN') {
    const count = await addWarning(guild.id, userId, guild.client.user.id, reason);
    if (member) await notifyModeration(member.user, { guild, action: 'WARN', moderator: AUTO_NAME, reason, warnCount: count });
    return ok(action, `Warning #${count} recorded`);
  }

  const needed = REQUIRED[action];
  if (!me.permissions.has(needed.flag)) return fail(action, `Bot lacks the "${needed.label}" permission`);
  if (member && me.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
    return fail(action, 'Target has an equal or higher role than the bot');
  }
  if (!member && action !== 'BAN') return fail(action, 'Target is no longer in the server');

  // The DM starts right before the action but is never awaited: during an attack the punishment must not wait
  // for card rendering. (Administrators get their roles stripped instead of a timeout, so no DM for that case.)
  const strippedInstead = action === 'TIMEOUT' && member?.permissions.has(PermissionFlagsBits.Administrator);
  if (member && !strippedInstead && (action === 'BAN' || action === 'KICK' || action === 'TIMEOUT')) {
    void notifyModeration(member.user, {
      guild,
      action: action as DmAction,
      moderator: AUTO_NAME,
      reason,
      durationMs: action === 'TIMEOUT' ? Math.min(timeoutSeconds, 2_419_200) * 1000 : null,
    }).catch(() => undefined);
  }

  switch (action) {
    case 'BAN':
      await guild.members.ban(userId, { reason, deleteMessageSeconds: 0 });
      return ok(action, 'Banned');
    case 'KICK':
      await (member as GuildMember).kick(reason);
      return ok(action, 'Kicked');
    case 'TIMEOUT': {
      const target = member as GuildMember;
      // Discord refuses to time out administrators; strip their dangerous roles instead.
      if (target.permissions.has(PermissionFlagsBits.Administrator)) {
        return removeRoles(guild, target, me, reason, 'Target is an administrator, roles stripped instead.');
      }
      await target.timeout(Math.min(timeoutSeconds, 2_419_200) * 1000, reason);
      return ok(action, `Timed out for ${timeoutSeconds}s`);
    }
    case 'REMOVE_ROLES':
      return removeRoles(guild, member as GuildMember, me, reason);
    default:
      return fail(action, 'Unsupported action');
  }
}

async function removeRoles(
  guild: Guild,
  member: GuildMember,
  me: GuildMember,
  reason: string,
  prefix = '',
): Promise<PunishResult> {
  const removable = member.roles.cache.filter(
    (role) =>
      role.id !== guild.id &&
      !role.managed &&
      hasDangerousPermission(role.permissions) &&
      me.roles.highest.comparePositionTo(role) > 0,
  );

  if (removable.size === 0) {
    // Bots hold a managed (integration) role that cannot be removed: kicking is the only way to disarm them.
    if (member.user.bot && me.permissions.has(PermissionFlagsBits.KickMembers)) {
      await member.kick(reason);
      return ok('REMOVE_ROLES', `${prefix} Managed bot roles cannot be removed, bot kicked instead.`.trim());
    }
    return fail('REMOVE_ROLES', `${prefix} No removable dangerous roles found.`.trim());
  }

  const ids = [...removable.keys()];
  await member.roles.remove(ids, reason);
  return ok('REMOVE_ROLES', `${prefix} Removed roles: ${ids.map((id) => `<@&${id}>`).join(', ')}`.trim());
}
