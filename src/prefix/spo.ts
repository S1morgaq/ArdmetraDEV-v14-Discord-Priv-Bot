import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  type Activity,
  type GuildMember,
} from 'discord.js';
import type { PrefixCommand } from '../types/handlers';
import { renderSpotifyCard } from '../utils/spotifyCard';
import { startLive } from '../utils/live';
import { errEmbed, replyTemp } from '../utils/reply';

function findSpotify(member: GuildMember): Activity | null {
  return member.presence?.activities.find((a) => a.type === ActivityType.Listening && a.name === 'Spotify') ?? null;
}

function cardData(member: GuildMember, activity: Activity) {
  const start = activity.timestamps?.start?.getTime() ?? Date.now();
  const end = activity.timestamps?.end?.getTime() ?? start;
  const total = Math.max(1, end - start);
  return {
    title: activity.details ?? 'Unknown track',
    artists: (activity.state ?? 'Unknown artist').split(';').map((s) => s.trim()).join(', '),
    album: activity.assets?.largeText ?? 'Single',
    coverUrl: activity.assets?.largeImageURL({ extension: 'png' }) ?? null,
    elapsedMs: Math.min(total, Math.max(0, Date.now() - start)),
    totalMs: total,
    listener: member.displayName,
  };
}

function buildRow(activity: Activity): ActionRowBuilder<ButtonBuilder>[] {
  if (!activity.syncId) return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Spotify Ayrıntıları')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://open.spotify.com/track/${activity.syncId}`),
    ),
  ];
}

/**
 * The reply is just the image card + a button (no embed box). The card is re-rendered every 10 seconds
 * for two minutes so the progress bar keeps moving; the equaliser and the bar sheen are animated inside the GIF.
 */
const command: PrefixCommand = {
  name: 'spo',
  aliases: ['spotify'],
  description: 'Show the Spotify track you (or a mentioned user) are listening to',
  cooldown: 5,
  async execute(message) {
    const member = message.mentions.members?.first() ?? message.member;
    if (!member) return;

    const activity = findSpotify(member);
    if (!activity) {
      await replyTemp(
        message,
        errEmbed(`**${member.displayName}** is not listening to Spotify right now (or the Spotify status is hidden).`),
        true,
      );
      return;
    }

    const card = await renderSpotifyCard(cardData(member, activity));
    if (!card) {
      await replyTemp(message, errEmbed('The card renderer is busy, try again in a moment.'));
      return;
    }
    const reply = await message.reply({ files: [card], components: buildRow(activity) });

    const trackId = activity.syncId;
    startLive({
      intervalMs: 10_000,
      maxTicks: 12,
      tick: async () => {
        const current = message.guild.members.cache.get(member.id);
        const now = current ? findSpotify(current) : null;
        if (!current || !now || now.syncId !== trackId) {
          await reply.edit({ components: [] }).catch(() => undefined);
          return false;
        }
        const next = await renderSpotifyCard(cardData(current, now));
        if (next) await reply.edit({ files: [next], attachments: [] });
        return true;
      },
    });
  },
};

export default command;
