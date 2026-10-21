import { Events, type Message } from 'discord.js';
import type { EventModule } from '../types/handlers';
import { handleMessage } from '../protection/antiSpam';
import { handlePrefixCommand } from '../handlers/prefixHandler';
import { handleGreeting } from '../services/registerService';

const event: EventModule = {
  name: Events.MessageCreate,
  async execute(client, message: Message) {
    // Spam protection always runs first; a deleted spam message never reaches the command layer.
    const removed = await handleMessage(message);
    if (removed) return;
    await handleGreeting(message).catch(() => undefined);
    await handlePrefixCommand(message, client);
  },
};

export default event;
