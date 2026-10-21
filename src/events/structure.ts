import {
  Events,
  type DMChannel,
  type Guild,
  type NonThreadGuildBasedChannel,
  type Role,
  type TextBasedChannel,
} from 'discord.js';
import type { EventModule } from '../types/handlers';
import { handleChannelCreate, handleChannelDelete, handleChannelUpdate } from '../protection/channelProtection';
import { handleRoleCreate, handleRoleDelete, handleRoleUpdate } from '../protection/roleProtection';
import { handleGuildUpdate } from '../protection/serverProtection';
import { handleWebhooksUpdate } from '../protection/webhookProtection';

const channelCreate: EventModule = {
  name: Events.ChannelCreate,
  execute: (_client, channel: NonThreadGuildBasedChannel) => handleChannelCreate(channel),
};

const channelDelete: EventModule = {
  name: Events.ChannelDelete,
  execute: (_client, channel: NonThreadGuildBasedChannel | DMChannel) => {
    if ('guild' in channel) return handleChannelDelete(channel);
    return undefined;
  },
};

const channelUpdate: EventModule = {
  name: Events.ChannelUpdate,
  execute: (_client, oldChannel: NonThreadGuildBasedChannel | DMChannel, newChannel: NonThreadGuildBasedChannel | DMChannel) =>
    handleChannelUpdate(oldChannel, newChannel),
};

const roleCreate: EventModule = {
  name: Events.GuildRoleCreate,
  execute: (_client, role: Role) => handleRoleCreate(role),
};

const roleDelete: EventModule = {
  name: Events.GuildRoleDelete,
  execute: (_client, role: Role) => handleRoleDelete(role),
};

const roleUpdate: EventModule = {
  name: Events.GuildRoleUpdate,
  execute: (_client, oldRole: Role, newRole: Role) => handleRoleUpdate(oldRole, newRole),
};

const guildUpdate: EventModule = {
  name: Events.GuildUpdate,
  execute: (_client, oldGuild: Guild, newGuild: Guild) => handleGuildUpdate(oldGuild, newGuild),
};

const webhooksUpdate: EventModule = {
  name: Events.WebhooksUpdate,
  execute: (_client, channel: Exclude<TextBasedChannel, DMChannel> & { guild: Guild }) => handleWebhooksUpdate(channel.guild),
};

export default [channelCreate, channelDelete, channelUpdate, roleCreate, roleDelete, roleUpdate, guildUpdate, webhooksUpdate];
