import { EmbedBuilder, PermissionFlagsBits, type Guild } from 'discord.js';
import { ActivityLogModel, type LogCategory } from '../database/models/ActivityLog';
import { config } from '../config';
import { E } from '../utils/emojis';
import { withCard, type CardRow } from '../utils/card';
import type { IconKind } from '../utils/statusIcons';
import { getGuildSettings } from './guildService';
import { KeyedQueue } from '../utils/queue';
import { logger, errorMessage } from '../utils/logger';

export interface LogEvent {
  category: LogCategory;
  title: string;
  description?: string;
  executorId?: string | null;
  targetId?: string | null;
  actionTaken?: string | null;
  fields?: { name: string; value: string; inline?: boolean }[];
}

const STYLE: Record<LogCategory, { emoji: string; color: number }> = {
  PROTECTION: { emoji: E.shield, color: 0xed4245 },
  MODERATION: { emoji: E.ban, color: 0xf0b232 },
  GIVEAWAY: { emoji: E.giveaway, color: 0x5865f2 },
  GUILD: { emoji: E.guild, color: 0x9b59b6 },
  MEMBER: { emoji: E.member, color: 0x3ba55d },
  ROLE: { emoji: E.role, color: 0xe67e22 },
  CHANNEL: { emoji: E.channel, color: 0x1abc9c },
  WEBHOOK: { emoji: E.webhook, color: 0xeb459e },
  BOT: { emoji: E.bot, color: 0x95a5a6 },
};

const ICON: Record<LogCategory, IconKind> = {
  PROTECTION: 'shield',
  MODERATION: 'warn',
  GIVEAWAY: 'star',
  GUILD: 'info',
  MEMBER: 'ok',
  ROLE: 'info',
  CHANNEL: 'info',
  WEBHOOK: 'info',
  BOT: 'info',
};

// One lane per guild, spaced out, bounded: a raid cannot make the log sender flood the API.
const sendQueue = new KeyedQueue('discord-log', 700, 25);

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function buildLogEmbed(event: LogEvent): EmbedBuilder {
  const style = STYLE[event.category];
  const embed = new EmbedBuilder()
    .setColor(style.color)
    .setTitle(clip(`${style.emoji} ${event.category} — ${event.title}`, 256))
    .setFooter({ text: `👁️ ${config.tagline}` })
    .setTimestamp();
  if (event.description) embed.setDescription(clip(event.description, 2000));
  if (event.executorId) embed.addFields({ name: 'Executor', value: `<@${event.executorId}> (\`${event.executorId}\`)`, inline: true });
  if (event.targetId) embed.addFields({ name: 'Target', value: `\`${event.targetId}\``, inline: true });
  if (event.actionTaken) embed.addFields({ name: 'Action Taken', value: clip(event.actionTaken, 1024) });
  for (const field of event.fields ?? []) {
    embed.addFields({ name: clip(field.name, 256), value: clip(field.value || '—', 1024), inline: field.inline ?? true });
  }
  return embed;
}

/** Persists the event and posts an embed to the guild's log channel (best effort, never throws). */
export async function logEvent(guild: Guild, event: LogEvent): Promise<void> {
  ActivityLogModel.create({
    guildId: guild.id,
    category: event.category,
    title: clip(event.title, 256),
    description: clip(event.description ?? '', 2000),
    executorId: event.executorId ?? null,
    targetId: event.targetId ?? null,
    actionTaken: event.actionTaken ? clip(event.actionTaken, 500) : null,
  }).catch((error: unknown) => logger.warn(`[LOG] Could not persist activity log: ${errorMessage(error)}`));

  logger.info(
    `[${event.category}] ${guild.name} (${guild.id}): ${event.title}` +
      (event.executorId ? ` | executor=${event.executorId}` : '') +
      (event.actionTaken ? ` | action=${event.actionTaken}` : ''),
  );

  try {
    const settings = await getGuildSettings(guild.id);
    if (!settings.logChannelId) return;
    const channel = guild.channels.cache.get(settings.logChannelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) return;
    const me = guild.members.me;
    const perms = me ? channel.permissionsFor(me) : null;
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return;
    const embed = buildLogEmbed(event);
    const nameOf = (id: string) => guild.members.cache.get(id)?.displayName ?? guild.client.users.cache.get(id)?.username ?? id;
    // Discord markup cannot be drawn on an image: resolve mentions to names and strip formatting.
    const plainText = (text: string) =>
      text
        .replace(/<@!?(\d+)>/g, (_m, id: string) => nameOf(id))
        .replace(/<@&(\d+)>/g, (_m, id: string) => guild.roles.cache.get(id)?.name ?? 'role')
        .replace(/<#(\d+)>/g, (_m, id: string) => `#${guild.channels.cache.get(id)?.name ?? 'channel'}`)
        .replace(/[*_`~|]/g, '')
        .replace(/\s*\n\s*/g, ' · ')
        .trim();
    const executor = event.executorId ? (guild.client.users.cache.get(event.executorId) ?? guild.members.cache.get(event.executorId)?.user) : undefined;
    const shortTitle = event.title.includes(' — ') ? event.title.split(' — ').slice(1).join(' — ') : event.title;
    const rows: CardRow[] = [];
    if (event.executorId) rows.push({ label: 'Executor', value: nameOf(event.executorId) });
    if (event.targetId) rows.push({ label: 'Target', value: nameOf(event.targetId) });
    for (const field of event.fields ?? []) rows.push({ label: field.name, value: plainText(field.value || '—') });
    if (event.actionTaken) rows.push({ label: 'Action', value: plainText(event.actionTaken) });
    const payload = await withCard(embed, {
      kind: ICON[event.category],
      chip: event.category,
      title: shortTitle,
      text: event.description ? plainText(event.description) : undefined,
      rows,
      avatarUrl: executor?.displayAvatarURL({ extension: 'png', size: 128 }) ?? null,
    });    sendQueue.enqueue(guild.id, async () => {
      await channel.send(payload);
    });
  } catch (error) {
    logger.warn(`[LOG] Could not send log embed: ${errorMessage(error)}`);
  }
}
