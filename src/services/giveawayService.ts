import crypto from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type Message,
  type TextBasedChannel,
} from 'discord.js';
import type { Types } from 'mongoose';
import type { BotClient } from '../client';
import { GiveawayModel, type GiveawayDoc } from '../database/models/Giveaway';
import { logEvent } from './loggerService';
import { tryDm } from './moderationService';
import { withCard } from '../utils/card';
import { E } from '../utils/emojis';
import { registerInterval } from '../utils/scheduler';
import { errorMessage, logger } from '../utils/logger';

export type GiveawayLean = GiveawayDoc & { _id: Types.ObjectId };

const TICK_MS = 5000;
const MAX_REFRESH_PER_TICK = 5;
/** Giveaways whose participant count changed; their embed is refreshed in batches, not per click. */
const dirty = new Set<string>();

// ---------------------------------------------------------------- presentation

function joinRow(id: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:join:${id}`)
      .setLabel('Join / Leave')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
  );
}

function rerollRow(id: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`giveaway:reroll:${id}`).setLabel('Reroll').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
  );
}

function buildEmbed(g: GiveawayLean, withCardImage = false): EmbedBuilder {
  const ts = Math.floor(g.endsAt.getTime() / 1000);
  const embed = new EmbedBuilder().setTitle(`${E.giveaway} ${g.prize}`).setTimestamp(g.endsAt);
  if (g.cancelled) {
    return embed.setColor(0x747f8d).setDescription('This giveaway was cancelled.');
  }
  if (g.ended) {
    return embed
      .setColor(0x747f8d)
      .setDescription(
        `Ended <t:${ts}:R>\nHosted by: <@${g.hostId}>\nParticipants: **${g.participants.length}**\n` +
          `Winner${g.winners.length === 1 ? '' : 's'}: ${g.winners.length > 0 ? g.winners.map((w) => `<@${w}>`).join(', ') : 'No valid participants'}`,
      );
  }
  if (withCardImage) embed.setImage('attachment://card.gif');
  return embed
    .setColor(0x5865f2)
    .setDescription(
      `Click the button to join!\n\nEnds: <t:${ts}:R> (<t:${ts}:f>)\nHosted by: <@${g.hostId}>\n` +
        `Winners: **${g.winnerCount}**\nParticipants: **${g.participants.length}**`,
    );
}

// ---------------------------------------------------------------- helpers

function pickWinners(pool: string[], count: number): string[] {
  const copy = [...pool];
  const winners: string[] = [];
  while (winners.length < count && copy.length > 0) {
    const index = crypto.randomInt(copy.length);
    winners.push(copy[index]);
    copy.splice(index, 1);
  }
  return winners;
}

async function fetchMessage(client: BotClient, g: GiveawayLean): Promise<{ channel: TextBasedChannel | null; message: Message | null }> {
  const channel = await client.channels.fetch(g.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return { channel: null, message: null };
  const message = g.messageId ? await channel.messages.fetch(g.messageId).catch(() => null) : null;
  return { channel, message };
}

// ---------------------------------------------------------------- public API

export interface CreateGiveawayInput {
  guild: Guild;
  channelId: string;
  hostId: string;
  prize: string;
  winnerCount: number;
  durationMs: number;
}

export async function createGiveaway(input: CreateGiveawayInput): Promise<GiveawayLean> {
  const channel = input.guild.channels.cache.get(input.channelId);
  if (!channel || !channel.isTextBased() || channel.isThread()) throw new Error('Channel must be a text channel.');
  const me = input.guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
    throw new Error('The bot cannot send embeds in that channel.');
  }

  const doc = await GiveawayModel.create({
    guildId: input.guild.id,
    channelId: input.channelId,
    hostId: input.hostId,
    prize: input.prize,
    winnerCount: input.winnerCount,
    endsAt: new Date(Date.now() + input.durationMs),
  });
  const lean = doc.toObject() as GiveawayLean;

  try {
    const card = await withCard(buildEmbed(lean), {
      kind: 'star',
      keepEmbed: true,
      chip: 'Giveaway',
      title: input.prize,
      text: `Winners: ${input.winnerCount} · hosted by ${input.guild.members.cache.get(input.hostId)?.displayName ?? 'a moderator'}`,
      avatarUrl: input.guild.iconURL({ extension: 'png', size: 128 }),
    });
    const message = await channel.send({ embeds: card.embeds, files: card.files, components: [joinRow(String(doc._id))] });
    doc.messageId = message.id;
    await doc.save();
    lean.messageId = message.id;
  } catch (error) {
    await GiveawayModel.deleteOne({ _id: doc._id });
    throw new Error(`Could not post the giveaway message: ${errorMessage(error)}`);
  }

  await logEvent(input.guild, {
    category: 'GIVEAWAY',
    title: 'Giveaway started',
    executorId: input.hostId,
    fields: [{ name: 'Prize', value: input.prize }, { name: 'Winners', value: String(input.winnerCount) }],
  });
  return lean;
}

export type JoinResult = 'joined' | 'left' | 'ended';

export async function toggleParticipation(giveawayId: string, userId: string): Promise<JoinResult> {
  const left = await GiveawayModel.updateOne(
    { _id: giveawayId, ended: false, participants: userId },
    { $pull: { participants: userId } },
  );
  if (left.modifiedCount > 0) {
    markDirty(giveawayId);
    return 'left';
  }
  const joined = await GiveawayModel.updateOne(
    { _id: giveawayId, ended: false, participants: { $ne: userId } },
    { $addToSet: { participants: userId } },
  );
  if (joined.modifiedCount > 0) {
    markDirty(giveawayId);
    return 'joined';
  }
  return 'ended';
}

function markDirty(id: string): void {
  if (dirty.size < 1000) dirty.add(id);
}

/** Ends a giveaway exactly once (atomic claim), announces winners and DMs them. */
export async function endGiveaway(client: BotClient, giveawayId: string): Promise<GiveawayLean | null> {
  const claimed = await GiveawayModel.findOneAndUpdate(
    { _id: giveawayId, ended: false },
    { $set: { ended: true } },
    { new: true },
  ).lean<GiveawayLean>();
  if (!claimed) return null;

  const winners = pickWinners(claimed.participants, claimed.winnerCount);
  claimed.winners = winners;
  claimed.endsAt = new Date();
  await GiveawayModel.updateOne({ _id: claimed._id }, { $set: { winners, endsAt: claimed.endsAt } });
  await announce(client, claimed, winners, false);
  return claimed;
}

/** Picks new winners for an already ended giveaway, avoiding previous winners when possible. */
export async function rerollGiveaway(client: BotClient, giveawayId: string): Promise<GiveawayLean | null> {
  const g = await GiveawayModel.findOne({ _id: giveawayId, ended: true, cancelled: false }).lean<GiveawayLean>();
  if (!g || g.participants.length === 0) return null;
  const fresh = g.participants.filter((id) => !g.winners.includes(id));
  const pool = fresh.length >= g.winnerCount ? fresh : g.participants;
  const winners = pickWinners(pool, g.winnerCount);
  g.winners = winners;
  await GiveawayModel.updateOne({ _id: g._id }, { $set: { winners } });
  await announce(client, g, winners, true);
  return g;
}

async function announce(client: BotClient, g: GiveawayLean, winners: string[], reroll: boolean): Promise<void> {
  const guild = client.guilds.cache.get(g.guildId);
  const { channel, message } = await fetchMessage(client, g);
  try {
    if (message) {
      const card = await withCard(buildEmbed(g), {
        kind: winners.length > 0 ? 'ok' : 'warn',
        keepEmbed: true,
        chip: reroll ? 'Rerolled' : 'Giveaway ended',
        title: g.prize,
        text: winners.length > 0 ? `Winners: ${winners.length} · participants: ${g.participants.length}` : 'No valid participants',
        avatarUrl: guild?.iconURL({ extension: 'png', size: 128 }) ?? null,
      });
      await message.edit({ embeds: card.embeds, files: card.files, attachments: [], components: [rerollRow(String(g._id))] });
    }
    if (channel && 'send' in channel) {
      const text =
        winners.length > 0
          ? `🎉 ${reroll ? 'New winner' : 'Congratulations'}${winners.length > 1 ? 's' : ''} ${winners.map((w) => `<@${w}>`).join(', ')}! You won **${g.prize}**.`
          : `No valid participants for **${g.prize}**.`;
      await channel.send({ content: text, allowedMentions: { users: winners }, reply: message ? { messageReference: message.id, failIfNotExists: false } : undefined });
    }
  } catch (error) {
    logger.warn(`[GIVEAWAY] Could not announce ${String(g._id)}: ${errorMessage(error)}`);
  }

  for (const id of winners) {
    const user = await client.users.fetch(id).catch(() => null);
    if (user) await tryDm(user, `🎉 You won **${g.prize}** in **${guild?.name ?? 'a server'}**!`);
  }
  if (guild) {
    await logEvent(guild, {
      category: 'GIVEAWAY',
      title: reroll ? 'Giveaway rerolled' : 'Giveaway ended',
      fields: [
        { name: 'Prize', value: g.prize },
        { name: 'Winners', value: winners.length > 0 ? winners.map((w) => `<@${w}>`).join(', ') : 'None', inline: false },
        { name: 'Participants', value: String(g.participants.length) },
      ],
    });
  }
}

/** Cancels an active giveaway (or just removes an ended one) and removes it from the database. */
export async function deleteGiveaway(client: BotClient, guildId: string, giveawayId: string): Promise<boolean> {
  const g = await GiveawayModel.findOneAndDelete({ _id: giveawayId, guildId }).lean<GiveawayLean>();
  if (!g) return false;
  if (!g.ended) {
    const { message } = await fetchMessage(client, g);
    if (message) {
      await message.edit({ embeds: [buildEmbed({ ...g, ended: true, cancelled: true })], attachments: [], components: [] }).catch(() => undefined);
    }
  }
  return true;
}

// ---------------------------------------------------------------- scheduler

async function tick(client: BotClient): Promise<void> {
  if (!client.isReady()) return;

  // Database driven: survives restarts (overdue giveaways are simply picked up here).
  const due = await GiveawayModel.find({ ended: false, endsAt: { $lte: new Date() } })
    .select('_id')
    .limit(20)
    .lean<{ _id: Types.ObjectId }[]>();
  for (const { _id } of due) {
    dirty.delete(String(_id));
    await endGiveaway(client, String(_id)).catch((error: unknown) =>
      logger.error(`[GIVEAWAY] Ending ${String(_id)} failed: ${errorMessage(error)}`),
    );
  }

  let refreshed = 0;
  for (const id of dirty) {
    if (refreshed >= MAX_REFRESH_PER_TICK) break;
    dirty.delete(id);
    refreshed++;
    const g = await GiveawayModel.findOne({ _id: id, ended: false }).lean<GiveawayLean>();
    if (!g) continue;
    const { message } = await fetchMessage(client, g);
    // Keep the animated card attached to the message (an edit without files preserves it).
    await message?.edit({ embeds: [buildEmbed(g, (message?.attachments.size ?? 0) > 0)] }).catch(() => undefined);
  }
}

export function startGiveawayScheduler(client: BotClient): void {
  registerInterval('giveaways', TICK_MS, () => tick(client));
  // Resume immediately after (re)start instead of waiting for the first interval.
  void tick(client).catch((error: unknown) => logger.error(`[GIVEAWAY] Initial tick failed: ${errorMessage(error)}`));
}
