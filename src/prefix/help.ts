import type { PrefixCommand } from '../types/handlers';
import { buildHelp } from '../services/helpService';

const command: PrefixCommand = {
  name: 'help',
  aliases: ['yardım', 'yardim', 'komutlar', 'h'],
  description: 'Show every command in an animated help card',
  cooldown: 5,
  async execute(message, _args, client) {
    await message.reply(await buildHelp(client));
  },
};

export default command;
