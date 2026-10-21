import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { recordCase } from '../../services/moderationService';
import { fail, resolveTextChannel, succeed } from '../../utils/reply';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Prevent @everyone from sending messages in a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Channel (default: current)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500)),
  memberPermissions: [PermissionFlagsBits.ManageChannels],
  botPermissions: [PermissionFlagsBits.ManageChannels],
  cooldown: 3,
  async execute(interaction) {
    await interaction.deferReply();
    const channel = resolveTextChannel(interaction);
    if (!channel) return fail(interaction, 'Pick a text channel.');
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false }, { reason: `${interaction.user.username}: ${reason}`.slice(0, 500) });
    await recordCase({ guild: interaction.guild, type: 'LOCK', moderatorId: interaction.user.id, reason: `#${channel.name}: ${reason}` });
    await succeed(interaction, `🔒 <#${channel.id}> is now locked.`);
  },
};

export default command;
