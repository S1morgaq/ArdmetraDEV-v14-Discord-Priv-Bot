import { AuditLogEvent, type GuildBan, type GuildMember, type PartialGuildMember } from 'discord.js';
import { getProtection } from '../services/protectionService';
import { findAuditEntry } from './auditLog';
import { isTrusted } from './whitelist';
import { recordNukeAction } from './antiNuke';

/** Feeds bans into the Anti-Nuke counters. */
export async function handleBanAdd(ban: GuildBan): Promise<void> {
  const guild = ban.guild;
  const { antiNuke } = await getProtection(guild.id);
  if (!antiNuke.enabled) return;

  const entry = await findAuditEntry(guild, { types: [AuditLogEvent.MemberBanAdd], targetId: ban.user.id, consume: true });
  if (!entry?.executorId || (await isTrusted(guild, entry.executorId))) return;
  await recordNukeAction(guild, entry.executorId, 'ban', `Last banned: ${ban.user.tag}`);
}

/**
 * A member leaving is only interesting when it was a kick. Audit lookups are coalesced per guild,
 * so a wave of ordinary leaves costs at most one REST call per ~300ms.
 */
export async function handleMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
  const guild = member.guild;
  const { antiNuke } = await getProtection(guild.id);
  if (!antiNuke.enabled) return;

  const entry = await findAuditEntry(guild, {
    types: [AuditLogEvent.MemberKick],
    targetId: member.id,
    consume: true,
    retry: false,
    maxAgeMs: 5000,
  });
  if (!entry?.executorId || (await isTrusted(guild, entry.executorId))) return;
  await recordNukeAction(guild, entry.executorId, 'kick', `Last kicked: <@${member.id}>`);
}
