import { ChannelType, PermissionFlagsBits, type Guild, type GuildMember, type PartialGuildMember, type MessageCreateOptions } from 'discord.js';
import { getGuildSettings } from './guildService';
import { renderWelcomeCard } from '../utils/welcomeCard';
import { errorMessage, logger } from '../utils/logger';

function textChannel(guild: Guild, id: string) {
  const channel = guild.channels.cache.get(id);
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) return null;
  const me = guild.members.me;
  if (!me || !channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles])) return null;
  return channel;
}

export const DEFAULT_WELCOME = 'Welcome {user} to **{server}**! You are member #{count}.';
export const DEFAULT_GOODBYE = '**{name}** left **{server}**. We are now {count} members.';

export function fillTemplate(template: string, member: GuildMember | PartialGuildMember): string {
  return template
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{name}', member.displayName ?? member.user?.username ?? 'member')
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{count}', String(member.guild.memberCount));
}

export async function buildWelcomePayload(
  mode: 'welcome' | 'goodbye',
  member: GuildMember | PartialGuildMember,
  template?: string | null,
): Promise<MessageCreateOptions> {
  const text = fillTemplate(template ?? (mode === 'welcome' ? DEFAULT_WELCOME : DEFAULT_GOODBYE), member);
  const card = await renderWelcomeCard({
    mode,
    name: member.displayName ?? member.user?.username ?? 'Member',
    server: member.guild.name,
    count: member.guild.memberCount,
    avatarUrl: member.displayAvatarURL({ extension: 'png', size: 256 }),
  });
  return {
    content: text.slice(0, 1900),
    files: card ? [card] : [],
    allowedMentions: { users: mode === 'welcome' ? [member.id] : [], parse: [] },
  };
}

/** Sends the welcome card and hands out the auto role. Never throws: a broken welcome must not affect protection. */
export async function handleWelcome(member: GuildMember): Promise<void> {
  if (member.user.bot) return;
  try {
    const settings = (await getGuildSettings(member.guild.id)).welcome;
    if (!settings) return;

    const me = member.guild.members.me;
    if (settings.autoRoleId && me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      const role = member.guild.roles.cache.get(settings.autoRoleId);
      if (role && !role.managed && role.position < me.roles.highest.position) {
        await member.roles.add(role, 'Auto role on join').catch((e) => logger.warn(`[WELCOME] Auto role failed: ${errorMessage(e)}`));
      }
    }

    if (!settings.channelId) return;
    const channel = textChannel(member.guild, settings.channelId);
    if (!channel) return;
    await channel.send(await buildWelcomePayload('welcome', member, settings.message));
  } catch (error) {
    logger.warn(`[WELCOME] ${errorMessage(error)}`);
  }
}

export async function handleGoodbye(member: GuildMember | PartialGuildMember): Promise<void> {
  if (member.user?.bot) return;
  try {
    const settings = (await getGuildSettings(member.guild.id)).welcome;
    if (!settings?.goodbyeChannelId) return;
    const channel = textChannel(member.guild, settings.goodbyeChannelId);
    if (!channel) return;
    await channel.send(await buildWelcomePayload('goodbye', member, settings.goodbyeMessage));
  } catch (error) {
    logger.warn(`[WELCOME] ${errorMessage(error)}`);
  }
}
