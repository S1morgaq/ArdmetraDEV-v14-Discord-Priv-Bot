import { MessageFlags } from 'discord.js';
import type { Component } from '../types/handlers';
import { registerMember } from '../services/registerService';

const pick: Component = {
  id: 'register:pick',
  async execute(interaction, args) {
    if (!interaction.isButton() || !interaction.inCachedGuild()) return;
    const gender = args[0] === 'female' ? 'female' : args[0] === 'male' ? 'male' : null;
    if (!gender) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await registerMember(interaction.member, gender);
    await interaction.editReply(
      result.status === 'ok'
        ? `✅ Kayıt tamamlandı: **${result.gender === 'male' ? 'Erkek' : 'Kız'}**. Hoş geldin!`
        : `❌ ${result.message}`,
    );
    setTimeout(() => void interaction.deleteReply().catch(() => undefined), 5000).unref();
  },
};

export default pick;
