import { ChannelType, EmbedBuilder, MessageFlags, type ChatInputCommandInteraction, type Message, type NewsChannel, type TextChannel } from 'discord.js';
import { config } from '../config';
import { E } from './emojis';
import { withCard, type CardOptions } from './card';

export const COLORS = {
  ok: 0x2ecc71,
  error: 0xff4757,
  info: 0x7289da,
  spotify: 0x1db954,
  snipe: 0xff6b9d,
} as const;

/** Every embed shares the same footer + timestamp so the bot looks consistent. */
export function brand(embed: EmbedBuilder): EmbedBuilder {
  return embed.setFooter({ text: `👁️ ${config.tagline}` }).setTimestamp();
}

export const okEmbed = (text: string): EmbedBuilder => brand(new EmbedBuilder().setColor(COLORS.ok).setDescription(`${E.ok} ${text}`));
export const errEmbed = (text: string): EmbedBuilder => brand(new EmbedBuilder().setColor(COLORS.error).setDescription(`${E.error} ${text}`));
export const infoEmbed = (title: string, text?: string): EmbedBuilder => {
  const embed = brand(new EmbedBuilder().setColor(COLORS.info).setTitle(title));
  return text ? embed.setDescription(text) : embed;
};

/** Status messages (errors and "done" confirmations) clean themselves up after this long. */
export const TEMP_MESSAGE_MS = 5000;

/** Replies (or edits the deferred reply) with an error embed that disappears after 5 seconds. */
export async function fail(interaction: ChatInputCommandInteraction, message: string): Promise<void> {
  const payload = await statusCard('error', 'Something went wrong', message, interaction.user.displayAvatarURL({ extension: 'png', size: 128 }));
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  deleteReplyLater(interaction);
}

/** Confirmation embed that disappears after 5 seconds (the action itself is recorded in the log channel). */
export async function succeed(interaction: ChatInputCommandInteraction, message: string): Promise<void> {
  const payload = await statusCard('ok', 'Done', message, interaction.user.displayAvatarURL({ extension: 'png', size: 128 }));
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.reply(payload);
  deleteReplyLater(interaction);
}

/**
 * Colourful animated card for confirmations / errors. Discord markup (mentions, bold, code) cannot be drawn
 * on a canvas, so it is stripped for the picture while the full text stays in the embed description.
 */
async function statusCard(kind: 'ok' | 'error', title: string, message: string, avatarUrl: string) {
  const plain = message.replace(/<@[!&]?(\d+)>/g, '@user').replace(/<#(\d+)>/g, '#channel').replace(/[*_`~|]/g, '');
  const embed = kind === 'ok' ? okEmbed(message) : errEmbed(message);
  const payload = await withCard(embed, { kind, chip: kind === 'ok' ? 'Success' : 'Error', title, text: plain, avatarUrl });
  if (payload.rendered && plain.length <= 90) embed.setDescription(null); // the card already says it
  return { embeds: payload.embeds, files: payload.files };
}

function deleteReplyLater(interaction: ChatInputCommandInteraction): void {
  setTimeout(() => {
    interaction.deleteReply().catch(() => undefined);
  }, TEMP_MESSAGE_MS).unref();
}

/**
 * Prefix-command equivalent: replies with the embed and removes the reply (and, for errors,
 * the user's command message) after 5 seconds.
 */
export async function replyTemp(message: Message, embed: EmbedBuilder, alsoDeleteInvoker = false): Promise<void> {
  const sent = await message.reply(
    await statusCard('error', 'Something went wrong', embed.data.description?.replace(/^\S+\s/, '') ?? 'Error', message.author.displayAvatarURL({ extension: 'png', size: 128 })),
  );
  setTimeout(() => {
    sent.delete().catch(() => undefined);
    if (alsoDeleteInvoker) message.delete().catch(() => undefined);
  }, TEMP_MESSAGE_MS).unref();
}

/** Text or announcement channel from the `channel` option, falling back to the current channel. */
export function resolveTextChannel(interaction: ChatInputCommandInteraction<'cached'>): TextChannel | NewsChannel | null {
  const picked = interaction.options.getChannel('channel');
  const channel = picked ?? interaction.channel;
  if (!channel) return null;
  if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) return channel as TextChannel | NewsChannel;
  return null;
}

/** Attaches an animated card to any embed and drops the (now redundant) embed title when the card rendered. */
export async function cardReply(embed: EmbedBuilder, options: CardOptions) {
  const payload = await withCard(embed, options);
  if (payload.rendered) embed.setTitle(null);
  return { embeds: payload.embeds, files: payload.files };
}