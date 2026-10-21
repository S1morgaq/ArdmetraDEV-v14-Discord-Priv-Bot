import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BotClient } from '../client';
import type { Command } from '../types/handlers';
import { loadDefault, walkModules } from '../utils/files';
import { errorMessage, logger } from '../utils/logger';

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');
const HASH_FILE = path.resolve(process.cwd(), 'data', 'commands.hash');

export function loadCommands(client: BotClient): number {
  client.commands.clear();
  for (const file of walkModules(COMMANDS_DIR)) {
    try {
      const command = loadDefault<Command>(file);
      if (!command?.data || typeof command.execute !== 'function') {
        logger.warn(`[COMMANDS] ${path.basename(file)} does not export a valid command; skipped.`);
        continue;
      }
      if (client.commands.has(command.data.name)) {
        logger.warn(`[COMMANDS] Duplicate command name "${command.data.name}" in ${path.basename(file)}; skipped.`);
        continue;
      }
      client.commands.set(command.data.name, command);
    } catch (error) {
      logger.error(`[COMMANDS] Failed to load ${file}: ${errorMessage(error)}`);
    }
  }
  return client.commands.size;
}

/**
 * Registers slash commands globally, but only when the definitions changed since the last run.
 * Crash-looping under PM2 therefore never burns through Discord's command registration limits.
 */
export async function registerCommands(client: BotClient): Promise<void> {
  if (!client.application) return;
  const body = client.commands.map((command) => command.data.toJSON());
  const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');

  let previous = '';
  try {
    previous = fs.readFileSync(HASH_FILE, 'utf8').trim();
  } catch {
    // first run
  }
  if (previous === hash) {
    logger.info(`[COMMANDS] ${body.length} slash commands already up to date.`);
    return;
  }

  await client.application.commands.set(body);
  try {
    fs.mkdirSync(path.dirname(HASH_FILE), { recursive: true });
    fs.writeFileSync(HASH_FILE, hash);
  } catch (error) {
    logger.warn(`[COMMANDS] Could not persist command hash: ${errorMessage(error)}`);
  }
  logger.info(`[COMMANDS] Registered ${body.length} slash commands.`);
}
