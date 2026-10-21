import { Events, type Message, type PartialMessage } from 'discord.js';
import type { EventModule } from '../types/handlers';
import { recordDeleted, recordEdited } from '../services/snipeService';

const deleted: EventModule = {
  name: Events.MessageDelete,
  execute: (_client, message: Message | PartialMessage) => recordDeleted(message),
};

const edited: EventModule = {
  name: Events.MessageUpdate,
  execute: (_client, oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) => recordEdited(oldMessage, newMessage),
};

export default [deleted, edited];
