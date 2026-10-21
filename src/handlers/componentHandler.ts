import path from 'node:path';
import { MessageFlags, type ButtonInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from 'discord.js';
import type { BotClient } from '../client';
import type { Component } from '../types/handlers';
import { loadDefault, walkModules } from '../utils/files';
import { errorMessage, logger } from '../utils/logger';

const COMPONENTS_DIR = path.join(__dirname, '..', 'components');

export function loadComponents(client: BotClient): number {
  client.components.clear();
  for (const file of walkModules(COMPONENTS_DIR)) {
    try {
      const loaded = loadDefault<Component | Component[]>(file);
      for (const component of Array.isArray(loaded) ? loaded : loaded ? [loaded] : []) {
        if (!component.id || typeof component.execute !== 'function') continue;
        client.components.set(component.id, component);
      }
    } catch (error) {
      logger.error(`[COMPONENTS] Failed to load ${file}: ${errorMessage(error)}`);
    }
  }
  return client.components.size;
}

type ComponentInteraction = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;

/** customId format: "namespace:action[:arg...]" -> handler "namespace:action" receives the rest as args. */
export async function handleComponent(interaction: ComponentInteraction, client: BotClient): Promise<void> {
  const [namespace, action, ...args] = interaction.customId.split(':');
  const component = client.components.get(`${namespace}:${action}`);
  if (!component) return;
  try {
    await component.execute(interaction, args, client);
  } catch (error) {
    logger.error(`[COMPONENTS] ${interaction.customId} failed: ${error instanceof Error ? (error.stack ?? error.message) : errorMessage(error)}`);
    const payload = { content: '❌ Something went wrong while handling that action.', flags: MessageFlags.Ephemeral } as const;
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => undefined);
    else await interaction.reply(payload).catch(() => undefined);
  }
}
