import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import type { Component } from '../types/handlers';
import { rerollGiveaway, toggleParticipation } from '../services/giveawayService';

const join: Component = {
  id: 'giveaway:join',
  async execute(interaction, args) {
    if (!interaction.isButton() || !args[0]) return;
    const result = await toggleParticipation(args[0], interaction.user.id);
    const content =
      result === 'joined'
        ? '🎉 You joined the giveaway. Good luck! Click again to leave.'
        : result === 'left'
          ? '👋 You left the giveaway.'
          : '⌛ This giveaway has already ended.';
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  },
};

const reroll: Component = {
  id: 'giveaway:reroll',
  async execute(interaction, args, client) {
    if (!interaction.isButton() || !args[0]) return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: '❌ You need the Manage Server permission to reroll.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await rerollGiveaway(client, args[0]);
    await interaction.editReply(result ? '🔁 Rerolled.' : '❌ Nothing to reroll (no participants or giveaway not found).');
  },
};

export default [join, reroll];
