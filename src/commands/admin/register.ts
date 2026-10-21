import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { logEvent } from '../../services/loggerService';
import { disableRegistration, getRegisterConfig, registrationStats, setupRegistration } from '../../services/registerService';
import { errorMessage } from '../../utils/logger';
import { fail, succeed } from '../../utils/reply';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Gender registration panel (Erkek / Kız buttons)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('setup')
        .setDescription('Post the registration panel and set the roles')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel that gets the Erkek / Kız buttons').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addRoleOption((o) => o.setName('male').setDescription('Role given to Erkek').setRequired(true))
        .addRoleOption((o) => o.setName('female').setDescription('Role given to Kız').setRequired(true))
        .addChannelOption((o) => o.setName('chat').setDescription('Chat channel for "aramıza katıldı" messages (default: panel channel)').addChannelTypes(ChannelType.GuildText))
        .addRoleOption((o) => o.setName('unregistered').setDescription('Unregistered role that is removed after registering')),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Show the registration settings'))
    .addSubcommand((s) => s.setName('off').setDescription('Remove the panel and turn registration off')),
  guard: true,
  memberPermissions: [PermissionFlagsBits.ManageGuild],
  cooldown: 5,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;

    if (sub === 'status') {
      const cfg = await getRegisterConfig(guild.id);
      const stats = await registrationStats(guild.id);
      await interaction.reply({
        content: cfg
          ? [
              `**Panel:** <#${cfg.channelId}>`,
              `**Chat:** ${cfg.chatChannelId ? `<#${cfg.chatChannelId}>` : 'panel channel'}`,
              `**Erkek:** <@&${cfg.maleRoleId}> (${stats.male})`,
              `**Kız:** <@&${cfg.femaleRoleId}> (${stats.female})`,
              `**Kayıtsız rolü:** ${cfg.unregisteredRoleId ? `<@&${cfg.unregisteredRoleId}>` : 'none'}`,
            ].join('\n')
          : 'Registration is off. Turn it on with `/register setup`.',
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }

    await interaction.deferReply();

    if (sub === 'off') {
      await disableRegistration(guild);
      await succeed(interaction, 'Registration turned off and the panel was removed.');
      await logEvent(guild, { category: 'GUILD', title: 'Registration disabled', executorId: interaction.user.id });
      return;
    }

    try {
      await setupRegistration(guild, {
        channelId: interaction.options.getChannel('channel', true).id,
        chatChannelId: interaction.options.getChannel('chat')?.id ?? null,
        maleRoleId: interaction.options.getRole('male', true).id,
        femaleRoleId: interaction.options.getRole('female', true).id,
        unregisteredRoleId: interaction.options.getRole('unregistered')?.id ?? null,
      });
      await succeed(interaction, 'The registration panel is live.');
      await logEvent(guild, { category: 'GUILD', title: 'Registration panel posted', executorId: interaction.user.id });
    } catch (error) {
      await fail(interaction, errorMessage(error));
    }
  },
};

export default command;
