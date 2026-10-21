import { PermissionFlagsBits, type Guild, type GuildMember, type Role } from 'discord.js';

export const DANGEROUS_PERMISSIONS: bigint[] = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.MentionEveryone,
];

export function hasDangerousPermission(permissions: Readonly<{ has(p: bigint): boolean }>): boolean {
  return DANGEROUS_PERMISSIONS.some((p) => permissions.has(p));
}

/**
 * Checks whether `moderator` may act on `target` and whether the bot itself can.
 * Returns a human readable reason when the action must not happen, otherwise null.
 */
export function checkMemberHierarchy(guild: Guild, moderator: GuildMember, target: GuildMember, ignoreModeratorRank = false): string | null {
  const me = guild.members.me;
  if (!me) return 'The bot is not fully loaded in this server yet.';
  if (target.id === guild.ownerId) return 'You cannot target the server owner.';
  if (target.id === me.id) return 'You cannot target the bot itself.';
  if (target.id === moderator.id) return 'You cannot target yourself.';
  if (!ignoreModeratorRank && moderator.id !== guild.ownerId && moderator.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    return 'That member has an equal or higher role than you.';
  }
  if (me.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    return 'That member has an equal or higher role than the bot.';
  }
  return null;
}

/** Whether the bot can edit/delete/assign this role given its own highest role. */
export function botCanManageRole(guild: Guild, role: Role): boolean {
  const me = guild.members.me;
  if (!me || role.managed || role.id === guild.id) return false;
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return false;
  return me.roles.highest.comparePositionTo(role) > 0;
}
