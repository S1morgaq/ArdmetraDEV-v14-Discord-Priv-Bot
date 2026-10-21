import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { setTagConfig } from '../../services/guildService';
import { logEvent } from '../../services/loggerService';
import { roleProblem } from '../../services/rolePanelService';
import { getTagConfig, isScanning, scanGuild } from '../../services/tagService';
import { errorMessage } from '../../utils/logger';
import { fail, succeed } from '../../utils/reply';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Tag system: members who wear the server tag in their name get a role automatically')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Set the tag and the role')
        .addStringOption((o) => o.setName('tag').setDescription('Text to look for in names, e.g. ✦ or S1m').setRequired(true).setMinLength(1).setMaxLength(16))
        .addRoleOption((o) => o.setName('role').setDescription('Role for members wearing the tag').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('off').setDescription('Turn the tag system off (roles are kept)'))
    .addSubcommand((s) => s.setName('status').setDescription('Show the tag settings and how many members wear it'))
    .addSubcommand((s) => s.setName('scan').setDescription('Check every member now and fix their tag role')),
  guard: true,
  memberPermissions: [PermissionFlagsBits.ManageRoles],
  cooldown: 5,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { guild } = interaction;

    if (sub === 'status') {
      const config = await getTagConfig(guild.id);
      const role = config ? guild.roles.cache.get(config.roleId) : null;
      await interaction.reply({
        content: config
          ? `**Tag:** \`${config.text}\`\n**Role:** ${role ? `<@&${role.id}> (${role.members.size} members)` : 'deleted'}\n**Scan running:** ${isScanning(guild.id) ? 'yes' : 'no'}`
          : 'The tag system is off. Turn it on with `/tag set`.',
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }

    await interaction.deferReply();

    if (sub === 'off') {
      await setTagConfig(guild.id, null, null);
      await succeed(interaction, 'Tag system turned off.');
      await logEvent(guild, { category: 'GUILD', title: 'Tag system disabled', executorId: interaction.user.id });
      return;
    }

    if (sub === 'scan') {
      try {
        await succeed(interaction, 'Scan started, this can take a while on big servers.');
        const result = await scanGuild(guild);
        await logEvent(guild, {
          category: 'GUILD',
          title: 'Tag scan finished',
          executorId: interaction.user.id,
          description: `${result.withTag} members wear the tag. Roles added: ${result.added}, removed: ${result.removed}.`,
        });
      } catch (error) {
        await fail(interaction, errorMessage(error));
      }
      return;
    }

    const text = interaction.options.getString('tag', true).trim();
    const role = interaction.options.getRole('role', true);
    const fullRole = guild.roles.cache.get(role.id);
    const problem = fullRole ? roleProblem(guild, fullRole) : 'Role not found.';
    if (problem) return fail(interaction, problem);
    await setTagConfig(guild.id, text, role.id);
    await succeed(interaction, `Members with "${text}" in their name now get ${role.name}. Run /tag scan to apply it to everyone.`);
    await logEvent(guild, { category: 'GUILD', title: 'Tag system configured', executorId: interaction.user.id, description: `Tag \`${text}\` → <@&${role.id}>` });
  },
};

export default command;
