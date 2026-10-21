import { MessageFlags } from 'discord.js';
import type { Component } from '../types/handlers';
import { toggleRole } from '../services/rolePanelService';

const toggle: Component = {
  id: 'rolepanel:toggle',
  async execute(interaction, args) {
    if (!interaction.isButton() || !args[0] || !interaction.inCachedGuild()) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await toggleRole(interaction.member, interaction.message.id, args[0]);
    let content: string;
    if (result.status === 'error') content = `❌ ${result.message}`;
    else if (result.status === 'added') content = `✅ You now have **${result.role.name}**.`;
    else content = `➖ **${result.role.name}** was removed.`;
    await interaction.editReply({ content, allowedMentions: { parse: [] } });
    setTimeout(() => void interaction.deleteReply().catch(() => undefined), 5000);
  },
};

export default toggle;
