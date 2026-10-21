import { GuildVerificationLevel, type Guild, type GuildMember } from 'discord.js';
import { getProtection } from '../services/protectionService';
import { getGuildSettings, invalidateGuild } from '../services/guildService';
import { logEvent } from '../services/loggerService';
import { GuildModel, type GuildDoc } from '../database/models/Guild';
import { TtlCache } from '../utils/cache';
import { errorMessage, logger } from '../utils/logger';
import { protectionQueue } from './guard';
import { isTrusted } from './whitelist';

interface Join {
  id: string;
  at: number;
}

const MAX_TRACKED_JOINS = 600;
const joins = new Map<string, Join[]>();
/** While a guild is in here a raid is considered active: no re-trigger, extra joiners get the same treatment. */
const activeRaids = new TtlCache<string, true>({ ttlMs: 120_000, max: 2000 });

function trackJoin(guildId: string, join: Join, windowMs: number): Join[] {
  let list = joins.get(guildId);
  if (!list) {
    list = [];
    joins.set(guildId, list);
  }
  list.push(join);
  const cutoff = join.at - windowMs;
  while (list.length > 0 && list[0].at < cutoff) list.shift();
  if (list.length > MAX_TRACKED_JOINS) list.splice(0, list.length - MAX_TRACKED_JOINS);
  return list;
}

/** Drops stale join lists so idle guilds do not keep arrays alive. Called by the scheduler. */
export function pruneRaidState(): void {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [guildId, list] of joins) {
    if (list.length === 0 || list[list.length - 1].at < cutoff) joins.delete(guildId);
  }
}

export async function handleMemberJoin(member: GuildMember): Promise<void> {
  if (member.user.bot) return; // bots are handled by Bot Protection
  const guild = member.guild;
  const { antiRaid } = await getProtection(guild.id);
  if (!antiRaid.enabled) return;

  // False-positive control: optionally only count fresh accounts.
  if (antiRaid.newAccountDays > 0) {
    const ageDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
    if (ageDays >= antiRaid.newAccountDays) return;
  }

  const now = Date.now();
  const recent = trackJoin(guild.id, { id: member.id, at: now }, antiRaid.interval);

  if (activeRaids.has(guild.id)) {
    // Raid already detected: joiners during the cooldown get the configured punishment as well.
    if (antiRaid.action === 'KICK' || antiRaid.action === 'BAN') await punishJoiners(guild, [member.id], antiRaid.action);
    return;
  }
  if (recent.length < antiRaid.joinLimit) return;

  activeRaids.set(guild.id, true, antiRaid.cooldownSeconds * 1000);
  const ids = [...new Set(recent.map((j) => j.id))];
  joins.delete(guild.id);

  let actionTaken: string;
  switch (antiRaid.action) {
    case 'LOG':
      actionTaken = 'LOG ✅ — Logged only';
      break;
    case 'ALERT':
      actionTaken = await alertOwner(guild, ids.length, antiRaid.interval);
      break;
    case 'LOCK':
      actionTaken = await startLockdown(guild, antiRaid.lockdownSeconds);
      break;
    case 'KICK':
    case 'BAN':
      actionTaken = await punishJoiners(guild, ids, antiRaid.action);
      break;
  }

  await logEvent(guild, {
    category: 'PROTECTION',
    title: 'ANTI-RAID — Raid detected',
    description: `**${ids.length}** members joined within **${Math.round(antiRaid.interval / 1000)}s** (limit ${antiRaid.joinLimit}).`,
    fields: [{ name: 'Sample', value: ids.slice(0, 10).map((id) => `<@${id}>`).join(' ') || '—', inline: false }],
    actionTaken,
  });
}

async function alertOwner(guild: Guild, count: number, intervalMs: number): Promise<string> {
  try {
    const owner = await guild.fetchOwner();
    await owner.send(
      `🚨 **Raid alert for ${guild.name}**: ${count} members joined within ${Math.round(intervalMs / 1000)}s. ` +
        'Check your log channel and consider enabling a lockdown.',
    );
    return 'ALERT ✅ — Owner notified by DM';
  } catch {
    return 'ALERT ✅ — Owner DMs are closed; see log channel';
  }
}

