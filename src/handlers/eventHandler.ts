import path from 'node:path';
import type { BotClient } from '../client';
import type { EventModule } from '../types/handlers';
import { loadDefault, walkModules } from '../utils/files';
import { errorMessage, logger } from '../utils/logger';

const EVENTS_DIR = path.join(__dirname, '..', 'events');

/**
 * Every listener is wrapped: a failing handler is logged and can never take the process down
 * (or produce an unhandled rejection).
 */
export function loadEvents(client: BotClient): number {
  let count = 0;
  for (const file of walkModules(EVENTS_DIR)) {
    try {
      const loaded = loadDefault<EventModule | EventModule[]>(file);
      const modules = Array.isArray(loaded) ? loaded : loaded ? [loaded] : [];
      for (const event of modules) {
        if (!event.name || typeof event.execute !== 'function') {
          logger.warn(`[EVENTS] ${path.basename(file)} exports an invalid event; skipped.`);
          continue;
        }
        const listener = (...args: unknown[]) => {
          Promise.resolve()
            .then(() => event.execute(client, ...args))
            .catch((error: unknown) => {
              logger.error(`[EVENTS] Handler for "${event.name}" failed: ${error instanceof Error ? (error.stack ?? error.message) : errorMessage(error)}`);
            });
        };
        if (event.once) client.once(event.name, listener);
        else client.on(event.name, listener);
        count++;
      }
    } catch (error) {
      logger.error(`[EVENTS] Failed to load ${file}: ${errorMessage(error)}`);
    }
  }
  return count;
}
