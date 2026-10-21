import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { recordCase } from '../../services/moderationService';
import { fail, resolveTextChannel, succeed } from '../../utils/reply';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Restore @everyone message permissions in a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Channel (default: current)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    ),
  memberPermissions: [PermissionFlagsBits.ManageChannels],
  botPermissions: [PermissionFlagsBits.ManageChannels],
  cooldown: 3,
  async execute(interaction) {
    await interaction.deferReply();
    const channel = resolveTextChannel(interaction);
    if (!channel) return fail(interaction, 'Pick a text channel.');

    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null }, { reason: `${interaction.user.username}: unlock` });
    await recordCase({ guild: interaction.guild, type: 'UNLOCK', moderatorId: interaction.user.id, reason: `#${channel.name}` });
    await succeed(interaction, `🔓 <#${channel.id}> is now unlocked.`);
  },
};

export default command;
