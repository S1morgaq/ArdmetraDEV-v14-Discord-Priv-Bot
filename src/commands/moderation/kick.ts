import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { recordCase } from '../../services/moderationService';
import { notifyModeration } from '../../services/dmService';
import { checkMemberHierarchy } from '../../utils/hierarchy';
import { fail, succeed } from '../../utils/reply';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500)),
  memberPermissions: [PermissionFlagsBits.KickMembers],
  botPermissions: [PermissionFlagsBits.KickMembers],
  cooldown: 2,
  async execute(interaction) {
    await interaction.deferReply();
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    const member = interaction.options.getMember('user');
    if (!member) return fail(interaction, 'That user is not in this server.');

    const problem = checkMemberHierarchy(interaction.guild, interaction.member, member);
    if (problem) return fail(interaction, problem);

    await notifyModeration(user, { guild: interaction.guild, action: 'KICK', moderator: interaction.member.displayName, reason });
    await member.kick(`${interaction.user.username}: ${reason}`.slice(0, 500));
    const caseId = await recordCase({ guild: interaction.guild, type: 'KICK', userId: user.id, moderatorId: interaction.user.id, reason });
    await succeed(interaction, `**${user.username}** was kicked. Case #${caseId}`);
  },
};

export default command;
