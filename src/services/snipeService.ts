import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Message, type PartialMessage } from 'discord.js';
import { config } from '../config';
import { E } from '../utils/emojis';
import { TtlCache } from '../utils/cache';
import { withCard } from '../utils/card';
import { COLORS, brand } from '../utils/reply';

export type SnipeKind = 'delete' | 'edit';

export interface SnipedMessage {
  authorId: string;
  authorName: string;
  authorAvatar: string;
  isBot: boolean;
  content: string;
  /** Only for edits: the content after the edit. */
  newContent?: string;
  imageUrl: string | null;
  attachmentCount: number;
  at: number;
}

const PER_CHANNEL = 10;
const store = {
  delete: new TtlCache<string, SnipedMessage[]>({ ttlMs: 60 * 60_000, max: 5000 }),
  edit: new TtlCache<string, SnipedMessage[]>({ ttlMs: 60 * 60_000, max: 5000 }),
};

function push(kind: SnipeKind, channelId: string, entry: SnipedMessage): void {
  const list = store[kind].get(channelId) ?? [];
  list.unshift(entry);
  if (list.length > PER_CHANNEL) list.length = PER_CHANNEL;
  store[kind].set(channelId, list);
}

function describe(message: Message | PartialMessage): Omit<SnipedMessage, 'content' | 'at' | 'newContent'> | null {
  if (!message.author) return null;
  const image = message.attachments?.find((a) => a.contentType?.startsWith('image/'));
  return {
    authorId: message.author.id,
    authorName: message.member?.displayName ?? message.author.username,
    authorAvatar: message.author.displayAvatarURL({ extension: 'png', forceStatic: false, size: 256 }),
    isBot: message.author.bot,
    imageUrl: image?.url ?? null,
    attachmentCount: message.attachments?.size ?? 0,
  };
}

/** Bot messages are recorded as well. Messages that were not cached (no content) are skipped. */
export function recordDeleted(message: Message | PartialMessage): void {
  if (!message.inGuild() || message.content === null) return;
  const base = describe(message);
  if (!base || (message.content.length === 0 && base.attachmentCount === 0)) return;
  push('delete', message.channelId, { ...base, content: message.content, at: Date.now() });
}

export function recordEdited(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage): void {
  if (!oldMessage.inGuild() || oldMessage.content === null || newMessage.content === null) return;
  if (oldMessage.content === newMessage.content) return;
  const base = describe(oldMessage);
  if (!base) return;
  push('edit', oldMessage.channelId, { ...base, content: oldMessage.content, newContent: newMessage.content, at: Date.now() });
}

export function getSniped(kind: SnipeKind, channelId: string): SnipedMessage[] {
  return store[kind].get(channelId) ?? [];
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function buildSnipeEmbed(kind: SnipeKind, entry: SnipedMessage, index: number, total: number): EmbedBuilder {
  const embed = brand(new EmbedBuilder())
    .setColor(kind === 'delete' ? COLORS.snipe : 0xffa502)
    .setAuthor({ name: `${entry.authorName}${entry.isBot ? ' • BOT' : ''}`, iconURL: entry.authorAvatar })
    .setThumbnail(entry.authorAvatar)
    .setTitle(kind === 'delete' ? `${E.trash} Deleted message` : `${E.edit} Edited message`)
    .setFooter({ text: `👁️ ${config.tagline} • ${index + 1}/${total}` })
    .setTimestamp(entry.at);

  if (kind === 'delete') {
    embed.setDescription(entry.content ? `>>> ${clip(entry.content, 3800)}` : '*No text content*');
  } else {
    embed.addFields(
      { name: 'Before', value: clip(entry.content || '—', 1000) },
      { name: 'After', value: clip(entry.newContent || '—', 1000) },
    );
  }
  if (entry.imageUrl) embed.setImage(entry.imageUrl);
  else if (entry.attachmentCount > 0) embed.addFields({ name: 'Attachments', value: `${entry.attachmentCount} file(s)` });
  embed.addFields({ name: 'Author', value: `<@${entry.authorId}>`, inline: true }, { name: 'When', value: `<t:${Math.floor(entry.at / 1000)}:R>`, inline: true });
  return embed;
}

/** ◀ ▶ navigation: customId snipe:nav:<d|e>:<channelId>:<index> */
export function buildSnipeRow(kind: SnipeKind, channelId: string, index: number, total: number): ActionRowBuilder<ButtonBuilder> {
  const k = kind === 'delete' ? 'd' : 'e';
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`snipe:nav:${k}:${channelId}:${index - 1}`).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(index <= 0),
    new ButtonBuilder().setCustomId(`snipe:nav:${k}:${channelId}:${index + 1}`).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(index >= total - 1),
  );
}

export interface SnipePayload {
  embeds: EmbedBuilder[];
  files: AttachmentBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

/** Embed + animated card + navigation row for one sniped message. */
export async function buildSnipePayload(kind: SnipeKind, list: SnipedMessage[], index: number, channelId: string): Promise<SnipePayload> {
  const entry = list[index];
  const embed = buildSnipeEmbed(kind, entry, index, list.length);
  const rows = [
    ...(kind === 'edit' ? [{ label: 'Before', value: entry.content || '—' }, { label: 'After', value: entry.newContent || '—' }] : []),
    { label: 'When', value: new Date(entry.at).toLocaleTimeString('en-GB') },
    { label: 'Message', value: `${index + 1} of ${list.length}` },
  ];
  const card = await withCard(embed, {
    kind: kind === 'delete' ? 'warn' : 'info',
    chip: kind === 'delete' ? 'Deleted message' : 'Edited message',
    title: entry.authorName,
    text: kind === 'delete' ? entry.content || 'No text content' : undefined,
    rows,
    avatarUrl: entry.authorAvatar,
    keepEmbed: Boolean(entry.imageUrl) || entry.attachmentCount > 0,
  });
  if (card.rendered && !card.imageOnly) {
    // Long text or attachments: the embed keeps the full content below the card.
    embed.setThumbnail(null).setAuthor(null).setFooter(null);
    if (entry.imageUrl) embed.setImage(entry.imageUrl);
  }  return {
    embeds: card.embeds,
    files: card.files,
    components: list.length > 1 ? [buildSnipeRow(kind, channelId, index, list.length)] : [],
  };
}