async function punishJoiners(guild: Guild, ids: string[], action: 'KICK' | 'BAN'): Promise<string> {
  const me = guild.members.me;
  if (!me) return `${action} ❌ — bot member unavailable`;

  // Never touch trusted accounts, even if they happened to join during the raid window.
  const targets: string[] = [];
  for (const id of ids) if (!(await isTrusted(guild, id))) targets.push(id);
  if (targets.length === 0) return `${action} ✅ — nothing to do`;

  if (action === 'BAN') {
    if (!me.permissions.has('BanMembers')) return 'BAN ❌ — bot lacks Ban Members';
    // A single bulk-ban request replaces up to 200 individual ones.
    for (let i = 0; i < targets.length; i += 200) {
      const batch = targets.slice(i, i + 200);
      protectionQueue.enqueue(guild.id, async () => {
        await guild.bans.bulkCreate(batch, { reason: 'Anti-Raid: raid participant' });
      });
    }
    return `BAN ✅ — bulk ban queued for ${targets.length} accounts`;
  }

  if (!me.permissions.has('KickMembers')) return 'KICK ❌ — bot lacks Kick Members';
  for (const id of targets) {
    protectionQueue.enqueue(guild.id, async () => {
      const target = guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null));
      if (target?.kickable) await target.kick('Anti-Raid: raid participant');
    });
  }
  return `KICK ✅ — ${targets.length} kicks queued`;
}

/** Raises verification to the maximum and pauses invites. State is persisted so it survives restarts. */
export async function startLockdown(guild: Guild, seconds: number): Promise<string> {
  const me = guild.members.me;
  if (!me?.permissions.has('ManageGuild')) return 'LOCK ❌ — bot lacks Manage Server';

  const settings = await getGuildSettings(guild.id);
  const until = new Date(Date.now() + seconds * 1000);

  if (!settings.lockdown.active) {
    const invitesDisabled = guild.features.includes('INVITES_DISABLED');
    await GuildModel.updateOne(
      { guildId: guild.id },
      {
        $set: {
          'lockdown.active': true,
          'lockdown.until': until,
          'lockdown.previousVerificationLevel': guild.verificationLevel,
          'lockdown.previousInvitesDisabled': invitesDisabled,
        },
      },
    );
    try {
      await guild.setVerificationLevel(GuildVerificationLevel.VeryHigh, 'Anti-Raid lockdown');
      if (!invitesDisabled) await guild.disableInvites(true);
    } catch (error) {
      await GuildModel.updateOne({ guildId: guild.id }, { $set: { 'lockdown.active': false } });
      invalidateGuild(guild.id);
      return `LOCK ❌ — ${errorMessage(error)}`;
    }
  } else {
    await GuildModel.updateOne({ guildId: guild.id }, { $set: { 'lockdown.until': until } });
  }
  invalidateGuild(guild.id);
  return `LOCK ✅ — verification raised and invites paused for ${Math.round(seconds / 60)} min`;
}

export async function endLockdown(guild: Guild): Promise<boolean> {
  const settings = await GuildModel.findOne({ guildId: guild.id }).lean<GuildDoc>();
  if (!settings?.lockdown.active) return false;
  try {
    if (settings.lockdown.previousVerificationLevel !== null) {
      await guild.setVerificationLevel(settings.lockdown.previousVerificationLevel, 'Anti-Raid lockdown ended');
    }
    if (!settings.lockdown.previousInvitesDisabled) await guild.disableInvites(false);
  } catch (error) {
    logger.warn(`[ANTIRAID] Could not fully end lockdown in ${guild.id}: ${errorMessage(error)}`);
  }
  await GuildModel.updateOne(
    { guildId: guild.id },
    { $set: { 'lockdown.active': false, 'lockdown.until': null, 'lockdown.previousVerificationLevel': null } },
  );
  invalidateGuild(guild.id);
  await logEvent(guild, { category: 'PROTECTION', title: 'ANTI-RAID — Lockdown ended', actionTaken: 'Verification level and invites restored' });
  return true;
}

/** Called on startup and by the scheduler: ends expired lockdowns, even ones started before a restart. */
export async function expireLockdowns(getGuild: (id: string) => Guild | undefined): Promise<void> {
  const due = await GuildModel.find({ 'lockdown.active': true, 'lockdown.until': { $lte: new Date() } })
    .select('guildId')
    .lean<Pick<GuildDoc, 'guildId'>[]>();
  for (const { guildId } of due) {
    const guild = getGuild(guildId);
    if (guild) await endLockdown(guild);
  }
}
