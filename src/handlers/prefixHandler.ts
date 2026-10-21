import path from 'node:path';
import { PermissionFlagsBits, type Message } from 'discord.js';
import type { BotClient } from '../client';
import type { PrefixCommand } from '../types/handlers';
import { config } from '../config';
import { isTrusted } from '../protection/whitelist';
import { TtlCache } from '../utils/cache';
import { loadDefault, walkModules } from '../utils/files';
import { errEmbed, replyTemp } from '../utils/reply';
import { errorMessage, logger } from '../utils/logger';
import { BRIDGE_ALIASES, runSlashAsPrefix } from './slashBridge';

const PREFIX_DIR = path.join(__dirname, '..', 'prefix');
const cooldowns = new TtlCache<string, number>({ ttlMs: 60_000, max: 20_000 });

export function loadPrefixCommands(client: BotClient): number {
  client.prefixCommands.clear();
  for (const file of walkModules(PREFIX_DIR)) {
    try {
      const loaded = loadDefault<PrefixCommand | PrefixCommand[]>(file);
      for (const command of Array.isArray(loaded) ? loaded : loaded ? [loaded] : []) {
        if (!command.name || typeof command.execute !== 'function') continue;
        client.prefixCommands.set(command.name, command);
        for (const alias of command.aliases ?? []) client.prefixCommands.set(alias, command);
      }
    } catch (error) {
      logger.error(`[PREFIX] Failed to load ${file}: ${errorMessage(error)}`);
    }
  }
  return new Set(client.prefixCommands.values()).size;
}

/** Returns true when the message was a prefix command (handled or rejected). */
export async function handlePrefixCommand(message: Message, client: BotClient): Promise<boolean> {
  if (!message.inGuild() || message.author.bot || !message.content.startsWith(config.prefix)) return false;

  const body = message.content.slice(config.prefix.length).trim();
  const [rawName = '', ...args] = body.split(/\s+/);
  const name = rawName.toLowerCase();
  const command = client.prefixCommands.get(name);
  if (!command) return handleSlashAsPrefix(message, client, name, body.slice(rawName.length).trim());

  const member = message.member;
  if (command.memberPermissions?.some((p) => !member?.permissions.has(p))) {
    await replyTemp(message, errEmbed('You do not have permission to use this command.'), true).catch(() => undefined);
    return true;
  }
  if (command.guard && !(await isTrusted(message.guild, message.author.id))) {
    await replyTemp(message, errEmbed('🛡️ Guard: only the server owner and whitelisted users can use this command.'), true).catch(() => undefined);
    return true;
  }
  if (command.cooldown) {
    const key = `${message.author.id}:${command.name}`;
    const until = cooldowns.get(key);
    if (until && until > Date.now()) return true;
    cooldowns.set(key, Date.now() + command.cooldown * 1000, command.cooldown * 1000);
  }

  try {
    await command.execute(message, args, client);
  } catch (error) {
    logger.error(`[PREFIX] ${command.name} failed: ${error instanceof Error ? (error.stack ?? error.message) : errorMessage(error)}`);
    await replyTemp(message, errEmbed('Something went wrong while running that command.')).catch(() => undefined);
  }
  return true;
}

/**
 * Every slash command is also a prefix command: ".ban @user reason". Same rules as the slash version:
 * permissions, guard, bot permissions and cooldown are all checked before it runs.
 */
async function handleSlashAsPrefix(message: Message<true>, client: BotClient, name: string, args: string): Promise<boolean> {
  const command = client.commands.get(BRIDGE_ALIASES[name] ?? name);
  if (!command) return false;
  const reject = (text: string) => replyTemp(message, errEmbed(text), true).catch(() => undefined);

  const member = message.member;
  if (command.memberPermissions?.some((p) => !member?.permissions.has(p))) {
    await reject('You do not have permission to use this command.');
    return true;
  }
  if (command.guard && !(await isTrusted(message.guild, message.author.id))) {
    await reject('🛡️ Guard: only the server owner and whitelisted users can use this command.');
    return true;
  }
  const me = message.guild.members.me;
  const channelPerms = me ? message.channel.permissionsFor(me) : null;
  if (command.botPermissions?.some((p) => !channelPerms?.has(p)) || !channelPerms?.has(PermissionFlagsBits.SendMessages)) {
    await reject('I am missing the permissions needed to do that in this channel.');
    return true;
  }
  if (command.cooldown) {
    const key = `${message.author.id}:slash:${command.data.name}`;
    const until = cooldowns.get(key);
    if (until && until > Date.now()) return true;
    cooldowns.set(key, Date.now() + command.cooldown * 1000, command.cooldown * 1000);
  }

  try {
    const outcome = await runSlashAsPrefix(message, command, args, client, config.prefix);
    if (outcome.error) await reject(outcome.error);
  } catch (error) {
    logger.error(`[PREFIX] ${command.data.name} (slash bridge) failed: ${error instanceof Error ? (error.stack ?? error.message) : errorMessage(error)}`);
    await replyTemp(message, errEmbed('Something went wrong while running that command.')).catch(() => undefined);
  }
  return true;
}