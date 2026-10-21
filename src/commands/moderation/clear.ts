import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { recordCase } from '../../services/moderationService';
import { fail, succeed } from '../../utils/reply';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Bulk delete recent messages (younger than 14 days)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) => o.setName('amount').setDescription('How many messages (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((o) => o.setName('user').setDescription('Only delete messages from this user')),
  memberPermissions: [PermissionFlagsBits.ManageMessages],
  botPermissions: [PermissionFlagsBits.ManageMessages],
  cooldown: 3,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || channel.isDMBased() || !('bulkDelete' in channel)) {
      return fail(interaction, 'This channel does not support bulk deletion.');
    }
    const amount = interaction.options.getInteger('amount', true);
    const target = interaction.options.getUser('user');

    let deleted: number;
    if (target) {
      const recent = await channel.messages.fetch({ limit: 100 });
      const ids = [...recent.filter((m) => m.author.id === target.id).keys()].slice(0, amount);
      deleted = ids.length > 0 ? (await channel.bulkDelete(ids, true)).size : 0;
    } else {
      deleted = (await channel.bulkDelete(amount, true)).size;
    }

    await recordCase({
      guild: interaction.guild,
      type: 'CLEAR',
      userId: target?.id ?? null,
      moderatorId: interaction.user.id,
      reason: `Cleared ${deleted} messages in #${channel.name}`,
    });
    await succeed(interaction, `Deleted **${deleted}** messages.`);
  },
};

export default command;
