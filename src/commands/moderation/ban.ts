import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { recordCase } from '../../services/moderationService';
import { notifyModeration } from '../../services/dmService';
import { checkMemberHierarchy } from '../../utils/hierarchy';
import { fail, succeed } from '../../utils/reply';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user from the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500))
    .addIntegerOption((o) =>
      o.setName('delete_days').setDescription('Days of messages to delete (0-7)').setMinValue(0).setMaxValue(7),
    ),
  memberPermissions: [PermissionFlagsBits.BanMembers],
  botPermissions: [PermissionFlagsBits.BanMembers],
  cooldown: 2,
  async execute(interaction) {
    await interaction.deferReply();
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    const days = interaction.options.getInteger('delete_days') ?? 0;
    const member = interaction.options.getMember('user');

    if (member) {
      const problem = checkMemberHierarchy(interaction.guild, interaction.member, member);
      if (problem) return fail(interaction, problem);
    } else if (user.id === interaction.user.id || user.id === interaction.guild.ownerId) {
      return fail(interaction, 'You cannot ban that user.');
    }

    await notifyModeration(user, { guild: interaction.guild, action: 'BAN', moderator: interaction.member.displayName, reason });
    await interaction.guild.members.ban(user, {
      reason: `${interaction.user.username}: ${reason}`.slice(0, 500),
      deleteMessageSeconds: days * 86_400,
    });
    const caseId = await recordCase({ guild: interaction.guild, type: 'BAN', userId: user.id, moderatorId: interaction.user.id, reason });
    await succeed(interaction, `**${user.username}** was banned. Case #${caseId}`);
  },
};

export default command;
