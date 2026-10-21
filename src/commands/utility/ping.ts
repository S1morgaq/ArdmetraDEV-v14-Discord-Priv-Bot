import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { infoEmbed, cardReply } from '../../utils/reply';
import { getHealth } from '../../core/state';

const command: Command = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Show latency and health'),
  cooldown: 5,
  async execute(interaction, client) {
    const health = getHealth();
    const embed = infoEmbed('🏓 Pong').addFields(
      { name: 'Gateway', value: `${Math.round(client.ws.ping)} ms`, inline: true },
      { name: 'Uptime', value: `${Math.floor(health.uptime / 60)} min`, inline: true },
      { name: 'Database', value: health.database ? 'connected' : 'down', inline: true },
    );
    await interaction.reply(await cardReply(embed, { kind: 'ok', chip: 'Status', title: 'Pong!', text: `Gateway ${Math.round(client.ws.ping)} ms · uptime ${Math.floor(health.uptime / 60)} min`, avatarUrl: client.user?.displayAvatarURL({ extension: 'png', size: 128 }) }));
  },
};

export default command;
