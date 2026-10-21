import { EmbedBuilder, type Guild, type User } from 'discord.js';
import { formatDuration } from '../utils/duration';
import { withCard, type CardKind } from '../utils/card';
import { COLORS, brand } from '../utils/reply';
import { logger, errorMessage } from '../utils/logger';

export type DmAction = 'BAN' | 'KICK' | 'TIMEOUT' | 'WARN';

export interface ModerationDm {
  guild: Guild;
  action: DmAction;
  /** Display name of the moderator (or the protection system). */
  moderator: string;
  reason: string;
  durationMs?: number | null;
  warnCount?: number;
}

const TEXT: Record<DmAction, { title: string; verb: string; kind: CardKind; color: number }> = {
  BAN: { title: 'Yasaklandın', verb: 'sunucusundan yasaklandın', kind: 'error', color: 0xff4757 },
  KICK: { title: 'Sunucudan atıldın', verb: 'sunucusundan atıldın', kind: 'warn', color: 0xffa502 },
  TIMEOUT: { title: 'Susturuldun', verb: 'sunucusunda susturuldun', kind: 'warn', color: 0xffa502 },
  WARN: { title: 'Uyarıldın', verb: 'sunucusunda uyarıldın', kind: 'warn', color: 0xfeca57 },
};

/** Best effort: users with closed DMs are skipped. Returns whether the DM was delivered. */
export async function safeSend(user: User, payload: Parameters<User['send']>[0]): Promise<boolean> {
  try {
    await user.send(payload);
    return true;
  } catch (error) {
    logger.debug(`[DM] Could not DM ${user.id}: ${errorMessage(error)}`);
    return false;
  }
}

/** Tells the user what happened to them and who did it, as an animated card. */
export async function notifyModeration(user: User, dm: ModerationDm): Promise<boolean> {
  const t = TEXT[dm.action];
  const duration = dm.durationMs ? formatDuration(dm.durationMs) : null;
  const sentence = `${dm.moderator} tarafından ${dm.guild.name} ${t.verb}${duration ? ` (${duration})` : ''}.`;

  const embed = brand(new EmbedBuilder().setColor(t.color))
    .setTitle(t.title)
    .setDescription(`**${dm.moderator}** tarafından **${dm.guild.name}** ${t.verb}.`)
    .addFields({ name: 'Sebep', value: dm.reason.slice(0, 1000) || 'Belirtilmedi' });
  if (duration) embed.addFields({ name: 'Süre', value: duration, inline: true });
  if (dm.warnCount) embed.addFields({ name: 'Toplam uyarı', value: String(dm.warnCount), inline: true });

  const card = await withCard(embed, {
    kind: t.kind,
    chip: 'Moderasyon',
    title: t.title,
    text: sentence,
    rows: [
      { label: 'Sunucu', value: dm.guild.name },
      { label: 'Yetkili', value: dm.moderator },
      { label: 'Sebep', value: dm.reason || 'Belirtilmedi' },
      ...(duration ? [{ label: 'Süre', value: duration }] : []),
    ],
    avatarUrl: dm.guild.iconURL({ extension: 'png', size: 128 }),
    keepEmbed: true,
  });
  return safeSend(user, { embeds: card.embeds, files: card.files });
}

/** A message sent by staff through /dm. */
export async function sendStaffMessage(user: User, guild: Guild, sender: string, message: string): Promise<boolean> {
  const embed = brand(new EmbedBuilder().setColor(COLORS.info))
    .setTitle(`${guild.name} yetkilisinden mesaj`)
    .setDescription(message.slice(0, 3900))
    .addFields({ name: 'Gönderen', value: sender, inline: true }, { name: 'Sunucu', value: guild.name, inline: true });
  const card = await withCard(embed, {
    kind: 'info',
    chip: 'Mesaj',
    title: `${guild.name} yetkilisinden mesaj`,
    text: message,
    rows: [{ label: 'Gönderen', value: sender }, { label: 'Sunucu', value: guild.name }],
    avatarUrl: guild.iconURL({ extension: 'png', size: 128 }),
    keepEmbed: true,
  });
  return safeSend(user, { embeds: card.embeds, files: card.files });
}
