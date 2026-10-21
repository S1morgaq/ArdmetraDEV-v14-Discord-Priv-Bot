import {
  AuditLogEvent,
  ChannelType,
  type DMChannel,
  type GuildChannel,
  type GuildChannelCreateOptions,
  type NonThreadGuildBasedChannel,
} from 'discord.js';
import { getProtection } from '../services/protectionService';
import { logEvent } from '../services/loggerService';
import { enforce, getUntrustedExecutor, protectionQueue } from './guard';
import { recordNukeAction } from './antiNuke';
import { errorMessage } from '../utils/logger';

type AnyChannel = NonThreadGuildBasedChannel | DMChannel;

const isGuildChannel = (channel: AnyChannel): channel is NonThreadGuildBasedChannel => 'guild' in channel;

function serializeOverwrites(channel: GuildChannel): string {
  return [...channel.permissionOverwrites.cache.values()]
    .map((o) => `${o.id}:${o.type}:${o.allow.bitfield}:${o.deny.bitfield}`)
    .sort()
    .join('|');
}

function overwritePayload(channel: GuildChannel) {
  return [...channel.permissionOverwrites.cache.values()].map((o) => ({
    id: o.id,
    type: o.type,
    allow: o.allow,
    deny: o.deny,
  }));
}

/** Rebuilds creation options from a (deleted) channel object: name, type, parent, overwrites, topic, slowmode... */
function buildCreateOptions(channel: NonThreadGuildBasedChannel): GuildChannelCreateOptions {
  const guild = channel.guild;
  const options: Record<string, unknown> = {
    name: channel.name,
    type: channel.type,
    position: channel.rawPosition,
    permissionOverwrites: overwritePayload(channel),
    reason: 'Channel Protection: restoring deleted channel',
  };
  if (channel.parentId && guild.channels.cache.has(channel.parentId)) options.parent = channel.parentId;
  if ('topic' in channel && channel.topic) options.topic = channel.topic;
  if ('nsfw' in channel) options.nsfw = channel.nsfw;
  if ('rateLimitPerUser' in channel && channel.rateLimitPerUser) options.rateLimitPerUser = channel.rateLimitPerUser;
  if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
    if ('bitrate' in channel) options.bitrate = Math.min(channel.bitrate, guild.maximumBitrate);
    if ('userLimit' in channel) options.userLimit = channel.userLimit;
    if ('rtcRegion' in channel && channel.rtcRegion) options.rtcRegion = channel.rtcRegion;
  }
  return options as unknown as GuildChannelCreateOptions;
}

export async function handleChannelCreate(channel: NonThreadGuildBasedChannel): Promise<void> {
  const guild = channel.guild;
  const { channelProtection } = await getProtection(guild.id);
  if (!channelProtection.enabled || !channelProtection.create) return;

  const executorId = await getUntrustedExecutor(guild, { types: [AuditLogEvent.ChannelCreate], targetId: channel.id });
  if (!executorId) return;

  protectionQueue.enqueue(guild.id, async () => {
    await channel.delete('Channel Protection: unauthorized channel creation');
  });
  const actionTaken = await enforce(guild, executorId, channelProtection.action, 'Channel Protection: unauthorized channel creation');
  await logEvent(guild, {
    category: 'CHANNEL',
    title: 'CHANNEL PROTECTION — Channel Created',
    executorId,
    fields: [{ name: 'Channel', value: `${channel.name} (\`${channel.id}\`)` }, { name: 'Revert', value: 'Channel deleted' }],
    actionTaken,
  });
}

