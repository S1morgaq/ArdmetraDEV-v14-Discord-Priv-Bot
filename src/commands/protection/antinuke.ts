import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { getProtection, updateProtection } from '../../services/protectionService';
import { logEvent } from '../../services/loggerService';
import { isTrusted } from '../../protection/whitelist';
import { PUNISH_ACTIONS, type ProtectionPatch } from '../../types/protection';
import { fail, infoEmbed, succeed, cardReply } from '../../utils/reply';

const limit = (o: import('discord.js').SlashCommandIntegerOption, name: string, description: string) =>
  o.setName(name).setDescription(description).setMinValue(1).setMaxValue(50);

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('antinuke')
    .setDescription('Configure Anti-Nuke')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('status').setDescription('Show current Anti-Nuke settings'))
    .addSubcommand((s) =>
      s.setName('toggle').setDescription('Enable or disable Anti-Nuke').addBooleanOption((o) => o.setName('enabled').setDescription('Enabled').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Change thresholds and action')
        .addIntegerOption((o) => limit(o, 'channel_delete_limit', 'Channel deletions before action'))
        .addIntegerOption((o) => limit(o, 'role_delete_limit', 'Role deletions before action'))
        .addIntegerOption((o) => limit(o, 'ban_limit', 'Bans before action'))
        .addIntegerOption((o) => limit(o, 'kick_limit', 'Kicks before action'))
        .addIntegerOption((o) => o.setName('interval').setDescription('Window in seconds (1-120)').setMinValue(1).setMaxValue(120))
        .addStringOption((o) =>
          o.setName('action').setDescription('Punishment').addChoices(...PUNISH_ACTIONS.map((a) => ({ name: a, value: a }))),
        ),
    ),
  memberPermissions: [PermissionFlagsBits.ManageGuild],
  guard: true,
  async execute(interaction) {
    await interaction.deferReply();
    const sub = interaction.options.getSubcommand();

    if (sub !== 'status' && !(await isTrusted(interaction.guild, interaction.user.id))) {
      return fail(interaction, 'Only the server owner or a whitelisted user can change protection settings.');
    }

    if (sub === 'toggle') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await updateProtection(interaction.guildId, { antiNuke: { enabled } });
      await logEvent(interaction.guild, { category: 'PROTECTION', title: `Anti-Nuke ${enabled ? 'enabled' : 'disabled'}`, executorId: interaction.user.id });
      return succeed(interaction, `Anti-Nuke ${enabled ? 'enabled' : 'disabled'}.`);
    }

    if (sub === 'set') {
      const o = interaction.options;
      const patch: NonNullable<ProtectionPatch['antiNuke']> = {};
      const channelDeleteLimit = o.getInteger('channel_delete_limit');
      const roleDeleteLimit = o.getInteger('role_delete_limit');
      const banLimit = o.getInteger('ban_limit');
      const kickLimit = o.getInteger('kick_limit');
      const interval = o.getInteger('interval');
      const action = o.getString('action');
      if (channelDeleteLimit !== null) patch.channelDeleteLimit = channelDeleteLimit;
      if (roleDeleteLimit !== null) patch.roleDeleteLimit = roleDeleteLimit;
      if (banLimit !== null) patch.banLimit = banLimit;
      if (kickLimit !== null) patch.kickLimit = kickLimit;
      if (interval !== null) patch.interval = interval * 1000;
      if (action !== null) patch.action = action as (typeof PUNISH_ACTIONS)[number];
      if (Object.keys(patch).length === 0) return fail(interaction, 'Provide at least one option to change.');
      await updateProtection(interaction.guildId, { antiNuke: patch });
      await logEvent(interaction.guild, {
        category: 'PROTECTION',
        title: 'Anti-Nuke settings changed',
        executorId: interaction.user.id,
        description: '```json\n' + JSON.stringify(patch) + '\n```',
      });
      return succeed(interaction, 'Anti-Nuke settings updated.');
    }

    const { antiNuke: a } = await getProtection(interaction.guildId);
    const embed = infoEmbed('Anti-Nuke').addFields(
      { name: 'Enabled', value: a.enabled ? 'yes' : 'no', inline: true },
      { name: 'Window', value: `${a.interval / 1000}s`, inline: true },
      { name: 'Action', value: a.action, inline: true },
      { name: 'Channel delete', value: String(a.channelDeleteLimit), inline: true },
      { name: 'Role delete', value: String(a.roleDeleteLimit), inline: true },
      { name: 'Ban / Kick', value: `${a.banLimit} / ${a.kickLimit}`, inline: true },
      { name: 'Webhook / Perm update', value: `${a.webhookLimit} / ${a.permissionUpdateLimit}`, inline: true },
      { name: 'Bot add / Guild update', value: `${a.botAddLimit} / ${a.guildUpdateLimit}`, inline: true },
    );
    await interaction.editReply(await cardReply(embed, { kind: 'shield', chip: 'Anti-Nuke', title: 'Anti-Nuke settings', text: `Action: ${a.action} · window ${a.interval / 1000}s`, avatarUrl: interaction.guild.iconURL({ extension: 'png', size: 128 }) }));
  },
};

export default command;

