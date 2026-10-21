import { Events } from 'discord.js';
import type { EventModule } from '../types/handlers';
import { shutdown } from '../core/shutdown';
import { logger, errorMessage } from '../utils/logger';

// discord.js reconnects on its own; these listeners make connection problems visible
// and restart the process only when the session is unrecoverable.
const events: EventModule[] = [
  { name: Events.Error, execute: (_c, error: Error) => logger.error(`[DISCORD] Client error: ${errorMessage(error)}`) },
  { name: Events.Warn, execute: (_c, info: string) => logger.warn(`[DISCORD] ${info}`) },
  {
    name: Events.ShardDisconnect,
    execute: (_c, event: { code: number }, shardId: number) =>
      logger.warn(`[DISCORD] Shard ${shardId} disconnected (code ${event.code}).`),
  },
  { name: Events.ShardReconnecting, execute: (_c, shardId: number) => logger.info(`[DISCORD] Shard ${shardId} reconnecting...`) },
  { name: Events.ShardResume, execute: (_c, shardId: number) => logger.info(`[DISCORD] Shard ${shardId} resumed.`) },
  {
    name: Events.ShardError,
    execute: (_c, error: Error, shardId: number) => logger.error(`[DISCORD] Shard ${shardId} error: ${errorMessage(error)}`),
  },
  {
    name: Events.Invalidated,
    execute: () => {
      logger.error('[DISCORD] Session invalidated.');
      return shutdown('discord session invalidated', 1);
    },
  },
];

export default events;
