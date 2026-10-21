import { Events, type GuildBan, type GuildMember, type PartialGuildMember } from 'discord.js';
import type { EventModule } from '../types/handlers';
import { handleMemberJoin } from '../protection/antiRaid';
import { handleBotJoin } from '../protection/botProtection';
import { handleBanAdd, handleMemberRemove } from '../protection/memberActions';
import { handleMemberRoleChange } from '../protection/permissionProtection';
import { applyTag } from '../services/tagService';
import { handleGoodbye, handleWelcome } from '../services/welcomeService';

const add: EventModule = {
  name: Events.GuildMemberAdd,
  async execute(_client, member: GuildMember) {
    if (member.user.bot) await handleBotJoin(member);
    else await handleMemberJoin(member);
    await handleWelcome(member);
    await applyTag(member);
  },
};

const remove: EventModule = {
  name: Events.GuildMemberRemove,
  async execute(_client, member: GuildMember | PartialGuildMember) {
    await handleMemberRemove(member);
    await handleGoodbye(member);
  },
};

const update: EventModule = {
  name: Events.GuildMemberUpdate,
  execute: (_client, oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) =>
    handleMemberRoleChange(oldMember, newMember),
};

const ban: EventModule = {
  name: Events.GuildBanAdd,
  execute: (_client, guildBan: GuildBan) => handleBanAdd(guildBan),
};

export default [add, remove, update, ban];
