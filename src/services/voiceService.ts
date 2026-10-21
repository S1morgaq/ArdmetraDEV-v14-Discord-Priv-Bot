import { ChannelType, PermissionFlagsBits, type Client, type Guild } from 'discord.js';
import { GuildModel } from '../database/models/Guild';
import { invalidateGuild } from './guildService';
import { errorMessage, logger } from '../utils/logger';

type VoiceLib = typeof import('@discordjs/voice');

/** Loaded lazily so a machine without a working voice stack can still run everything else. */
async function loadVoice(): Promise<VoiceLib> {
  try {
    return await import('@discordjs/voice');
  } catch (error) {
    logger.warn(`[VOICE] @discordjs/voice could not be loaded: ${errorMessage(error)}`);
    throw new Error('Voice support is not available on this machine (run npm install; Node 22+ is recommended for voice).');
  }
}

async function saveVoice(guildId: string, channelId: string | null, selfDeaf: boolean): Promise<void> {
  await GuildModel.updateOne({ guildId }, { $set: { 'voice.channelId': channelId, 'voice.selfDeaf': selfDeaf } }, { upsert: true });
  invalidateGuild(guildId);
}

export interface VoiceStatus {
  channelId: string | null;
  channelName: string | null;
}

export async function voiceStatus(guild: Guild): Promise<VoiceStatus> {
  let channelId: string | null = null;
  try {
    channelId = (await loadVoice()).getVoiceConnection(guild.id)?.joinConfig.channelId ?? null;
  } catch {
    // voice unavailable: reported as "not connected"
  }
  return { channelId, channelName: channelId ? (guild.channels.cache.get(channelId)?.name ?? null) : null };
}

export function listVoiceChannels(guild: Guild): { id: string; name: string }[] {
  return guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildVoice)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((c) => ({ id: c.id, name: c.name }));
}

/** Joins (or moves to) a voice channel and stays there. The choice is stored so it survives restarts. */
export async function joinVoice(guild: Guild, channelId: string, selfDeaf: boolean, persist = true): Promise<void> {
  const voice = await loadVoice();
  const channel = guild.channels.cache.get(channelId);
  if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error('Pick a voice channel.');
  const me = guild.members.me;
  if (!me || !channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])) {
    throw new Error('The bot needs View Channel and Connect in that voice channel.');
  }

  voice.getVoiceConnection(guild.id)?.destroy();
  const connection = voice.joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf,
    selfMute: false,
  });

  connection.on(voice.VoiceConnectionStatus.Disconnected, () => {
    void (async () => {
      try {
        // Moved to another channel or a short network hiccup: Discord reconnects by itself.
        await Promise.race([
          voice.entersState(connection, voice.VoiceConnectionStatus.Signalling, 5_000),
          voice.entersState(connection, voice.VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        // Disconnected for real (kicked out of the channel): do not fight the moderators.
        if (connection.state.status !== voice.VoiceConnectionStatus.Destroyed) connection.destroy();
        await saveVoice(guild.id, null, selfDeaf).catch(() => undefined);
      }
    })();
  });

  try {
    await voice.entersState(connection, voice.VoiceConnectionStatus.Ready, 20_000);
  } catch {
    if (connection.state.status !== voice.VoiceConnectionStatus.Destroyed) connection.destroy();
    throw new Error('Could not connect to the voice channel in time. Check the bot permissions and try again.');
  }
  if (persist) await saveVoice(guild.id, channel.id, selfDeaf);
  logger.info(`[VOICE] Joined #${channel.name} in ${guild.id}.`);
}

export async function leaveVoice(guild: Guild): Promise<boolean> {
  let was = false;
  try {
    const connection = (await loadVoice()).getVoiceConnection(guild.id);
    if (connection) {
      connection.destroy();
      was = true;
    }
  } catch {
    // nothing to leave
  }
  await saveVoice(guild.id, null, false);
  return was;
}

/** Rejoins the channels that were active before a restart. */
export async function restoreVoice(client: Client): Promise<void> {
  const docs = await GuildModel.find({ 'voice.channelId': { $ne: null } }).select('guildId voice').lean<{ guildId: string; voice: { channelId: string; selfDeaf: boolean } }[]>();
  for (const doc of docs) {
    const guild = client.guilds.cache.get(doc.guildId);
    if (!guild) continue;
    await joinVoice(guild, doc.voice.channelId, doc.voice.selfDeaf, false).catch((error: unknown) =>
      logger.warn(`[VOICE] Could not rejoin ${doc.guildId}: ${errorMessage(error)}`),
    );
  }
}
