import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { recordCase } from '../../services/moderationService';
import { checkMemberHierarchy } from '../../utils/hierarchy';
import { fail, succeed } from '../../utils/reply';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('nick')
    .setDescription("Change or reset a member's nickname")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('nickname').setDescription('New nickname (leave empty to reset)').setMaxLength(32)),
  memberPermissions: [PermissionFlagsBits.ManageNicknames],
  botPermissions: [PermissionFlagsBits.ManageNicknames],
  cooldown: 2,
  async execute(interaction) {
    await interaction.deferReply();
    const member = interaction.options.getMember('user');
    if (!member) return fail(interaction, 'That user is not in this server.');
    const nickname = interaction.options.getString('nickname');

    // Changing your own nickname is fine; everyone else goes through the hierarchy checks.
    if (member.id !== interaction.user.id) {
      const problem = checkMemberHierarchy(interaction.guild, interaction.member, member);
      if (problem) return fail(interaction, problem);
    } else if (!member.manageable) {
      return fail(interaction, 'I cannot change your nickname.');
    }

    await member.setNickname(nickname, `${interaction.user.username}: nickname change`);
    await recordCase({
      guild: interaction.guild,
      type: 'NICK',
      userId: member.id,
      moderatorId: interaction.user.id,
      reason: nickname ? `Nickname set to "${nickname}"` : 'Nickname reset',
    });
    await succeed(interaction, nickname ? `Nickname of **${member.user.username}** set to **${nickname}**.` : `Nickname of **${member.user.username}** reset.`);
  },
};

export default command;
