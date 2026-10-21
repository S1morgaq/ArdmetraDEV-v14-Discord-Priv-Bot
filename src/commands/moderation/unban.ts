import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { recordCase } from '../../services/moderationService';
import { fail, succeed } from '../../utils/reply';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Remove a ban')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((o) => o.setName('user_id').setDescription('ID of the banned user').setRequired(true).setMinLength(15).setMaxLength(25))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500)),
  memberPermissions: [PermissionFlagsBits.BanMembers],
  botPermissions: [PermissionFlagsBits.BanMembers],
  async execute(interaction) {
    await interaction.deferReply();
    const userId = interaction.options.getString('user_id', true).trim();
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    if (!/^\d{15,25}$/.test(userId)) return fail(interaction, 'That is not a valid user ID.');

    const ban = await interaction.guild.bans.fetch({ user: userId, force: true }).catch(() => null);
    if (!ban) return fail(interaction, 'That user is not banned.');

    await interaction.guild.members.unban(userId, `${interaction.user.username}: ${reason}`.slice(0, 500));
    const caseId = await recordCase({ guild: interaction.guild, type: 'UNBAN', userId, moderatorId: interaction.user.id, reason });
    await succeed(interaction, `**${ban.user.username}** was unbanned. Case #${caseId}`);
  },
};

export default command;
