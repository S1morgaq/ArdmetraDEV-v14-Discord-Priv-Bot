import { MessageFlags } from 'discord.js';
import type { Component } from '../types/handlers';
import { buildTagList } from '../services/tagService';

const nav: Component = {
  id: 'taglist:nav',
  async execute(interaction, args) {
    if (!interaction.isButton() || !interaction.inCachedGuild()) return;
    const payload = await buildTagList(interaction.guild, Number(args[0]) || 0);
    if (!payload) {
      await interaction.reply({ content: 'The tag system is off.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.update({ ...payload, attachments: [] } as never);
  },
};

export default nav;
