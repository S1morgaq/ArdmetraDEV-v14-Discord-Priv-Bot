import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Guild, type GuildMember } from 'discord.js';
import type { PrefixCommand } from '../types/handlers';
import { getHealth } from '../core/state';
import { COLORS, brand, cardReply, errEmbed, replyTemp } from '../utils/reply';

const stamp = (ms: number | null | undefined) => (ms ? `<t:${Math.floor(ms / 1000)}:D>` : 'unknown');
const plain = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString().slice(0, 10) : 'unknown');

async function resolveMember(message: Parameters<PrefixCommand['execute']>[0], args: string[]): Promise<GuildMember | null> {
  const mentioned = message.mentions.members?.first();
  if (mentioned) return mentioned;
  const id = args[0]?.replace(/\D/g, '');
  if (id && id.length >= 15) return message.guild.members.fetch(id).catch(() => null);
  return message.member;
}

const avatar: PrefixCommand = {
  name: 'avatar',
  aliases: ['av', 'pp'],
  description: "Show a user's avatar in full size",
  cooldown: 5,
  async execute(message, args) {
    const member = await resolveMember(message, args);
    if (!member) {
      await replyTemp(message, errEmbed('I could not find that member.'), true);
      return;
    }
    const url = member.displayAvatarURL({ extension: 'png', size: 1024 });
    const embed = brand(new EmbedBuilder().setColor(member.displayColor || COLORS.info).setTitle(`${member.displayName}'s avatar`).setImage(url));
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel('Open original').setStyle(ButtonStyle.Link).setURL(member.displayAvatarURL({ size: 4096 })));
    await message.reply({ embeds: [embed], components: [row] });
  },
};

const userinfo: PrefixCommand = {
  name: 'userinfo',
  aliases: ['ui', 'whois', 'kullanıcı'],
  description: 'Account and server details of a member',
  cooldown: 5,
  async execute(message, args) {
    const member = await resolveMember(message, args);
    if (!member) {
      await replyTemp(message, errEmbed('I could not find that member.'), true);
      return;
    }
    const roles = member.roles.cache.filter((r) => r.id !== member.guild.id).sort((a, b) => b.position - a.position);
    const top = roles.first();
    const rows = [
      { label: 'ID', value: member.id },
      { label: 'Created', value: plain(member.user.createdTimestamp) },
      { label: 'Joined', value: plain(member.joinedTimestamp) },
      { label: 'Top role', value: top ? top.name : 'none' },
      { label: 'Roles', value: String(roles.size) },
      { label: 'Type', value: member.user.bot ? 'Bot' : 'Human' },
    ];
    const embed = brand(new EmbedBuilder().setColor(member.displayColor || COLORS.info).setThumbnail(member.displayAvatarURL({ size: 256 })))
      .setTitle(member.displayName)
      .addFields(
        { name: 'ID', value: member.id, inline: true },
        { name: 'Created', value: stamp(member.user.createdTimestamp), inline: true },
        { name: 'Joined', value: stamp(member.joinedTimestamp), inline: true },
        { name: `Roles (${roles.size})`, value: roles.size ? [...roles.values()].slice(0, 15).map((r) => `<@&${r.id}>`).join(' ').slice(0, 1024) : 'none' },
      );
    await message.reply(
      await cardReply(embed, {
        kind: 'info',
        chip: 'User',
        title: member.user.tag === `${member.user.username}#0` ? member.user.username : member.user.tag,
        text: member.user.bot ? 'Bot account' : undefined,
        rows,
        avatarUrl: member.displayAvatarURL({ extension: 'png', size: 128 }),
        keepEmbed: true,
      }),
    );
  },
};

function serverRows(guild: Guild) {
  const channels = guild.channels.cache;
  const bots = guild.members.cache.filter((m) => m.user.bot).size;
  return [
    { label: 'Owner', value: `<@${guild.ownerId}>`, plain: guild.members.cache.get(guild.ownerId)?.displayName ?? guild.ownerId },
    { label: 'Members', value: String(guild.memberCount), plain: String(guild.memberCount) },
    { label: 'Channels', value: String(channels.size), plain: String(channels.size) },
    { label: 'Roles', value: String(guild.roles.cache.size - 1), plain: String(guild.roles.cache.size - 1) },
    { label: 'Boosts', value: `${guild.premiumSubscriptionCount ?? 0} (tier ${guild.premiumTier})`, plain: `${guild.premiumSubscriptionCount ?? 0} (tier ${guild.premiumTier})` },
    { label: 'Created', value: stamp(guild.createdTimestamp), plain: plain(guild.createdTimestamp) },
    { label: 'Cached bots', value: String(bots), plain: String(bots) },
  ];
}

const serverinfo: PrefixCommand = {
  name: 'serverinfo',
  aliases: ['si', 'sunucu'],
  description: 'Overview of this server',
  cooldown: 5,
  async execute(message) {
    const { guild } = message;
    const data = serverRows(guild);
    const embed = brand(new EmbedBuilder().setColor(COLORS.info).setTitle(guild.name).setThumbnail(guild.iconURL({ size: 256 })));
    embed.addFields(data.map((d) => ({ name: d.label, value: d.value, inline: true })));
    await message.reply(
      await cardReply(embed, {
        kind: 'star',
        chip: 'Server',
        title: guild.name,
        text: guild.description ?? undefined,
        rows: data.map((d) => ({ label: d.label, value: d.plain })),
        avatarUrl: guild.iconURL({ extension: 'png', size: 128 }),
        keepEmbed: true,
      }),
    );
  },
};

const botinfo: PrefixCommand = {
  name: 'botinfo',
  aliases: ['stats', 'bot'],
  description: 'Live statistics of the bot',
  cooldown: 5,
  async execute(message, _args, client) {
    const health = getHealth();
    const minutes = Math.floor(health.uptime / 60);
    const uptime = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
    const memory = `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`;
    const rows = [
      { label: 'Servers', value: String(client.guilds.cache.size) },
      { label: 'Users', value: String(client.guilds.cache.reduce((n, g) => n + g.memberCount, 0)) },
      { label: 'Gateway', value: `${Math.round(client.ws.ping)} ms` },
      { label: 'Uptime', value: uptime },
      { label: 'Memory', value: memory },
      { label: 'Database', value: health.database ? 'connected' : 'down' },
    ];
    const embed = brand(new EmbedBuilder().setColor(COLORS.info).setTitle('Bot statistics'));
    embed.addFields(rows.map((r) => ({ name: r.label, value: r.value, inline: true })));
    await message.reply(
      await cardReply(embed, {
        kind: 'shield',
        chip: 'Status',
        title: client.user?.username ?? 'Priv Bot',
        text: 'Watching over this server',
        rows,
        avatarUrl: client.user?.displayAvatarURL({ extension: 'png', size: 128 }),
      }),
    );
  },
};

export default [avatar, userinfo, serverinfo, botinfo];
