import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import type { Component } from '../types/handlers';
import { buildSnipePayload, getSniped } from '../services/snipeService';

const nav: Component = {
  id: 'snipe:nav',
  async execute(interaction, args) {
    if (!interaction.isButton()) return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({ content: '❌ You need Manage Messages to browse sniped messages.', flags: MessageFlags.Ephemeral });
      return;
    }
    const [k, channelId, rawIndex] = args;
    const kind = k === 'e' ? 'edit' : 'delete';
    const list = getSniped(kind, channelId);
    const index = Math.max(0, Math.min(Number(rawIndex) || 0, list.length - 1));
    const entry = list[index];
    if (!entry) {
      await interaction.update({ content: 'Nothing left to show.', embeds: [], components: [] });
      return;
    }
    const payload = await buildSnipePayload(kind, list, index, channelId);
    await interaction.update({ ...payload, attachments: [] });
  },
};

export default nav;
