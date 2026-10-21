import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { sendStaffMessage } from '../../services/dmService';
import { logEvent } from '../../services/loggerService';
import { fail, succeed } from '../../utils/reply';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Send a direct message to a member on behalf of the staff')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Who receives the message').setRequired(true))
    .addStringOption((o) => o.setName('message').setDescription('The message').setRequired(true).setMaxLength(1500)),
  memberPermissions: [PermissionFlagsBits.ModerateMembers],
  guard: true,
  cooldown: 10,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('user', true);
    const message = interaction.options.getString('message', true);
    if (user.bot) return fail(interaction, 'Bots cannot receive direct messages.');
    if (!interaction.guild.members.cache.has(user.id) && !(await interaction.guild.members.fetch(user.id).catch(() => null))) {
      return fail(interaction, 'That user is not in this server.');
    }

    const delivered = await sendStaffMessage(user, interaction.guild, interaction.member.displayName, message);
    if (!delivered) return fail(interaction, `${user.username} has direct messages closed.`);
    await succeed(interaction, `Message delivered to ${user.username}.`);
    await logEvent(interaction.guild, {
      category: 'MODERATION',
      title: 'Direct message sent',
      executorId: interaction.user.id,
      targetId: user.id,
      fields: [{ name: 'Message', value: message.slice(0, 900), inline: false }],
    });
  },
};

export default command;
