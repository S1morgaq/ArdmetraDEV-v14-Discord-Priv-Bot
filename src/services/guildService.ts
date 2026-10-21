import type { Guild } from 'discord.js';
import { GuildModel, type GuildDoc } from '../database/models/Guild';
import { TtlCache } from '../utils/cache';

const cache = new TtlCache<string, GuildDoc>({ ttlMs: 5 * 60_000, max: 2000 });

export function invalidateGuild(guildId: string): void {
  cache.delete(guildId);
}

/** Returns the guild's settings document, creating it on first access. Cached with a TTL. */
export async function getGuildSettings(guildId: string): Promise<GuildDoc> {
  const cached = cache.get(guildId);
  if (cached) return cached;
  const doc = await GuildModel.findOneAndUpdate(
    { guildId },
    { $setOnInsert: { guildId } },
    { upsert: true, new: true },
  ).lean<GuildDoc>();
  cache.set(guildId, doc);
  return doc;
}

/** Called when the bot joins a guild and on every startup to keep metadata fresh. */
export async function syncGuild(guild: Guild): Promise<void> {
  await GuildModel.updateOne(
    { guildId: guild.id },
    { $set: { name: guild.name, ownerId: guild.ownerId, active: true }, $setOnInsert: { guildId: guild.id } },
    { upsert: true },
  );
  invalidateGuild(guild.id);
}

export async function markGuildInactive(guildId: string): Promise<void> {
  await GuildModel.updateOne({ guildId }, { $set: { active: false } });
  invalidateGuild(guildId);
}

export async function setLogChannel(guildId: string, channelId: string | null): Promise<void> {
  await GuildModel.updateOne({ guildId }, { $set: { logChannelId: channelId } }, { upsert: true });
  invalidateGuild(guildId);
}

export type WelcomeField = 'channelId' | 'message' | 'goodbyeChannelId' | 'goodbyeMessage' | 'autoRoleId';

export async function setWelcomeField(guildId: string, field: WelcomeField, value: string | null): Promise<void> {
  await GuildModel.updateOne({ guildId }, { $set: { [`welcome.${field}`]: value } }, { upsert: true });
  invalidateGuild(guildId);
}

export async function setTagConfig(guildId: string, text: string | null, roleId: string | null): Promise<void> {
  await GuildModel.updateOne({ guildId }, { $set: { 'tag.text': text, 'tag.roleId': roleId } }, { upsert: true });
  invalidateGuild(guildId);
}

export interface RegisterConfig {
  channelId: string;
  chatChannelId: string | null;
  maleRoleId: string;
  femaleRoleId: string;
  unregisteredRoleId: string | null;
  panelMessageId: string | null;
}

export async function setRegisterConfig(guildId: string, value: RegisterConfig | null): Promise<void> {
  await GuildModel.updateOne({ guildId }, { $set: { register: value ?? { channelId: null, chatChannelId: null, maleRoleId: null, femaleRoleId: null, unregisteredRoleId: null, panelMessageId: null } } }, { upsert: true });
  invalidateGuild(guildId);
}

export async function nextCaseId(guildId: string): Promise<number> {
  const doc = await GuildModel.findOneAndUpdate(
    { guildId },
    { $inc: { caseCounter: 1 } },
    { upsert: true, new: true },
  ).lean<GuildDoc>();
  invalidateGuild(guildId);
  return doc.caseCounter;
}
