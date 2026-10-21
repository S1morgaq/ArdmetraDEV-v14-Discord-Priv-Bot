import { ChannelType, type Guild } from 'discord.js';
import { ActivityLogModel, LOG_CATEGORIES, type ActivityLogDoc, type LogCategory } from '../database/models/ActivityLog';
import { ModerationLogModel, type ModerationLogDoc } from '../database/models/ModerationLog';
import { GiveawayModel } from '../database/models/Giveaway';
import type { GiveawayLean } from '../services/giveawayService';

export const PAGE_SIZE = 25;

export function iconUrl(guild: { id: string; icon: string | null }, size = 128): string | null {
  return guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${guild.icon.startsWith('a_') ? 'gif' : 'png'}?size=${size}` : null;
}

export function userAvatarUrl(user: { id: string; avatar: string | null }): string {
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith('a_') ? 'gif' : 'png'}?size=128`;
  return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
}

export function textChannels(guild: Guild): { id: string; name: string }[] {
  return guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((c) => ({ id: c.id, name: c.name }));
}

export function selectableRoles(guild: Guild): { id: string; name: string; color: string }[] {
  return guild.roles.cache
    .filter((r) => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.hexColor }));
}

export interface GuildOverview {
  id: string;
  name: string;
  icon: string | null;
  memberCount: number;
  channelCount: number;
  roleCount: number;
  ownerId: string;
  boostLevel: number;
}

export function overview(guild: Guild): GuildOverview {
  return {
    id: guild.id,
    name: guild.name,
    icon: iconUrl(guild),
    memberCount: guild.memberCount,
    channelCount: guild.channels.cache.size,
    roleCount: guild.roles.cache.size,
    ownerId: guild.ownerId,
    boostLevel: guild.premiumTier,
  };
}

export function parsePage(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : 1;
}

export function parseCategory(value: unknown): LogCategory | null {
  return typeof value === 'string' && (LOG_CATEGORIES as readonly string[]).includes(value) ? (value as LogCategory) : null;
}

export async function queryLogs(guildId: string, category: LogCategory | null, page: number) {
  const filter = category ? { guildId, category } : { guildId };
  const [items, total] = await Promise.all([
    ActivityLogModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean<ActivityLogDoc[]>(),
    ActivityLogModel.countDocuments(filter),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function queryCases(guildId: string, page: number) {
  const [items, total] = await Promise.all([
    ModerationLogModel.find({ guildId }).sort({ caseId: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean<ModerationLogDoc[]>(),
    ModerationLogModel.countDocuments({ guildId }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function queryGiveaways(guildId: string) {
  return GiveawayModel.find({ guildId }).sort({ ended: 1, endsAt: -1 }).limit(50).lean<GiveawayLean[]>();
}
