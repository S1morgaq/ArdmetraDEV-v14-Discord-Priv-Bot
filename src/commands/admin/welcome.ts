import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { getGuildSettings, setWelcomeField } from '../../services/guildService';
import { DEFAULT_GOODBYE, DEFAULT_WELCOME, buildWelcomePayload } from '../../services/welcomeService';
import { logEvent } from '../../services/loggerService';
import { fail, succeed } from '../../utils/reply';

const textTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;
const HELP = 'Placeholders: {user} {name} {server} {count}';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Animated welcome / goodbye cards and auto role')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('channel')
        .setDescription('Where welcome cards are posted (omit to disable)')
        .addChannelOption((o) => o.setName('channel').setDescription('Welcome channel').addChannelTypes(...textTypes)),
    )
    .addSubcommand((s) =>
      s
        .setName('goodbye')
        .setDescription('Where goodbye cards are posted (omit to disable)')
        .addChannelOption((o) => o.setName('channel').setDescription('Goodbye channel').addChannelTypes(...textTypes)),
    )
    .addSubcommand((s) =>
      s
        .setName('message')
        .setDescription(`Text above the card. ${HELP}`)
        .addStringOption((o) => o.setName('type').setDescription('Which message').setRequired(true).addChoices({ name: 'welcome', value: 'welcome' }, { name: 'goodbye', value: 'goodbye' }))
        .addStringOption((o) => o.setName('text').setDescription(`Message (omit to reset). ${HELP}`).setMaxLength(500)),
    )
    .addSubcommand((s) =>
      s
        .setName('autorole')
        .setDescription('Role given to every new member (omit to disable)')
        .addRoleOption((o) => o.setName('role').setDescription('Role to assign')),
    )
    .addSubcommand((s) => s.setName('test').setDescription('Preview the welcome card with your own account'))
    .addSubcommand((s) => s.setName('status').setDescription('Show the current welcome settings')),
  memberPermissions: [PermissionFlagsBits.ManageGuild],
  cooldown: 3,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'test') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const settings = (await getGuildSettings(guildId)).welcome;
      const payload = await buildWelcomePayload('welcome', interaction.member, settings?.message);
      await interaction.editReply({ content: payload.content, files: payload.files as never });
      return;
    }

    if (sub === 'status') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const w = (await getGuildSettings(guildId)).welcome;
      await interaction.editReply({
        content: [
          `**Welcome channel:** ${w?.channelId ? `<#${w.channelId}>` : 'off'}`,
          `**Goodbye channel:** ${w?.goodbyeChannelId ? `<#${w.goodbyeChannelId}>` : 'off'}`,
          `**Auto role:** ${w?.autoRoleId ? `<@&${w.autoRoleId}>` : 'off'}`,
          `**Welcome text:** ${w?.message ?? DEFAULT_WELCOME}`,
          `**Goodbye text:** ${w?.goodbyeMessage ?? DEFAULT_GOODBYE}`,
        ].join('\n'),
        allowedMentions: { parse: [] },
      });
      return;
    }

    await interaction.deferReply();

    if (sub === 'channel' || sub === 'goodbye') {
      const channel = interaction.options.getChannel('channel');
      const field = sub === 'channel' ? 'channelId' : 'goodbyeChannelId';
      if (channel) {
        const me = interaction.guild.members.me;
        const perms = me ? interaction.guild.channels.cache.get(channel.id)?.permissionsFor(me) : null;
        if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles])) {
          return fail(interaction, 'I need View Channel, Send Messages and Attach Files in that channel.');
        }
      }
      await setWelcomeField(guildId, field, channel?.id ?? null);
      await succeed(interaction, channel ? `${sub === 'channel' ? 'Welcome' : 'Goodbye'} cards go to #${channel.name}.` : `${sub === 'channel' ? 'Welcome' : 'Goodbye'} cards disabled.`);
    } else if (sub === 'message') {
      const type = interaction.options.getString('type', true);
      const text = interaction.options.getString('text');
      await setWelcomeField(guildId, type === 'welcome' ? 'message' : 'goodbyeMessage', text);
      await succeed(interaction, text ? `The ${type} text was updated.` : `The ${type} text was reset to the default.`);
    } else {
      const role = interaction.options.getRole('role');
      if (role) {
        const me = interaction.guild.members.me;
        if (role.managed || role.id === guildId) return fail(interaction, 'That role cannot be assigned.');
        if (!me?.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= me.roles.highest.position) {
          return fail(interaction, 'That role is above my highest role (or I lack Manage Roles).');
        }
      }
      await setWelcomeField(guildId, 'autoRoleId', role?.id ?? null);
      await succeed(interaction, role ? `New members now receive ${role.name}.` : 'Auto role disabled.');
    }
    await logEvent(interaction.guild, { category: 'GUILD', title: `Welcome settings changed (${sub})`, executorId: interaction.user.id });
  },
};

export default command;
