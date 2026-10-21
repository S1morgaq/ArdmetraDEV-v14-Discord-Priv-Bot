import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { recordCase } from '../../services/moderationService';
import { botCanManageRole, checkMemberHierarchy } from '../../utils/hierarchy';
import { fail, succeed } from '../../utils/reply';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Add or remove a role from a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Give a role to a member')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Take a role from a member')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
    ),
  memberPermissions: [PermissionFlagsBits.ManageRoles],
  botPermissions: [PermissionFlagsBits.ManageRoles],
  cooldown: 2,
  async execute(interaction) {
    await interaction.deferReply();
    const adding = interaction.options.getSubcommand() === 'add';
    const member = interaction.options.getMember('user');
    const role = interaction.options.getRole('role', true);
    if (!member) return fail(interaction, 'That user is not in this server.');

    const guildRole = interaction.guild.roles.cache.get(role.id);
    if (!guildRole || guildRole.id === interaction.guildId) return fail(interaction, 'That role cannot be assigned.');
    if (!botCanManageRole(interaction.guild, guildRole)) return fail(interaction, 'I cannot manage that role (managed role or above my highest role).');
    if (interaction.user.id !== interaction.guild.ownerId && interaction.member.roles.highest.comparePositionTo(guildRole) <= 0) {
      return fail(interaction, 'That role is equal to or higher than your highest role.');
    }
    if (member.id !== interaction.user.id) {
      const problem = checkMemberHierarchy(interaction.guild, interaction.member, member);
      if (problem) return fail(interaction, problem);
    }

    if (adding) await member.roles.add(guildRole, `${interaction.user.username}: role add`);
    else await member.roles.remove(guildRole, `${interaction.user.username}: role remove`);

    await recordCase({
      guild: interaction.guild,
      type: 'ROLE',
      userId: member.id,
      moderatorId: interaction.user.id,
      reason: `${adding ? 'Added' : 'Removed'} role ${guildRole.name}`,
    });
    await succeed(interaction, `${adding ? 'Added' : 'Removed'} **${guildRole.name}** ${adding ? 'to' : 'from'} **${member.user.username}**.`);
  },
};

export default command;
