import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Message,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  StringSelectMenuInteraction,
} from 'discord.js';
import type { BotClient } from '../client';

export interface Command {
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  /** Permissions the invoking member must have (checked in addition to Discord's own UI gating). */
  memberPermissions?: bigint[];
  /** Permissions the bot itself needs in the guild. */
  botPermissions?: bigint[];
  /** Per-user cooldown in seconds. */
  cooldown?: number;
  /** Guard: only the server owner and whitelisted users/roles may run this command. */
  guard?: boolean;
  execute(interaction: ChatInputCommandInteraction<'cached'>, client: BotClient): Promise<void>;
}

/** Text command triggered by the configured prefix (default "."), e.g. ".spo". */
export interface PrefixCommand {
  name: string;
  aliases?: string[];
  description: string;
  memberPermissions?: bigint[];
  cooldown?: number;
  guard?: boolean;
  execute(message: Message<true>, args: string[], client: BotClient): Promise<void>;
}

type ComponentInteraction = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;

/**
 * Components are addressed by customId "namespace:action[:arg...]". The registry key is the first
 * two segments, e.g. "giveaway:join" for customId "giveaway:join:65f...".
 */
export interface Component {
  id: string;
  execute(interaction: ComponentInteraction, args: string[], client: BotClient): Promise<void>;
}

export interface EventModule {
  name: string;
  once?: boolean;
  // Event payloads differ per event; each event file annotates its own parameters.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (client: BotClient, ...args: any[]) => unknown;
}
