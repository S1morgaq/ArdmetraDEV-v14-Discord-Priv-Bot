import { ActivityType, Events } from 'discord.js';
import type { EventModule } from '../types/handlers';
import { registerCommands } from '../handlers/commandHandler';
import { runRecovery } from '../core/recovery';
import { config } from '../config';
import { logger } from '../utils/logger';

const event: EventModule = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`[DISCORD] Logged in as ${client.user?.tag} (${client.guilds.cache.size} guilds).`);
    client.user?.setPresence({ activities: [{ name: config.tagline, type: ActivityType.Watching }], status: 'online' });
    await registerCommands(client);
    await runRecovery(client);
  },
};

export default event;
