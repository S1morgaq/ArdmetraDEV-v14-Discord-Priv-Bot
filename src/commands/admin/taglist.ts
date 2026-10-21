import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { buildTagList } from '../../services/tagService';
import { fail } from '../../utils/reply';

const command: Command = {
  data: new SlashCommandBuilder().setName('taglist').setDescription('List every member who wears the server tag'),
  cooldown: 10,
  async execute(interaction) {
    await interaction.deferReply();
    // Make sure the member cache is complete so the list is not missing anyone.
    await interaction.guild.members.fetch().catch(() => undefined);
    const payload = await buildTagList(interaction.guild, 0);
    if (!payload) return fail(interaction, 'The tag system is not set up. An admin can use /tag set.');
    await interaction.editReply(payload);
  },
};

export default command;
