import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { GiveawayModel } from '../../database/models/Giveaway';
import { createGiveaway, endGiveaway, rerollGiveaway } from '../../services/giveawayService';
import { parseDuration } from '../../utils/duration';
import { fail, infoEmbed, succeed, cardReply } from '../../utils/reply';

const MAX_DURATION_MS = 90 * 86_400_000;

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Manage giveaways')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Start a giveaway')
        .addStringOption((o) => o.setName('prize').setDescription('Prize').setRequired(true).setMaxLength(200))
        .addStringOption((o) => o.setName('duration').setDescription('e.g. 30m, 2h, 1d').setRequired(true))
        .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners').setMinValue(1).setMaxValue(50))
        .addChannelOption((o) => o.setName('channel').setDescription('Channel (default: current)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    )
    .addSubcommand((s) =>
      s.setName('end').setDescription('End a giveaway now').addStringOption((o) => o.setName('message_id').setDescription('Giveaway message ID').setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName('reroll').setDescription('Pick new winners').addStringOption((o) => o.setName('message_id').setDescription('Giveaway message ID').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List active giveaways')),
  memberPermissions: [PermissionFlagsBits.ManageGuild],
  cooldown: 3,
  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply(sub === 'list' ? { flags: MessageFlags.Ephemeral } : undefined);

    if (sub === 'start') {
      const durationMs = parseDuration(interaction.options.getString('duration', true));
      if (durationMs === null || durationMs < 10_000 || durationMs > MAX_DURATION_MS) {
        return fail(interaction, 'Invalid duration. Use values like `30m`, `2h`, `1d` (10s – 90d).');
      }
      const channel = interaction.options.getChannel('channel') ?? interaction.channel;
      if (!channel) return fail(interaction, 'Could not resolve a channel.');
      try {
        await createGiveaway({
          guild: interaction.guild,
          channelId: channel.id,
          hostId: interaction.user.id,
          prize: interaction.options.getString('prize', true),
          winnerCount: interaction.options.getInteger('winners') ?? 1,
          durationMs,
        });
      } catch (error) {
        return fail(interaction, error instanceof Error ? error.message : 'Could not start the giveaway.');
      }
      return succeed(interaction, `Giveaway started in <#${channel.id}>.`);
    }

    if (sub === 'list') {
      const active = await GiveawayModel.find({ guildId: interaction.guildId, ended: false }).sort({ endsAt: 1 }).limit(15).lean();
      const embed = infoEmbed('Active giveaways');
      embed.setDescription(
        active.length === 0
          ? 'None.'
          : active
              .map((g) => `• **${g.prize}** — ends <t:${Math.floor(g.endsAt.getTime() / 1000)}:R> — ${g.participants.length} joined — \`${g.messageId ?? '?'}\``)
              .join('\n'),
      );
      await interaction.editReply(await cardReply(embed, { kind: 'star', chip: 'Giveaway', title: 'Active giveaways', text: `Running now: ${active.length}`, avatarUrl: interaction.guild.iconURL({ extension: 'png', size: 128 }) }));
      return;
    }

    const messageId = interaction.options.getString('message_id', true).trim();
    const doc = await GiveawayModel.findOne({ guildId: interaction.guildId, messageId }).select('_id ended').lean();
    if (!doc) return fail(interaction, 'No giveaway found for that message ID.');

    if (sub === 'end') {
      if (doc.ended) return fail(interaction, 'That giveaway already ended.');
      await endGiveaway(client, String(doc._id));
      return succeed(interaction, 'Giveaway ended.');
    }

    if (!doc.ended) return fail(interaction, 'End the giveaway before rerolling it.');
    const rerolled = await rerollGiveaway(client, String(doc._id));
    if (!rerolled) return fail(interaction, 'No participants to pick from.');
    await succeed(interaction, 'Winners rerolled.');
  },
};

export default command;
