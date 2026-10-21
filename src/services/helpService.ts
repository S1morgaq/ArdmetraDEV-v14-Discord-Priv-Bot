import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { BotClient } from '../client';
import { config } from '../config';
import { usageOf } from '../handlers/slashBridge';
import type { Command } from '../types/handlers';
import { getHelpBanner } from '../utils/banner';
import { E } from '../utils/emojis';
import { logger, errorMessage } from '../utils/logger';
import { COLORS, brand } from '../utils/reply';

interface Category {
  title: string;
  slash: string[];
}

const CATEGORIES: Category[] = [
  { title: `${E.ban} Moderation`, slash: ['ban', 'unban', 'kick', 'timeout', 'warn', 'warns', 'clear', 'lock', 'unlock', 'slowmode', 'nick', 'role'] },
  { title: `${E.shield} Protection (guarded)`, slash: ['protection', 'antinuke', 'antiraid', 'whitelist'] },
  { title: `${E.giveaway} Giveaway`, slash: ['giveaway'] },
  { title: '⚙️ Admin & Utility', slash: ['setlog', 'welcome', 'rolepanel', 'register', 'tag', 'taglist', 'dm', 'ping', 'help'] },
];

export interface HelpPayload {
  embeds: EmbedBuilder[];
  files: AttachmentBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

/** One help line: the prefix usage of a command (subcommands are listed as <a|b|c>) and its description. */
function commandLine(command: Command): string {
  return `${command.guard ? '🛡️ ' : ''}\`${usageOf(command, config.prefix)}\` — ${command.data.toJSON().description}`;
}

/** Embed field values cap at 1024 characters, so long lists are split across several fields. */
function addChunked(embed: EmbedBuilder, title: string, lines: string[]): void {
  let chunk = '';
  let part = 0;
  const flush = () => {
    if (!chunk) return;
    embed.addFields({ name: part === 0 ? title : '​', value: chunk });
    part += 1;
    chunk = '';
  };
  for (const line of lines) {
    if (chunk.length + line.length + 1 > 1000) flush();
    chunk += `${chunk ? '\n' : ''}${line}`;
  }
  flush();
}

/** Builds the animated help message. Falls back to a plain embed if canvas rendering is unavailable. */
export async function buildHelp(client: BotClient): Promise<HelpPayload> {
  const embed = brand(new EmbedBuilder())
    .setColor(COLORS.info)
    .setTitle(`${E.sparkles} Command list`)
    .setDescription(
      `Every command works with the prefix \`${config.prefix}\` (slash commands \`/\` work too). Fill in <required> and [optional] values; ` +
        'put "quotes" around values with spaces. 🛡️ = guarded (owner / whitelist only).',
    );

  const files: AttachmentBuilder[] = [];
  try {
    const banner = await getHelpBanner('S1morg', 'Bu Sunucuyu İzliyor');
    files.push(new AttachmentBuilder(banner, { name: 'help.gif' }));
    embed.setImage('attachment://help.gif');
  } catch (error) {
    logger.warn(`[HELP] Could not render the animated banner: ${errorMessage(error)}`);
  }

  const known = new Set<string>();
  for (const category of CATEGORIES) {
    const lines: string[] = [];
    for (const name of category.slash) {
      const command = client.commands.get(name);
      if (!command) continue;
      known.add(name);
      lines.push(commandLine(command));
    }
    addChunked(embed, category.title, lines);
  }
  // Commands added later that are not in a category above still show up.
  addChunked(embed, '📦 Other', [...client.commands.values()].filter((c) => !known.has(c.data.name)).map(commandLine));

  const prefixCommands = [...new Set(client.prefixCommands.values())];
  addChunked(
    embed,
    `${E.music} Extra commands`,
    prefixCommands.map(
      (c) => `${c.guard ? '🛡️ ' : ''}\`${config.prefix}${c.name}\`${c.aliases?.length ? ` (${c.aliases.map((a) => `${config.prefix}${a}`).join(', ')})` : ''} — ${c.description}`,
    ),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setLabel('Dashboard').setEmoji('🌐').setStyle(ButtonStyle.Link).setURL(config.dashboard.url),
    ),
  ];
  return { embeds: [embed], files, components };
}
