import type { Guild, User } from 'discord.js';
import { ModerationLogModel, type ModerationType } from '../database/models/ModerationLog';
import { WarningModel, type WarningDoc } from '../database/models/Warning';
import { nextCaseId } from './guildService';
import { logEvent } from './loggerService';
import { formatDuration } from '../utils/duration';

export interface CaseInput {
  guild: Guild;
  type: ModerationType;
  userId?: string | null;
  moderatorId: string;
  reason?: string;
  durationMs?: number | null;
}

/** Stores a numbered moderation case and mirrors it to the guild's log channel. */
export async function recordCase(input: CaseInput): Promise<number> {
  const reason = (input.reason ?? 'No reason provided').slice(0, 1000);
  const caseId = await nextCaseId(input.guild.id);
  await ModerationLogModel.create({
    guildId: input.guild.id,
    caseId,
    type: input.type,
    userId: input.userId ?? null,
    moderatorId: input.moderatorId,
    reason,
    durationMs: input.durationMs ?? null,
  });
  await logEvent(input.guild, {
    category: 'MODERATION',
    title: `Case #${caseId} — ${input.type}`,
    executorId: input.moderatorId,
    targetId: input.userId ?? null,
    fields: [
      { name: 'Reason', value: reason, inline: false },
      ...(input.durationMs ? [{ name: 'Duration', value: formatDuration(input.durationMs) }] : []),
    ],
  });
  return caseId;
}

export async function addWarning(
  guildId: string,
  userId: string,
  moderatorId: string,
  reason: string,
): Promise<number> {
  await WarningModel.create({ guildId, userId, moderatorId, reason: reason.slice(0, 1000) });
  return WarningModel.countDocuments({ guildId, userId });
}

export async function listWarnings(guildId: string, userId: string, limit = 25): Promise<WarningDoc[]> {
  return WarningModel.find({ guildId, userId }).sort({ createdAt: -1 }).limit(limit).lean<WarningDoc[]>();
}

/** Best effort DM; users with closed DMs are simply skipped. */
export async function tryDm(user: User, content: string): Promise<boolean> {
  try {
    await user.send({ content });
    return true;
  } catch {
    return false;
  }
}
