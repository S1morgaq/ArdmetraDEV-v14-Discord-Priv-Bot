import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { recordCase } from '../../services/moderationService';
import { fail, succeed } from '../../utils/reply';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set the slowmode of a text channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption((o) => o.setName('seconds').setDescription('0 disables slowmode (max 21600)').setRequired(true).setMinValue(0).setMaxValue(21_600))
    .addChannelOption((o) => o.setName('channel').setDescription('Channel (default: current)').addChannelTypes(ChannelType.GuildText)),
  memberPermissions: [PermissionFlagsBits.ManageChannels],
  botPermissions: [PermissionFlagsBits.ManageChannels],
  cooldown: 3,
  async execute(interaction) {
    await interaction.deferReply();
    const picked = interaction.options.getChannel('channel') ?? interaction.channel;
    if (!picked || picked.type !== ChannelType.GuildText) return fail(interaction, 'Slowmode only works in text channels.');
    const seconds = interaction.options.getInteger('seconds', true);

    await picked.setRateLimitPerUser(seconds, `${interaction.user.username}: slowmode`);
    await recordCase({
      guild: interaction.guild,
      type: 'SLOWMODE',
      moderatorId: interaction.user.id,
      reason: `#${picked.name}: ${seconds}s`,
    });
    await succeed(interaction, seconds === 0 ? `Slowmode disabled in <#${picked.id}>.` : `Slowmode in <#${picked.id}> set to **${seconds}s**.`);
  },
};

export default command;
