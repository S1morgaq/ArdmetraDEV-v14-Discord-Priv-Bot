import { PermissionFlagsBits, type Message } from 'discord.js';
import { getProtection } from '../services/protectionService';
import { logEvent } from '../services/loggerService';
import { SlidingCounter } from '../utils/counter';
import { TtlCache } from '../utils/cache';
import { punish, describeResult } from './punisher';
import { isTrusted } from './whitelist';
import type { ProtectionSettings } from '../types/protection';

const rate = new SlidingCounter();
const lastMessage = new TtlCache<string, { content: string; count: number }>({ ttlMs: 30_000, max: 20_000 });
/** Suppresses repeated logs/punishments for the same user while they keep spamming. */
const handled = new TtlCache<string, true>({ ttlMs: 15_000, max: 10_000 });

const LINK_RE = /(?:https?:\/\/|www\.|discord\.gg\/)\S+/gi;
const EMOJI_RE = /<a?:\w{2,}:\d{17,20}>|\p{Extended_Pictographic}/gu;
const EVERYONE_RE = /@(?:everyone|here)/;

function countMatches(text: string, re: RegExp): number {
  return text.match(re)?.length ?? 0;
}

function detect(message: Message<true>, config: ProtectionSettings['antiSpam']): string | null {
  const content = message.content;
  const key = `${message.guildId}:${message.author.id}`;

  if (config.blockEveryone && EVERYONE_RE.test(content) && !message.member?.permissions.has(PermissionFlagsBits.MentionEveryone)) {
    return '@everyone / @here abuse';
  }
  const mentions = message.mentions.users.size + message.mentions.roles.size;
  if (mentions > config.mentionLimit) return `Mention spam (${mentions} mentions)`;

  if (content.length > 0) {
    const links = countMatches(content, LINK_RE);
    if (links > config.linkLimit) return `Link spam (${links} links)`;
    const emojis = countMatches(content, EMOJI_RE);
    if (emojis > config.emojiLimit) return `Emoji spam (${emojis} emojis)`;

    const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim();
    const previous = lastMessage.get(key);
    const count = previous && previous.content === normalized ? previous.count + 1 : 1;
    lastMessage.set(key, { content: normalized, count });
    if (count >= config.duplicateLimit) return `Duplicate messages (${count}x)`;
  }

  const sent = rate.hit(key, config.interval);
  if (sent > config.messageLimit) return `Message flood (${sent} messages in ${Math.round(config.interval / 1000)}s)`;
  return null;
}

/** Returns true when the message violated the rules and was removed. */
export async function handleMessage(message: Message): Promise<boolean> {
  if (!message.inGuild() || message.author.bot || message.system || message.webhookId) return false;
  const { antiSpam, general } = await getProtection(message.guildId);
  if (!antiSpam.enabled || antiSpam.ignoredChannels.includes(message.channelId)) return false;

  const reason = detect(message, antiSpam);
  if (!reason) return false;

  const member = message.member;
  if (!member) return false;
  // Administrators and trusted users are exempt.
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return false;
  if (await isTrusted(message.guild, message.author.id)) return false;

  await message.delete().catch(() => undefined);

  const key = `${message.guildId}:${message.author.id}`;
  if (handled.has(key)) return true;
  handled.set(key, true);

  if (antiSpam.action === 'DELETE') return true;

  const result = await punish(
    message.guild,
    message.author.id,
    antiSpam.action,
    `Anti-Spam: ${reason}`,
    antiSpam.action === 'TIMEOUT' ? antiSpam.timeoutSeconds : general.timeoutSeconds,
  );
  rate.reset(key);
  lastMessage.delete(key);
  await logEvent(message.guild, {
    category: 'PROTECTION',
    title: 'ANTI-SPAM — Spam detected',
    executorId: message.author.id,
    fields: [
      { name: 'Reason', value: reason, inline: false },
      { name: 'Channel', value: `<#${message.channelId}>` },
    ],
    actionTaken: describeResult(result),
  });
  return true;
}

