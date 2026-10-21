import { Client, Collection, GatewayIntentBits, Options } from 'discord.js';
import type { Command, Component, PrefixCommand } from './types/handlers';

export class BotClient extends Client {
  readonly commands = new Collection<string, Command>();
  /** Keyed by name and by every alias. */
  readonly prefixCommands = new Collection<string, PrefixCommand>();
  readonly components = new Collection<string, Component>();
}

let instance: BotClient | null = null;

export function createClient(): BotClient {
  if (instance) return instance;
  instance = new BotClient({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers, // privileged: join detection + member lookups
      GatewayIntentBits.GuildModeration, // ban events
      GatewayIntentBits.GuildWebhooks,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent, // privileged: anti-spam + prefix commands
      GatewayIntentBits.GuildVoiceStates, // voice: the bot can sit in a voice channel (dashboard control)
      GatewayIntentBits.GuildPresences, // privileged: .spo needs Spotify presences
    ],
    // Bounded caches keep memory flat on large deployments.
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 100, // needed so deleted / edited messages can be sniped
      ReactionManager: 0,
      ThreadManager: 0,
      StageInstanceManager: 0,
      GuildScheduledEventManager: 0,
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: { interval: 300, lifetime: 3600 },
      users: {
        interval: 3600,
        filter: () => (user) => user.id !== instance?.user?.id,
      },
    },
    allowedMentions: { parse: [], repliedUser: false },
    rest: { timeout: 20_000, retries: 3 },
  });
  return instance;
}

export function getClient(): BotClient {
  if (!instance) throw new Error('Discord client has not been created yet.');
  return instance;
}

export function hasClient(): boolean {
  return instance !== null;
}
