import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { addWarning, recordCase } from '../../services/moderationService';
import { notifyModeration } from '../../services/dmService';
import { checkMemberHierarchy } from '../../utils/hierarchy';
import { fail, succeed } from '../../utils/reply';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(500)),
  memberPermissions: [PermissionFlagsBits.ModerateMembers],
  async execute(interaction) {
    await interaction.deferReply();
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', true);
    const member = interaction.options.getMember('user');
    if (!member) return fail(interaction, 'That user is not in this server.');

    const problem = checkMemberHierarchy(interaction.guild, interaction.member, member);
    if (problem) return fail(interaction, problem);

    const total = await addWarning(interaction.guildId, user.id, interaction.user.id, reason);
    await notifyModeration(user, { guild: interaction.guild, action: 'WARN', moderator: interaction.member.displayName, reason, warnCount: total });
    const caseId = await recordCase({ guild: interaction.guild, type: 'WARN', userId: user.id, moderatorId: interaction.user.id, reason });
    await succeed(interaction, `**${user.username}** was warned (total ${total}). Case #${caseId}`);
  },
};

export default command;
