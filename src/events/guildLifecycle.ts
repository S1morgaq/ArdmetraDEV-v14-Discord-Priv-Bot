import { Events, type Guild } from 'discord.js';
import type { EventModule } from '../types/handlers';
import { markGuildInactive, syncGuild } from '../services/guildService';
import { logEvent } from '../services/loggerService';
import { logger } from '../utils/logger';

const created: EventModule = {
  name: Events.GuildCreate,
  async execute(_client, guild: Guild) {
    logger.info(`[GUILD] Joined ${guild.name} (${guild.id}).`);
    await syncGuild(guild);
    await logEvent(guild, { category: 'GUILD', title: 'Bot joined this server' });
  },
};

const deleted: EventModule = {
  name: Events.GuildDelete,
  async execute(_client, guild: Guild) {
    // An outage makes guilds "unavailable" without the bot having been removed.
    if (!guild.available) return;
    logger.info(`[GUILD] Left ${guild.name} (${guild.id}).`);
    await markGuildInactive(guild.id);
  },
};

export default [created, deleted];