export async function handleChannelDelete(channel: NonThreadGuildBasedChannel): Promise<void> {
  const guild = channel.guild;
  const { channelProtection, antiNuke } = await getProtection(guild.id);
  const restore = channelProtection.enabled && channelProtection.delete;
  if (!restore && !antiNuke.enabled) return;

  const executorId = await getUntrustedExecutor(guild, { types: [AuditLogEvent.ChannelDelete], targetId: channel.id });
  if (!executorId) return;

  if (restore) {
    const options = buildCreateOptions(channel);
    protectionQueue.enqueue(guild.id, async () => {
      try {
        await guild.channels.create(options);
      } catch (error) {
        await logEvent(guild, {
          category: 'CHANNEL',
          title: 'CHANNEL PROTECTION — Restore failed',
          description: errorMessage(error),
          fields: [{ name: 'Channel', value: `${channel.name} (\`${channel.id}\`)` }],
        });
      }
    });
  }

  const actionTaken = restore
    ? await enforce(guild, executorId, channelProtection.action, 'Channel Protection: unauthorized channel deletion')
    : null;
  await logEvent(guild, {
    category: 'CHANNEL',
    title: 'CHANNEL PROTECTION — Channel Deleted',
    executorId,
    fields: [
      { name: 'Channel', value: `${channel.name} (\`${channel.id}\`)` },
      { name: 'Revert', value: restore ? 'Channel re-created with its previous settings' : 'Restore disabled' },
    ],
    actionTaken,
  });
  await recordNukeAction(guild, executorId, 'channelDelete', `Last deleted channel: ${channel.name}`);
}

export async function handleChannelUpdate(oldChannel: AnyChannel, newChannel: AnyChannel): Promise<void> {
  if (!isGuildChannel(oldChannel) || !isGuildChannel(newChannel)) return;
  const guild = newChannel.guild;
  const { channelProtection } = await getProtection(guild.id);
  if (!channelProtection.enabled) return;

  const nameChanged = oldChannel.name !== newChannel.name;
  const parentChanged = oldChannel.parentId !== newChannel.parentId;
  const positionChanged = oldChannel.rawPosition !== newChannel.rawPosition;
  const overwritesChanged = serializeOverwrites(oldChannel) !== serializeOverwrites(newChannel);
  if (!nameChanged && !parentChanged && !positionChanged && !overwritesChanged) return;

  const positionOnly = positionChanged && !nameChanged && !parentChanged && !overwritesChanged;
  const executorId = await getUntrustedExecutor(guild, {
    types: [
      AuditLogEvent.ChannelUpdate,
      AuditLogEvent.ChannelOverwriteCreate,
      AuditLogEvent.ChannelOverwriteUpdate,
      AuditLogEvent.ChannelOverwriteDelete,
    ],
    targetId: newChannel.id,
    retry: !positionOnly,
  });
  if (!executorId) return;

  const changes: string[] = [];
  const edit: { name?: string; parent?: string | null; position?: number } = {};
  if (channelProtection.update) {
    if (nameChanged) {
      edit.name = oldChannel.name;
      changes.push(`name: ${newChannel.name} → ${oldChannel.name}`);
    }
    if (parentChanged) {
      edit.parent = oldChannel.parentId;
      changes.push('category');
    }
    if (positionChanged) {
      edit.position = oldChannel.rawPosition;
      changes.push('position');
    }
  }
  const revertOverwrites = channelProtection.permissionUpdate && overwritesChanged;
  if (revertOverwrites) changes.push('permission overwrites');
  if (changes.length === 0) return;

  const oldOverwrites = overwritePayload(oldChannel);
  protectionQueue.enqueue(guild.id, async () => {
    try {
      if (Object.keys(edit).length > 0) await newChannel.edit({ ...edit, reason: 'Channel Protection: reverting unauthorized change' });
      if (revertOverwrites) await newChannel.permissionOverwrites.set(oldOverwrites, 'Channel Protection: reverting overwrites');
    } catch (error) {
      await logEvent(guild, {
        category: 'CHANNEL',
        title: 'CHANNEL PROTECTION — Revert failed',
        description: errorMessage(error),
        fields: [{ name: 'Channel', value: `${newChannel.name} (\`${newChannel.id}\`)` }],
      });
    }
  });

  const actionTaken = await enforce(guild, executorId, channelProtection.action, 'Channel Protection: unauthorized channel update');
  await logEvent(guild, {
    category: 'CHANNEL',
    title: 'CHANNEL PROTECTION — Channel Updated',
    executorId,
    fields: [
      { name: 'Channel', value: `${newChannel.name} (\`${newChannel.id}\`)` },
      { name: 'Reverted', value: changes.join(', ') },
    ],
    actionTaken,
  });
}
