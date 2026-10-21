import { PermissionFlagsBits } from 'discord.js';
import type { PrefixCommand } from '../types/handlers';
import { buildSnipePayload, getSniped } from '../services/snipeService';
import { errEmbed, replyTemp } from '../utils/reply';

function make(kind: 'delete' | 'edit', name: string, aliases: string[], description: string): PrefixCommand {
  return {
    name,
    aliases,
    description,
    memberPermissions: [PermissionFlagsBits.ManageMessages],
    cooldown: 3,
    async execute(message, args) {
      const list = getSniped(kind, message.channelId);
      if (list.length === 0) {
        await replyTemp(message, errEmbed(kind === 'delete' ? 'There is nothing to snipe here.' : 'No recent edits in this channel.'), true);
        return;
      }
      const wanted = Number(args[0]);
      const index = Number.isInteger(wanted) && wanted >= 1 && wanted <= list.length ? wanted - 1 : 0;
      await message.reply(await buildSnipePayload(kind, list, index, message.channelId));
    },
  };
}

export default [
  make('delete', 'snipe', ['s'], 'Show the last deleted message(s) of this channel (bot messages included)'),
  make('edit', 'editsnipe', ['es'], 'Show the last edited message(s) of this channel'),
];
