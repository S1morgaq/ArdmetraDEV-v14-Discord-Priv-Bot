import { MessageFlags } from 'discord.js';
import type { Component } from '../types/handlers';
import { resetProtection } from '../services/protectionService';
import { logEvent } from '../services/loggerService';
import { isTrusted } from '../protection/whitelist';

/** customId: protection:confirm:<action>:<userId> — only the user who opened the prompt may answer it. */
const confirm: Component = {
  id: 'protection:confirm',
  async execute(interaction, args) {
    if (!interaction.isButton() || !interaction.inCachedGuild()) return;
    const [action, userId] = args;
    if (interaction.user.id !== userId) {
      await interaction.reply({ content: '❌ This prompt is not for you.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!(await isTrusted(interaction.guild, interaction.user.id))) {
      await interaction.update({ content: '❌ Only the server owner or a whitelisted user can do that.', components: [] });
      return;
    }
    if (action === 'reset') {
      await resetProtection(interaction.guildId);
      await interaction.update({ content: '✅ Protection settings were reset to defaults.', components: [] });
      await logEvent(interaction.guild, {
        category: 'PROTECTION',
        title: 'Protection settings reset',
        executorId: interaction.user.id,
      });
    }
  },
};

const cancel: Component = {
  id: 'protection:cancel',
  async execute(interaction, args) {
    if (!interaction.isButton()) return;
    if (interaction.user.id !== args[1]) {
      await interaction.reply({ content: '❌ This prompt is not for you.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.update({ content: 'Cancelled.', components: [] });
  },
};

export default [confirm, cancel];
