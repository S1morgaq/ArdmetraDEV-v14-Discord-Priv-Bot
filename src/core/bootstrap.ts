import { Events } from 'discord.js';
import { config } from '../config';
import { createClient, getClient, hasClient } from '../client';
import { connectDatabase, disconnectDatabase, isDatabaseConnected } from '../database/connect';
import { startDashboard, type DashboardHandle } from '../dashboard/server';
import { loadCommands } from '../handlers/commandHandler';
import { loadComponents } from '../handlers/componentHandler';
import { loadEvents } from '../handlers/eventHandler';
import { loadPrefixCommands } from '../handlers/prefixHandler';
import { persistLicenseRecord, startLicenseRevalidation, validateLicense } from '../services/licenseService';
import { logger } from '../utils/logger';
import { stopAllLive } from '../utils/live';
import { registerInterval, stopAllJobs } from '../utils/scheduler';
import { printBanner } from './banner';
import { registerShutdownHook, shutdown } from './shutdown';

const READY_TIMEOUT_MS = 60_000;

/** Startup order: License -> Database -> Discord -> Dashboard. Any failure stops the process (PM2 restarts it). */
export async function bootstrap(): Promise<void> {
  let dashboard: DashboardHandle | null = null;

  // Shutdown order: dashboard -> timers -> (state is persisted continuously) -> MongoDB -> Discord.
  registerShutdownHook('Dashboard', async () => {
    await dashboard?.close();
  });
  registerShutdownHook('Timers', () => {
    stopAllJobs();
    stopAllLive();
  });
  registerShutdownHook('MongoDB', disconnectDatabase);
  registerShutdownHook('Discord', () => {
    if (hasClient()) void getClient().destroy();
  });

  // 1. License: nothing else (MongoDB, Discord, dashboard) starts without it.
  if (!(await validateLicense())) {
    logger.error('[LICENSE] Startup cancelled.');
    await shutdown('invalid license', 1);
    return;
  }

  // 2. Database
  try {
    await connectDatabase();
    logger.info('[DATABASE] Connected to MongoDB.');
    await persistLicenseRecord();
  } catch (error) {
    logger.error(`[DATABASE] ${error instanceof Error ? error.message : String(error)}`);
    await shutdown('database unavailable', 1);
    return;
  }
  startLicenseRevalidation(() => void shutdown('license no longer valid', 1));

  // 3. Discord
  const client = createClient();
  const commands = loadCommands(client);
  const prefixCommands = loadPrefixCommands(client);
  const components = loadComponents(client);
  const events = loadEvents(client);
  logger.info(`[HANDLERS] ${commands} slash commands, ${prefixCommands} prefix commands, ${components} components, ${events} events.`);

  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for the Discord client to become ready.')), READY_TIMEOUT_MS);
    client.once(Events.ClientReady, () => {
      clearTimeout(timer);
      resolve();
    });
  });
  try {
    await client.login(config.discord.token);
    await ready;
  } catch (error) {
    logger.error(`[DISCORD] Login failed: ${error instanceof Error ? error.message : String(error)}`);
    await shutdown('discord login failed', 1);
    return;
  }

  // 4. Dashboard
  try {
    dashboard = await startDashboard();
  } catch (error) {
    logger.error(`[DASHBOARD] Could not start: ${error instanceof Error ? error.message : String(error)}`);
    await shutdown('dashboard failed to start', 1);
    return;
  }

  printBanner({
    license: true,
    database: isDatabaseConnected(),
    discord: client.isReady(),
    dashboardUrl: config.dashboard.url,
    pm2: process.env.pm_id !== undefined,
  });

  startWatchdog();
}

/**
 * discord.js and mongoose reconnect on their own. If they stay down for too long the process is
 * considered unhealthy and restarted cleanly by PM2.
 */
function startWatchdog(): void {
  let discordDownSince: number | null = null;
  let databaseDownSince: number | null = null;

  registerInterval('watchdog', 30_000, () => {
    const now = Date.now();
    const discordUp = hasClient() && getClient().isReady();
    const databaseUp = isDatabaseConnected();

    discordDownSince = discordUp ? null : (discordDownSince ?? now);
    databaseDownSince = databaseUp ? null : (databaseDownSince ?? now);

    if (discordDownSince !== null && now - discordDownSince > 5 * 60_000) {
      logger.error('[WATCHDOG] Discord has been unavailable for 5 minutes.');
      void shutdown('discord connection lost', 1);
    }
    if (databaseDownSince !== null && now - databaseDownSince > 2 * 60_000) {
      logger.error('[WATCHDOG] MongoDB has been unavailable for 2 minutes.');
      void shutdown('database connection lost', 1);
    }
  });
}
