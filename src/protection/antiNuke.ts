import type { Guild } from 'discord.js';
import { getProtection } from '../services/protectionService';
import { logEvent } from '../services/loggerService';
import { SlidingCounter } from '../utils/counter';
import { enforce } from './guard';
import { isTrusted } from './whitelist';
import type { ProtectionSettings } from '../types/protection';

export type NukeKind =
  | 'channelDelete'
  | 'roleDelete'
  | 'ban'
  | 'kick'
  | 'webhook'
  | 'permissionUpdate'
  | 'botAdd'
  | 'guildUpdate';

const counter = new SlidingCounter();

function limitFor(config: ProtectionSettings['antiNuke'], kind: NukeKind): number {
  switch (kind) {
    case 'channelDelete':
      return config.channelDeleteLimit;
    case 'roleDelete':
      return config.roleDeleteLimit;
    case 'ban':
      return config.banLimit;
    case 'kick':
      return config.kickLimit;
    case 'webhook':
      return config.webhookLimit;
    case 'permissionUpdate':
      return config.permissionUpdateLimit;
    case 'botAdd':
      return config.botAddLimit;
    case 'guildUpdate':
      return config.guildUpdateLimit;
  }
}

/**
 * Counts one critical action by `executorId` inside the guild's sliding window and punishes the
 * executor when the guild-configured limit is reached. Returns true when a nuke attempt was detected.
 */
export async function recordNukeAction(
  guild: Guild,
  executorId: string,
  kind: NukeKind,
  detail?: string,
): Promise<boolean> {
  const { antiNuke } = await getProtection(guild.id);
  if (!antiNuke.enabled) return false;
  if (await isTrusted(guild, executorId)) return false;

  const key = `${guild.id}:${executorId}:${kind}`;
  const count = counter.hit(key, antiNuke.interval);
  const limit = limitFor(antiNuke, kind);
  if (count < limit) return false;

  counter.reset(key);
  const seconds = Math.round(antiNuke.interval / 1000);
  const actionTaken = await enforce(guild, executorId, antiNuke.action, `Anti-Nuke: ${count}x ${kind} within ${seconds}s`);
  await logEvent(guild, {
    category: 'PROTECTION',
    title: 'ANTI-NUKE — Nuke attempt detected',
    description: `**${count}** × \`${kind}\` within **${seconds}s** (limit ${limit}).${detail ? `\n${detail}` : ''}`,
    executorId,
    actionTaken,
  });
  return true;
}
