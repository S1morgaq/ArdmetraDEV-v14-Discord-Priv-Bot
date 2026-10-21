import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/handlers';
import { getProtection, updateProtection } from '../../services/protectionService';
import { logEvent } from '../../services/loggerService';
import { isTrusted } from '../../protection/whitelist';
import { endLockdown } from '../../protection/antiRaid';
import type { ProtectionPatch } from '../../types/protection';
import { fail, infoEmbed, succeed, cardReply } from '../../utils/reply';

const ACTIONS = ['LOG', 'ALERT', 'LOCK', 'KICK', 'BAN'] as const;

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('antiraid')
    .setDescription('Configure Anti-Raid')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('status').setDescription('Show current Anti-Raid settings'))
    .addSubcommand((s) =>
      s.setName('toggle').setDescription('Enable or disable Anti-Raid').addBooleanOption((o) => o.setName('enabled').setDescription('Enabled').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Change thresholds and action')
        .addIntegerOption((o) => o.setName('join_limit').setDescription('Joins that trigger a raid').setMinValue(2).setMaxValue(500))
        .addIntegerOption((o) => o.setName('interval').setDescription('Window in seconds (1-300)').setMinValue(1).setMaxValue(300))
        .addIntegerOption((o) => o.setName('new_account_days').setDescription('Only count accounts younger than N days (0 = all)').setMinValue(0).setMaxValue(365))
        .addStringOption((o) => o.setName('action').setDescription('Action').addChoices(...ACTIONS.map((a) => ({ name: a, value: a })))),
    )
    .addSubcommand((s) => s.setName('unlock').setDescription('End an active raid lockdown now')),
  memberPermissions: [PermissionFlagsBits.ManageGuild],
  guard: true,
  async execute(interaction) {
    await interaction.deferReply();
    const sub = interaction.options.getSubcommand();

    if (sub !== 'status' && !(await isTrusted(interaction.guild, interaction.user.id))) {
      return fail(interaction, 'Only the server owner or a whitelisted user can change protection settings.');
    }

    if (sub === 'unlock') {
      const ended = await endLockdown(interaction.guild);
      return ended ? succeed(interaction, 'Lockdown ended.') : fail(interaction, 'No lockdown is active.');
    }

    if (sub === 'toggle') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await updateProtection(interaction.guildId, { antiRaid: { enabled } });
      await logEvent(interaction.guild, { category: 'PROTECTION', title: `Anti-Raid ${enabled ? 'enabled' : 'disabled'}`, executorId: interaction.user.id });
      return succeed(interaction, `Anti-Raid ${enabled ? 'enabled' : 'disabled'}.`);
    }

    if (sub === 'set') {
      const o = interaction.options;
      const patch: NonNullable<ProtectionPatch['antiRaid']> = {};
      const joinLimit = o.getInteger('join_limit');
      const interval = o.getInteger('interval');
      const days = o.getInteger('new_account_days');
      const action = o.getString('action');
      if (joinLimit !== null) patch.joinLimit = joinLimit;
      if (interval !== null) patch.interval = interval * 1000;
      if (days !== null) patch.newAccountDays = days;
      if (action !== null) patch.action = action as (typeof ACTIONS)[number];
      if (Object.keys(patch).length === 0) return fail(interaction, 'Provide at least one option to change.');
      await updateProtection(interaction.guildId, { antiRaid: patch });
      await logEvent(interaction.guild, {
        category: 'PROTECTION',
        title: 'Anti-Raid settings changed',
        executorId: interaction.user.id,
        description: '```json\n' + JSON.stringify(patch) + '\n```',
      });
      return succeed(interaction, 'Anti-Raid settings updated.');
    }

    const { antiRaid: a } = await getProtection(interaction.guildId);
    const embed = infoEmbed('Anti-Raid').addFields(
      { name: 'Enabled', value: a.enabled ? 'yes' : 'no', inline: true },
      { name: 'Threshold', value: `${a.joinLimit} joins / ${a.interval / 1000}s`, inline: true },
      { name: 'Action', value: a.action, inline: true },
      { name: 'Account age filter', value: a.newAccountDays > 0 ? `younger than ${a.newAccountDays}d` : 'off', inline: true },
      { name: 'Cooldown', value: `${a.cooldownSeconds}s`, inline: true },
      { name: 'Lockdown length', value: `${a.lockdownSeconds}s`, inline: true },
    );
    await interaction.editReply(await cardReply(embed, { kind: 'warn', chip: 'Anti-Raid', title: 'Anti-Raid settings', text: `Action: ${a.action} · ${a.joinLimit} joins / ${a.interval / 1000}s`, avatarUrl: interaction.guild.iconURL({ extension: 'png', size: 128 }) }));
  },
};

export default command;

