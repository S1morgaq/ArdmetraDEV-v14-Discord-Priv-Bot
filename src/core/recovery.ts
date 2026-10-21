import type { BotClient } from '../client';
import { syncGuild } from '../services/guildService';
import { warmProtectionCache } from '../services/protectionService';
import { startGiveawayScheduler } from '../services/giveawayService';
import { restoreVoice } from '../services/voiceService';
import { expireLockdowns, pruneRaidState } from '../protection/antiRaid';
import { startCacheSweeper } from '../utils/cache';
import { startCounterSweeper } from '../utils/counter';
import { registerInterval } from '../utils/scheduler';
import { errorMessage, logger } from '../utils/logger';

/**
 * Everything that must be rebuilt from MongoDB after a (re)start. Nothing important lives only in memory:
 * guild records, protection configs, raid lockdowns and giveaways are all reloaded here.
 */
export async function runRecovery(client: BotClient): Promise<void> {
  startCacheSweeper();
  startCounterSweeper();

  const guilds = [...client.guilds.cache.values()];
  for (const guild of guilds) {
    await syncGuild(guild).catch((error: unknown) => logger.warn(`[RECOVERY] Sync failed for ${guild.id}: ${errorMessage(error)}`));
  }
  await warmProtectionCache(guilds.map((g) => g.id)).catch((error: unknown) =>
    logger.warn(`[RECOVERY] Could not warm protection cache: ${errorMessage(error)}`),
  );

  // Lockdowns that expired while the bot was offline are lifted right away, then re-checked periodically.
  await expireLockdowns((id) => client.guilds.cache.get(id)).catch((error: unknown) =>
    logger.warn(`[RECOVERY] Lockdown recovery failed: ${errorMessage(error)}`),
  );
  registerInterval('raid-lockdown', 30_000, () => expireLockdowns((id) => client.guilds.cache.get(id)));
  registerInterval('raid-state-prune', 60_000, pruneRaidState);

  startGiveawayScheduler(client);
  await restoreVoice(client).catch((error: unknown) => logger.warn(`[RECOVERY] Voice restore failed: ${errorMessage(error)}`));
  logger.info(`[RECOVERY] Restored state for ${guilds.length} guilds.`);
}
