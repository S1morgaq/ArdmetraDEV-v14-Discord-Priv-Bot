import './config'; // validates the environment first and exits with a clear message when it is invalid
import { bootstrap } from './core/bootstrap';
import { installProcessHandlers, shutdown } from './core/shutdown';
import { logger } from './utils/logger';

installProcessHandlers();

bootstrap().catch((error: unknown) => {
  logger.error(`[FATAL] Startup failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  void shutdown('startup failure', 1);
});
