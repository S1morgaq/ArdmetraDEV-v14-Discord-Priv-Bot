import { Events, type GuildMember, type PartialGuildMember, type PartialUser, type User } from 'discord.js';
import type { EventModule } from '../types/handlers';
import { applyTag, getTagConfig } from '../services/tagService';

/** Nickname changes and role changes on one member. */
const memberUpdate: EventModule = {
  name: Events.GuildMemberUpdate,
  async execute(_client, oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) {
    if (oldMember.nickname === newMember.nickname && oldMember.roles.cache.size === newMember.roles.cache.size) return;
    await applyTag(newMember);
  },
};

/** Username / display name changes apply to every server the user shares with the bot. */
const userUpdate: EventModule = {
  name: Events.UserUpdate,
  async execute(client, oldUser: User | PartialUser, newUser: User) {
    if (oldUser.username === newUser.username && oldUser.globalName === newUser.globalName) return;
    for (const guild of client.guilds.cache.values()) {
      const member = guild.members.cache.get(newUser.id);
      if (!member) continue;
      const config = await getTagConfig(guild.id);
      if (config) await applyTag(member, config);
    }
  },
};

export default [memberUpdate, userUpdate];
