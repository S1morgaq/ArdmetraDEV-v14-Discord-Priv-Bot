import { closeLogger, isLoggerClosed, logger, errorMessage } from '../utils/logger';

type Hook = { name: string; fn: () => Promise<void> | void };

const hooks: Hook[] = [];
let shuttingDown = false;

/** Hooks run in registration order. Register in the order they should stop. */
export function registerShutdownHook(name: string, fn: () => Promise<void> | void): void {
  hooks.push({ name, fn });
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * Graceful, idempotent shutdown. Exit code != 0 makes PM2 treat it as a crash and restart the process.
 */
export async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn(`[SHUTDOWN] Shutting down (${reason}).`);

  const force = setTimeout(() => {
    logger.error('[SHUTDOWN] Graceful shutdown timed out; forcing exit.');
    process.exit(exitCode || 1);
  }, 12_000);
  force.unref();

  for (const hook of hooks) {
    try {
      await hook.fn();
      logger.info(`[SHUTDOWN] ${hook.name} stopped.`);
    } catch (error) {
      logger.error(`[SHUTDOWN] ${hook.name} failed: ${errorMessage(error)}`);
    }
  }

  await closeLogger();
  process.exit(exitCode);
}

/** Global crash handlers. Broken process state is never kept alive: PM2 restarts us. */
export function installProcessHandlers(): void {
  const rejections: number[] = [];

  // After the logger was flushed and closed, fall back to stderr so a late error is never lost or re-thrown.
  const report = (message: string) => (isLoggerClosed() ? console.error(message) : logger.error(message));

  process.on('uncaughtException', (error) => {
    report(`[FATAL] Uncaught exception: ${error.stack ?? error.message}`);
    if (isLoggerClosed()) process.exit(1);
    void shutdown('uncaughtException', 1);
  });

  process.on('unhandledRejection', (reason) => {
    report(`[ERROR] Unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
    // A burst of unhandled rejections means something is systematically wrong: restart cleanly.
    const now = Date.now();
    rejections.push(now);
    while (rejections.length > 0 && rejections[0] < now - 60_000) rejections.shift();
    if (rejections.length >= 10) void shutdown('too many unhandled rejections', 1);
  });

  process.on('SIGINT', () => void shutdown('SIGINT', 0));
  process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
  // PM2 on Windows delivers graceful shutdown as a message.
  process.on('message', (message) => {
    if (message === 'shutdown') void shutdown('PM2 shutdown message', 0);
  });
}
