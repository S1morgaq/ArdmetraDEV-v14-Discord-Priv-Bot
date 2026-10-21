import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { addWhitelist, listWhitelist, removeWhitelist } from '../../protection/whitelist';
import { logEvent } from '../../services/loggerService';
import { fail, infoEmbed, succeed, cardReply } from '../../utils/reply';

/**
 * The whitelist is the trust root of every protection module, so the whole command is behind the
 * guard (owner / whitelisted only): a compromised admin cannot whitelist themselves.
 */
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Manage users, roles and bots that protection systems ignore')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a user, bot or role (bots are detected automatically)')
        .addUserOption((o) => o.setName('user').setDescription('User or bot'))
        .addRoleOption((o) => o.setName('role').setDescription('Role')),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove an entry')
        .addUserOption((o) => o.setName('user').setDescription('User or bot'))
        .addRoleOption((o) => o.setName('role').setDescription('Role'))
        .addStringOption((o) => o.setName('id').setDescription('Raw ID (for users that left the server)').setMinLength(15).setMaxLength(25)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Show the whitelist')),
  memberPermissions: [PermissionFlagsBits.ManageGuild],
  guard: true,
  async execute(interaction) {
    await interaction.deferReply();
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'list') {
      const entries = await listWhitelist(guildId);
      const line = (type: string, mention: (id: string) => string) =>
        entries.filter((e) => e.type === type).map((e) => `${mention(e.targetId)}`).join('\n') || '—';
      const embed = infoEmbed('🛡️ Whitelist', `Total entries: **${entries.length}**`).addFields(
        { name: '👤 Users', value: line('user', (id) => `<@${id}>`).slice(0, 1024), inline: true },
        { name: '🎭 Roles', value: line('role', (id) => `<@&${id}>`).slice(0, 1024), inline: true },
        { name: '🤖 Bots', value: line('bot', (id) => `<@${id}>`).slice(0, 1024), inline: true },
      );
      await interaction.editReply(await cardReply(embed, { kind: 'shield', chip: 'Whitelist', title: 'Trusted list', text: `Total entries: ${entries.length}`, avatarUrl: interaction.guild.iconURL({ extension: 'png', size: 128 }) }));
      return;
    }

    const user = interaction.options.getUser('user');
    const role = interaction.options.getRole('role');

    if (sub === 'add') {
      if (!user && !role) return fail(interaction, 'Provide a `user` or a `role`.');
      const added: string[] = [];
      if (user) {
        await addWhitelist(guildId, user.id, user.bot ? 'bot' : 'user', interaction.user.id);
        added.push(`${user.bot ? '🤖' : '👤'} <@${user.id}>`);
      }
      if (role) {
        await addWhitelist(guildId, role.id, 'role', interaction.user.id);
        added.push(`🎭 <@&${role.id}>`);
      }
      await logEvent(interaction.guild, {
        category: 'PROTECTION',
        title: 'Whitelist entries added',
        executorId: interaction.user.id,
        description: added.join('\n'),
      });
      return succeed(interaction, `Added to the whitelist:\n${added.join('\n')}`);
    }

    const rawId = interaction.options.getString('id')?.trim();
    const targets = [user?.id, role?.id, rawId].filter((v): v is string => Boolean(v));
    if (targets.length === 0) return fail(interaction, 'Provide a `user`, a `role` or an `id`.');
    const removed: string[] = [];
    for (const id of targets) if (await removeWhitelist(guildId, id)) removed.push(`\`${id}\``);
    if (removed.length === 0) return fail(interaction, 'None of those are on the whitelist.');
    await logEvent(interaction.guild, {
      category: 'PROTECTION',
      title: 'Whitelist entries removed',
      executorId: interaction.user.id,
      description: removed.join(', '),
    });
    await succeed(interaction, `Removed from the whitelist: ${removed.join(', ')}`);
  },
};

export default command;
