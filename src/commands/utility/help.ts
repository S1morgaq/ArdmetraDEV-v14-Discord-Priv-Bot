import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { buildHelp } from '../../services/helpService';

const command: Command = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show every command in an animated help card'),
  cooldown: 5,
  async execute(interaction, client) {
    await interaction.deferReply();
    await interaction.editReply(await buildHelp(client));
  },
};

export default command;
