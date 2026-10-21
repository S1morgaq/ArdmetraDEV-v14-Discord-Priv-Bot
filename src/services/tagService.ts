import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Guild, type GuildMember, type InteractionEditReplyOptions, type PartialGuildMember } from 'discord.js';
import { getGuildSettings } from './guildService';
import { roleProblem } from './rolePanelService';
import { errorMessage, logger } from '../utils/logger';
import { withCard } from '../utils/card';
import { COLORS, brand } from '../utils/reply';

export interface TagConfig {
  text: string;
  roleId: string;
}

export async function getTagConfig(guildId: string): Promise<TagConfig | null> {
  const tag = (await getGuildSettings(guildId)).tag;
  return tag?.text && tag.roleId ? { text: tag.text, roleId: tag.roleId } : null;
}

/** A member "wears" the tag when it appears in their server nickname, display name or username. */
export function wearsTag(member: GuildMember | PartialGuildMember, text: string): boolean {
  const needle = text.toLowerCase();
  const names = [member.nickname, member.user?.globalName, member.user?.username];
  return names.some((n) => typeof n === 'string' && n.toLowerCase().includes(needle));
}

export type TagChange = 'added' | 'removed' | 'none';

/** Brings the member's role in line with their name. Idempotent, so role update events cannot loop. */
export async function applyTag(member: GuildMember, config?: TagConfig | null): Promise<TagChange> {
  if (member.user.bot) return 'none';
  const cfg = config === undefined ? await getTagConfig(member.guild.id) : config;
  if (!cfg) return 'none';
  const role = member.guild.roles.cache.get(cfg.roleId);
  if (!role || roleProblem(member.guild, role)) return 'none';

  const has = member.roles.cache.has(role.id);
  const should = wearsTag(member, cfg.text);
  try {
    if (should && !has) {
      await member.roles.add(role, `Tag system: name contains "${cfg.text}"`);
      return 'added';
    }
    if (!should && has) {
      await member.roles.remove(role, `Tag system: name no longer contains "${cfg.text}"`);
      return 'removed';
    }
  } catch (error) {
    logger.warn(`[TAG] ${member.guild.id}/${member.id}: ${errorMessage(error)}`);
  }
  return 'none';
}

const scanning = new Set<string>();

export const isScanning = (guildId: string): boolean => scanning.has(guildId);

/** Re-checks every member. Runs in the background; returns the counts when finished. */
export async function scanGuild(guild: Guild): Promise<{ added: number; removed: number; withTag: number }> {
  const config = await getTagConfig(guild.id);
  if (!config) throw new Error('The tag system is not configured.');
  if (scanning.has(guild.id)) throw new Error('A scan is already running.');
  scanning.add(guild.id);
  try {
    const members = await guild.members.fetch();
    let added = 0;
    let removed = 0;
    let withTag = 0;
    for (const member of members.values()) {
      if (member.user.bot) continue;
      const result = await applyTag(member, config);
      if (result === 'added') added++;
      if (result === 'removed') removed++;
      if (wearsTag(member, config.text)) withTag++;
    }
    return { added, removed, withTag };
  } finally {
    scanning.delete(guild.id);
  }
}

export const TAGLIST_PAGE_SIZE = 15;

/** One page of everyone wearing the tag. Returns null when the tag system is off. */
export async function buildTagList(guild: Guild, requestedPage: number): Promise<InteractionEditReplyOptions | null> {
  const config = await getTagConfig(guild.id);
  if (!config) return null;

  const wearing = [...guild.members.cache.values()]
    .filter((m) => !m.user.bot && wearsTag(m, config.text))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const pages = Math.max(1, Math.ceil(wearing.length / TAGLIST_PAGE_SIZE));
  const page = Math.min(Math.max(0, requestedPage), pages - 1);
  const slice = wearing.slice(page * TAGLIST_PAGE_SIZE, (page + 1) * TAGLIST_PAGE_SIZE);
  const missingRole = wearing.filter((m) => !m.roles.cache.has(config.roleId)).length;

  const lines = slice.map((m, i) => `\`${page * TAGLIST_PAGE_SIZE + i + 1}.\` <@${m.id}> — ${m.displayName}`);
  const embed = brand(new EmbedBuilder().setColor(COLORS.info))
    .setTitle(`Tag: ${config.text}`)
    .setDescription(lines.length ? lines.join('\n') : 'Nobody wears the tag yet.')
    .addFields(
      { name: 'Members', value: String(wearing.length), inline: true },
      { name: 'Page', value: `${page + 1}/${pages}`, inline: true },
    );
  if (missingRole > 0) embed.addFields({ name: 'Role missing', value: `${missingRole} (run /tag scan)`, inline: true });

  const card = await withCard(embed, {
    kind: 'star',
    chip: 'Tag',
    title: `${wearing.length} members wear ${config.text}`,
    text: guild.name,
    rows: [{ label: 'Page', value: `${page + 1} / ${pages}` }, ...(missingRole > 0 ? [{ label: 'Role missing', value: String(missingRole) }] : [])],
    avatarUrl: guild.iconURL({ extension: 'png', size: 128 }),
    keepEmbed: true,
  });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`taglist:nav:${page - 1}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`taglist:nav:${page + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
  );
  return { embeds: card.embeds, files: card.files, components: pages > 1 ? [row] : [], allowedMentions: { parse: [] } };
}