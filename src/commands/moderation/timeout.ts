import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { recordCase } from '../../services/moderationService';
import { notifyModeration } from '../../services/dmService';
import { checkMemberHierarchy } from '../../utils/hierarchy';
import { formatDuration, parseDuration } from '../../utils/duration';
import { fail, succeed } from '../../utils/reply';

const MAX_TIMEOUT_MS = 28 * 86_400_000;

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Time out a member (use duration "off" to remove)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 2h, 1d or "off"').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500)),
  memberPermissions: [PermissionFlagsBits.ModerateMembers],
  botPermissions: [PermissionFlagsBits.ModerateMembers],
  cooldown: 2,
  async execute(interaction) {
    await interaction.deferReply();
    const user = interaction.options.getUser('user', true);
    const raw = interaction.options.getString('duration', true);
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    const member = interaction.options.getMember('user');
    if (!member) return fail(interaction, 'That user is not in this server.');

    const problem = checkMemberHierarchy(interaction.guild, interaction.member, member);
    if (problem) return fail(interaction, problem);
    if (!member.moderatable) return fail(interaction, 'I cannot time out that member (administrator or higher role).');

    const remove = raw.trim().toLowerCase() === 'off';
    const durationMs = remove ? null : parseDuration(raw);
    if (!remove && (durationMs === null || durationMs > MAX_TIMEOUT_MS)) {
      return fail(interaction, 'Invalid duration. Use values like `30m`, `2h`, `1d` (max 28 days).');
    }

    await member.timeout(durationMs, `${interaction.user.username}: ${reason}`.slice(0, 500));
    if (durationMs) await notifyModeration(user, { guild: interaction.guild, action: 'TIMEOUT', moderator: interaction.member.displayName, reason, durationMs });
    const caseId = await recordCase({
      guild: interaction.guild,
      type: 'TIMEOUT',
      userId: user.id,
      moderatorId: interaction.user.id,
      reason,
      durationMs,
    });
    await succeed(
      interaction,
      remove
        ? `Timeout removed from **${user.username}**. Case #${caseId}`
        : `**${user.username}** was timed out for ${formatDuration(durationMs ?? 0)}. Case #${caseId}`,
    );
  },
};

export default command;
