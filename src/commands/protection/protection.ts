import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { getProtection } from '../../services/protectionService';
import { getGuildSettings } from '../../services/guildService';
import { E } from '../../utils/emojis';
import { infoEmbed, cardReply } from '../../utils/reply';

const flag = (on: boolean) => (on ? `${E.on} ON` : `${E.off} OFF`);

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('protection')
    .setDescription('Protection overview')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('status').setDescription('Show the state of every protection module'))
    .addSubcommand((s) => s.setName('reset').setDescription('Reset all protection settings to defaults')),
  memberPermissions: [PermissionFlagsBits.ManageGuild],
  guard: true,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'reset') {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`protection:confirm:reset:${interaction.user.id}`).setLabel('Reset').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`protection:cancel:reset:${interaction.user.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      await interaction.reply({ content: '⚠️ Reset **all** protection settings to their defaults?', components: [row], flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();
    const [p, settings] = await Promise.all([getProtection(interaction.guildId), getGuildSettings(interaction.guildId)]);
    const embed = infoEmbed(`${E.shield} Protection status`).addFields(
      { name: 'Role Protection', value: flag(p.roleProtection.enabled), inline: true },
      { name: 'Channel Protection', value: flag(p.channelProtection.enabled), inline: true },
      { name: 'Server Protection', value: flag(p.serverProtection.enabled), inline: true },
      { name: 'Permission Protection', value: flag(p.permissionProtection.enabled), inline: true },
      { name: 'Webhook Protection', value: flag(p.webhookProtection.enabled), inline: true },
      { name: 'Bot Protection', value: `${flag(p.botProtection.enabled)} (${p.botProtection.action})`, inline: true },
      {
        name: 'Anti-Nuke',
        value: `${flag(p.antiNuke.enabled)}\nchannel/role delete ${p.antiNuke.channelDeleteLimit}/${p.antiNuke.roleDeleteLimit}, ban/kick ${p.antiNuke.banLimit}/${p.antiNuke.kickLimit} per ${p.antiNuke.interval / 1000}s → ${p.antiNuke.action}`,
        inline: false,
      },
      {
        name: 'Anti-Raid',
        value: `${flag(p.antiRaid.enabled)}\n${p.antiRaid.joinLimit} joins / ${p.antiRaid.interval / 1000}s → ${p.antiRaid.action}`,
        inline: false,
      },
      { name: 'Anti-Spam', value: `${flag(p.antiSpam.enabled)} → ${p.antiSpam.action}`, inline: false },
      { name: 'Log channel', value: settings.logChannelId ? `<#${settings.logChannelId}>` : 'Not set (`/setlog`)', inline: false },
    );
    await interaction.editReply(await cardReply(embed, { kind: 'shield', chip: 'Protection', title: 'Protection status', text: 'Live state of every protection module', avatarUrl: interaction.guild.iconURL({ extension: 'png', size: 128 }) }));
  },
};

export default command;
