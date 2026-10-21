import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { setLogChannel } from '../../services/guildService';
import { logEvent } from '../../services/loggerService';
import { fail, succeed } from '../../utils/reply';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('setlog')
    .setDescription('Set (or clear) the channel that receives protection and moderation logs')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) => o.setName('channel').setDescription('Log channel (omit to disable)').addChannelTypes(ChannelType.GuildText)),
  memberPermissions: [PermissionFlagsBits.ManageGuild],
  async execute(interaction) {
    await interaction.deferReply();
    const channel = interaction.options.getChannel('channel');
    if (!channel) {
      await setLogChannel(interaction.guildId, null);
      return succeed(interaction, 'Log channel disabled.');
    }
    const me = interaction.guild.members.me;
    const perms = me ? interaction.guild.channels.cache.get(channel.id)?.permissionsFor(me) : null;
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      return fail(interaction, 'I need View Channel, Send Messages and Embed Links in that channel.');
    }
    await setLogChannel(interaction.guildId, channel.id);
    await succeed(interaction, `Logs will be sent to <#${channel.id}>.`);
    await logEvent(interaction.guild, { category: 'GUILD', title: 'Log channel configured', executorId: interaction.user.id });
  },
};

export default command;
