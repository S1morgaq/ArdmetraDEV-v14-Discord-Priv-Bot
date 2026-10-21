import { Events, MessageFlags, type Interaction } from 'discord.js';
import type { EventModule } from '../types/handlers';
import { handleComponent } from '../handlers/componentHandler';
import { isTrusted } from '../protection/whitelist';
import { TtlCache } from '../utils/cache';
import { errorMessage, logger } from '../utils/logger';

const cooldowns = new TtlCache<string, number>({ ttlMs: 60_000, max: 20_000 });

const event: EventModule = {
  name: Events.InteractionCreate,
  async execute(client, interaction: Interaction) {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      if (!interaction.inCachedGuild()) {
        await interaction.reply({ content: '❌ This command can only be used inside a server.', flags: MessageFlags.Ephemeral });
        return;
      }

      const missing = command.memberPermissions?.filter((p) => !interaction.memberPermissions.has(p));
      if (missing && missing.length > 0) {
        await interaction.reply({ content: '❌ You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (command.guard && !(await isTrusted(interaction.guild, interaction.user.id))) {
        await interaction.reply({
          content: '🛡️ **Guard** — only the server owner and whitelisted users can use this command.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const botMissing = command.botPermissions?.filter((p) => !interaction.appPermissions.has(p));
      if (botMissing && botMissing.length > 0) {
        await interaction.reply({ content: '❌ I am missing the permissions needed to do that in this channel.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (command.cooldown) {
        const key = `${interaction.user.id}:${command.data.name}`;
        const until = cooldowns.get(key);
        if (until && until > Date.now()) {
          await interaction.reply({
            content: `⏳ Slow down: try again <t:${Math.ceil(until / 1000)}:R>.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        cooldowns.set(key, Date.now() + command.cooldown * 1000, command.cooldown * 1000);
      }

      try {
        await command.execute(interaction, client);
      } catch (error) {
        logger.error(`[COMMANDS] /${interaction.commandName} failed: ${error instanceof Error ? (error.stack ?? error.message) : errorMessage(error)}`);
        const payload = { content: '❌ An unexpected error occurred while running that command.', flags: MessageFlags.Ephemeral } as const;
        if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => undefined);
        else await interaction.reply(payload).catch(() => undefined);
      }
      return;
    }

    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
      await handleComponent(interaction, client);
    }
  },
};

export default event;
