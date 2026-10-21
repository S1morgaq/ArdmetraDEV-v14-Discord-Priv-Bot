import type { Guild } from 'discord.js';
import { findAuditEntry, type FindOptions } from './auditLog';
import { isTrusted } from './whitelist';
import { punish, describeResult } from './punisher';
import { getProtection } from '../services/protectionService';
import { KeyedQueue } from '../utils/queue';
import type { PunishAction } from '../types/protection';

/**
 * All corrective Discord API work (restoring channels, deleting rogue roles ...) goes through this
 * queue: one lane per guild, spaced out, bounded. An attack cannot turn into a REST request flood.
 */
export const protectionQueue = new KeyedQueue('protection', 250, 60);

/**
 * Resolves who caused an event via the audit log and returns their id only when they are NOT trusted
 * (not this bot, not the guild owner, not whitelisted). Returns null when the actor is unknown or trusted.
 */
export async function getUntrustedExecutor(guild: Guild, options: FindOptions): Promise<string | null> {
  const entry = await findAuditEntry(guild, options);
  if (!entry?.executorId) return null;
  if (await isTrusted(guild, entry.executorId)) return null;
  return entry.executorId;
}

/** Applies a configured punishment and returns a printable summary for the log embed. */
export async function enforce(guild: Guild, userId: string, action: PunishAction, reason: string): Promise<string> {
  const settings = await getProtection(guild.id);
  const result = await punish(guild, userId, action, reason, settings.general.timeoutSeconds);
  return describeResult(result);
}
