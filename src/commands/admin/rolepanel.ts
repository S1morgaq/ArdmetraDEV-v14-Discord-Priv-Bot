import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { MAX_PANEL_ROLES, createRolePanel, deleteRolePanel, listRolePanels } from '../../services/rolePanelService';
import { logEvent } from '../../services/loggerService';
import { errorMessage } from '../../utils/logger';
import { fail, succeed } from '../../utils/reply';

const ROLE_OPTIONS = 10;

const builder = new SlashCommandBuilder()
  .setName('rolepanel')
  .setDescription('Button role panels: members click a button to get or drop a role')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand((s) => {
    s.setName('create')
      .setDescription('Post a new role panel')
      .addStringOption((o) => o.setName('title').setDescription('Panel title').setRequired(true).setMaxLength(100))
      .addRoleOption((o) => o.setName('role1').setDescription('Role for the first button').setRequired(true));
    for (let i = 2; i <= ROLE_OPTIONS; i++) s.addRoleOption((o) => o.setName(`role${i}`).setDescription(`Role for button ${i}`));
    return s
      .addStringOption((o) => o.setName('description').setDescription('Text under the title').setMaxLength(500))
      .addChannelOption((o) => o.setName('channel').setDescription('Where to post (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement));
  })
  .addSubcommand((s) =>
    s
      .setName('delete')
      .setDescription('Remove a panel and its message')
      .addStringOption((o) => o.setName('message_id').setDescription('ID of the panel message').setRequired(true)),
  )
  .addSubcommand((s) => s.setName('list').setDescription('List the panels of this server'));

const command: Command = {
  data: builder,
  guard: true,
  memberPermissions: [PermissionFlagsBits.ManageRoles],
  cooldown: 5,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const panels = await listRolePanels(interaction.guildId);
      await interaction.reply({
        content: panels.length
          ? panels.map((p) => `• **${p.title}** — <#${p.channelId}> — ${p.roles.length} roles — \`${p.messageId}\``).join('\n').slice(0, 1900)
          : 'No role panels yet. Create one with `/rolepanel create`.',
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }

    await interaction.deferReply();

    if (sub === 'delete') {
      const removed = await deleteRolePanel(interaction.guild, interaction.options.getString('message_id', true).trim());
      if (!removed) return fail(interaction, 'No panel with that message ID.');
      await succeed(interaction, 'The panel was deleted.');
      return;
    }

    const roleIds: string[] = [];
    for (let i = 1; i <= ROLE_OPTIONS; i++) {
      const role = interaction.options.getRole(`role${i}`);
      if (role) roleIds.push(role.id);
    }
    if (roleIds.length > MAX_PANEL_ROLES) return fail(interaction, `At most ${MAX_PANEL_ROLES} roles per panel.`);

    try {
      const panel = await createRolePanel({
        guild: interaction.guild,
        channelId: interaction.options.getChannel('channel')?.id ?? interaction.channelId,
        title: interaction.options.getString('title', true),
        description: interaction.options.getString('description') ?? '',
        roleIds,
        createdBy: interaction.user.id,
      });
      await succeed(interaction, `Panel posted in #${interaction.guild.channels.cache.get(panel.channelId)?.name ?? 'channel'}.`);
      await logEvent(interaction.guild, { category: 'GUILD', title: 'Role panel created', executorId: interaction.user.id, description: panel.title });
    } catch (error) {
      await fail(interaction, errorMessage(error));
    }
  },
};

export default command;
