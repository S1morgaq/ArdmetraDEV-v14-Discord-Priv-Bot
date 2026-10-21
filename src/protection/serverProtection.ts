import { AuditLogEvent, type Guild, type GuildEditOptions } from 'discord.js';
import { getProtection } from '../services/protectionService';
import { logEvent } from '../services/loggerService';
import { enforce, getUntrustedExecutor, protectionQueue } from './guard';
import { recordNukeAction } from './antiNuke';
import { errorMessage } from '../utils/logger';

export async function handleGuildUpdate(oldGuild: Guild, newGuild: Guild): Promise<void> {
  const { serverProtection, antiNuke } = await getProtection(newGuild.id);
  if (!serverProtection.enabled && !antiNuke.enabled) return;

  const edit: GuildEditOptions = { reason: 'Server Protection: reverting unauthorized change' };
  const reverted: string[] = [];
  const notRevertable: string[] = [];

  if (oldGuild.name !== newGuild.name) {
    edit.name = oldGuild.name;
    reverted.push('name');
  }
  if (oldGuild.icon !== newGuild.icon) {
    edit.icon = oldGuild.iconURL({ extension: 'png', size: 1024 });
    reverted.push('icon');
  }
  if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
    edit.verificationLevel = oldGuild.verificationLevel;
    reverted.push('verification level');
  }
  if (oldGuild.explicitContentFilter !== newGuild.explicitContentFilter) {
    edit.explicitContentFilter = oldGuild.explicitContentFilter;
    reverted.push('explicit content filter');
  }
  if (oldGuild.defaultMessageNotifications !== newGuild.defaultMessageNotifications) {
    edit.defaultMessageNotifications = oldGuild.defaultMessageNotifications;
    reverted.push('default notifications');
  }
  if (oldGuild.afkChannelId !== newGuild.afkChannelId) {
    edit.afkChannel = oldGuild.afkChannelId;
    reverted.push('AFK channel');
  }
  if (oldGuild.systemChannelId !== newGuild.systemChannelId) {
    edit.systemChannel = oldGuild.systemChannelId;
    reverted.push('system channel');
  }
  // The Discord API offers no bot endpoint to set a vanity URL or to safely toggle Community mode.
  if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) notRevertable.push('vanity URL');
  if (oldGuild.features.includes('COMMUNITY') !== newGuild.features.includes('COMMUNITY')) {
    notRevertable.push('Community mode');
  }
  if (oldGuild.rulesChannelId !== newGuild.rulesChannelId || oldGuild.publicUpdatesChannelId !== newGuild.publicUpdatesChannelId) {
    notRevertable.push('rules / community updates channel');
  }

  if (reverted.length === 0 && notRevertable.length === 0) return;

  const executorId = await getUntrustedExecutor(newGuild, { types: [AuditLogEvent.GuildUpdate], targetId: newGuild.id });
  if (!executorId) return;

  const doRevert = serverProtection.enabled && serverProtection.revert && reverted.length > 0;
  if (doRevert) {
    protectionQueue.enqueue(newGuild.id, async () => {
      try {
        await newGuild.edit(edit);
      } catch (error) {
        await logEvent(newGuild, {
          category: 'GUILD',
          title: 'SERVER PROTECTION — Revert failed',
          description: errorMessage(error),
        });
      }
    });
  }

  const actionTaken = serverProtection.enabled
    ? await enforce(newGuild, executorId, serverProtection.action, 'Server Protection: unauthorized server update')
    : null;
  await logEvent(newGuild, {
    category: 'GUILD',
    title: 'SERVER PROTECTION — Server Updated',
    executorId,
    fields: [
      { name: 'Reverted', value: doRevert ? reverted.join(', ') : 'None', inline: false },
      ...(notRevertable.length > 0
        ? [{ name: 'Cannot be reverted (Discord API limitation)', value: notRevertable.join(', '), inline: false }]
        : []),
    ],
    actionTaken,
  });
  await recordNukeAction(newGuild, executorId, 'guildUpdate');
}
