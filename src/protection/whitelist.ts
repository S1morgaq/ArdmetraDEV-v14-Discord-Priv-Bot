import type { Guild } from 'discord.js';
import { WhitelistModel, type WhitelistDoc, type WhitelistType } from '../database/models/Whitelist';
import { config } from '../config';
import { TtlCache } from '../utils/cache';

interface WhitelistSets {
  users: Set<string>;
  roles: Set<string>;
  bots: Set<string>;
}

const cache = new TtlCache<string, WhitelistSets>({ ttlMs: 5 * 60_000, max: 2000 });

export function invalidateWhitelist(guildId: string): void {
  cache.delete(guildId);
}

export async function getWhitelist(guildId: string): Promise<WhitelistSets> {
  const cached = cache.get(guildId);
  if (cached) return cached;
  const rows = await WhitelistModel.find({ guildId }).lean<WhitelistDoc[]>();
  const sets: WhitelistSets = { users: new Set(), roles: new Set(), bots: new Set() };
  for (const row of rows) {
    if (row.type === 'user') sets.users.add(row.targetId);
    else if (row.type === 'role') sets.roles.add(row.targetId);
    else sets.bots.add(row.targetId);
  }
  cache.set(guildId, sets);
  return sets;
}

export async function listWhitelist(guildId: string): Promise<WhitelistDoc[]> {
  return WhitelistModel.find({ guildId }).sort({ createdAt: 1 }).lean<WhitelistDoc[]>();
}

export async function addWhitelist(
  guildId: string,
  targetId: string,
  type: WhitelistType,
  addedBy: string,
): Promise<void> {
  await WhitelistModel.updateOne(
    { guildId, targetId },
    { $set: { type, addedBy }, $setOnInsert: { guildId, targetId } },
    { upsert: true },
  );
  invalidateWhitelist(guildId);
}

export async function removeWhitelist(guildId: string, targetId: string): Promise<boolean> {
  const result = await WhitelistModel.deleteOne({ guildId, targetId });
  invalidateWhitelist(guildId);
  return result.deletedCount > 0;
}

/**
 * Trusted actors are never punished and their actions are not reverted.
 * Order matters: this bot, the guild owner, the bot owners (BOT_OWNER_IDS), then the whitelist (user / bot / role).
 */
export async function isTrusted(guild: Guild, userId: string): Promise<boolean> {
  if (userId === guild.client.user.id) return true;
  if (userId === guild.ownerId) return true;
  if (config.dashboard.ownerIds.includes(userId)) return true;
  const list = await getWhitelist(guild.id);
  if (list.users.has(userId) || list.bots.has(userId)) return true;
  if (list.roles.size > 0) {
    const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
    if (member && member.roles.cache.some((role) => list.roles.has(role.id))) return true;
  }
  return false;
}

export async function isBotWhitelisted(guildId: string, botId: string): Promise<boolean> {
  const list = await getWhitelist(guildId);
  return list.bots.has(botId) || list.users.has(botId);
}
