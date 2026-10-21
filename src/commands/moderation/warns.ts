import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { listWarnings } from '../../services/moderationService';
import { infoEmbed, cardReply } from '../../utils/reply';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('warns')
    .setDescription("Show a member's warnings")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
  memberPermissions: [PermissionFlagsBits.ModerateMembers],
  async execute(interaction) {
    await interaction.deferReply();
    const user = interaction.options.getUser('user', true);
    const warnings = await listWarnings(interaction.guildId, user.id, 15);
    const embed = infoEmbed(`Warnings for ${user.username}`);
    if (warnings.length === 0) embed.setDescription('No warnings.');
    else {
      embed.setDescription(
        warnings
          .map((w) => `• <t:${Math.floor(new Date(w.createdAt).getTime() / 1000)}:d> by <@${w.moderatorId}> — ${w.reason}`)
          .join('\n')
          .slice(0, 4000),
      );
    }
    await interaction.editReply(await cardReply(embed, { kind: 'warn', chip: 'Warnings', title: `Warnings for ${user.username}`, text: `Showing ${warnings.length} most recent`, avatarUrl: user.displayAvatarURL({ extension: 'png', size: 128 }) }));
  },
};

export default command;
