import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type Message,
  type TextChannel,
} from 'discord.js';
import { RegistrationModel, type Gender } from '../database/models/Registration';
import { getGuildSettings, setRegisterConfig, type RegisterConfig } from './guildService';
import { logEvent } from './loggerService';
import { roleProblem } from './rolePanelService';
import { withCard } from '../utils/card';
import { TtlCache } from '../utils/cache';
import { errorMessage, logger } from '../utils/logger';
import { COLORS, brand } from '../utils/reply';

export const GREETING_DELETE_MS = 5_000;
export const ANNOUNCE_DELETE_MS = 10_000;

const LABEL: Record<Gender, string> = { male: 'Erkek', female: 'Kız' };

export async function getRegisterConfig(guildId: string): Promise<RegisterConfig | null> {
  const r = (await getGuildSettings(guildId)).register;
  if (!r?.channelId || !r.maleRoleId || !r.femaleRoleId) return null;
  return {
    channelId: r.channelId,
    chatChannelId: r.chatChannelId ?? null,
    maleRoleId: r.maleRoleId,
    femaleRoleId: r.femaleRoleId,
    unregisteredRoleId: r.unregisteredRoleId ?? null,
    panelMessageId: r.panelMessageId ?? null,
  };
}

function textChannel(guild: Guild, id: string | null): TextChannel | null {
  if (!id) return null;
  const channel = guild.channels.cache.get(id);
  return channel?.type === ChannelType.GuildText ? channel : null;
}

function deleteLater(message: Message, ms: number): void {
  setTimeout(() => void message.delete().catch(() => undefined), ms).unref();
}

// ---- panel -----------------------------------------------------------------------------------------

async function postPanel(guild: Guild, cfg: RegisterConfig): Promise<string> {
  const channel = textChannel(guild, cfg.channelId);
  if (!channel) throw new Error('Pick a text channel for the registration panel.');
  const me = guild.members.me;
  if (!me || !channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles])) {
    throw new Error('The bot needs View Channel, Send Messages, Embed Links and Attach Files in the registration channel.');
  }

  const title = `${guild.name} Kayıt`;
  const text = 'Aşağıdaki butonlardan cinsiyetini seç ve kayıt ol. Kayıt olunca sunucunun tüm kanallarını görebilirsin!';
  const embed = brand(new EmbedBuilder().setColor(COLORS.info)).setTitle(title).setDescription(text);
  const card = await withCard(embed, { kind: 'star', chip: 'Kayıt', title, text, avatarUrl: guild.iconURL({ extension: 'png', size: 128 }) });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('register:pick:male').setLabel('Erkek').setEmoji('♂️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('register:pick:female').setLabel('Kız').setEmoji('♀️').setStyle(ButtonStyle.Danger),
  );
  const message = await channel.send({ embeds: card.embeds, files: card.files, components: [row], allowedMentions: { parse: [] } });
  return message.id;
}

async function removeOldPanel(guild: Guild, cfg: RegisterConfig | null): Promise<void> {
  if (!cfg?.panelMessageId) return;
  await textChannel(guild, cfg.channelId)?.messages.delete(cfg.panelMessageId).catch(() => undefined);
}

export interface RegisterInput {
  channelId: string;
  chatChannelId: string | null;
  maleRoleId: string;
  femaleRoleId: string;
  unregisteredRoleId: string | null;
}

/** Validates everything, replaces the old panel with a fresh one and stores the configuration. */
export async function setupRegistration(guild: Guild, input: RegisterInput): Promise<RegisterConfig> {
  if (input.maleRoleId === input.femaleRoleId) throw new Error('The male and female roles must be different.');
  for (const id of [input.maleRoleId, input.femaleRoleId, input.unregisteredRoleId]) {
    if (!id) continue;
    const role = guild.roles.cache.get(id);
    if (!role) throw new Error('One of the selected roles no longer exists.');
    const problem = roleProblem(guild, role);
    if (problem) throw new Error(problem);
  }
  if (input.chatChannelId && !textChannel(guild, input.chatChannelId)) throw new Error('The chat channel must be a text channel.');

  const previous = await getRegisterConfig(guild.id);
  const cfg: RegisterConfig = { ...input, panelMessageId: null };
  cfg.panelMessageId = await postPanel(guild, cfg);
  await removeOldPanel(guild, previous);
  await setRegisterConfig(guild.id, cfg);
  return cfg;
}

export async function disableRegistration(guild: Guild): Promise<void> {
  await removeOldPanel(guild, await getRegisterConfig(guild.id));
  await setRegisterConfig(guild.id, null);
}

export async function registrationStats(guildId: string): Promise<{ male: number; female: number }> {
  const [male, female] = await Promise.all([
    RegistrationModel.countDocuments({ guildId, gender: 'male' }),
    RegistrationModel.countDocuments({ guildId, gender: 'female' }),
  ]);
  return { male, female };
}

// ---- registering -----------------------------------------------------------------------------------

export type RegisterResult = { status: 'ok'; gender: Gender } | { status: 'error'; message: string };

export async function registerMember(member: GuildMember, gender: Gender): Promise<RegisterResult> {
  const { guild } = member;
  const cfg = await getRegisterConfig(guild.id);
  if (!cfg) return { status: 'error', message: 'Kayıt sistemi şu an kapalı.' };
  if (member.user.bot) return { status: 'error', message: 'Botlar kayıt olamaz.' };
  if (member.roles.cache.has(cfg.maleRoleId) || member.roles.cache.has(cfg.femaleRoleId) || (await RegistrationModel.exists({ guildId: guild.id, userId: member.id }))) {
    return { status: 'error', message: 'Zaten kayıtlısın.' };
  }

  const roleId = gender === 'male' ? cfg.maleRoleId : cfg.femaleRoleId;
  const role = guild.roles.cache.get(roleId);
  const problem = role ? roleProblem(guild, role) : 'Kayıt rolü bulunamadı.';
  if (!role || problem) return { status: 'error', message: 'Kayıt rolü verilemiyor, bir yetkiliye haber ver.' };

  try {
    await member.roles.add(role, 'Registration');
    if (cfg.unregisteredRoleId && member.roles.cache.has(cfg.unregisteredRoleId)) {
      await member.roles.remove(cfg.unregisteredRoleId, 'Registration').catch(() => undefined);
    }
  } catch (error) {
    logger.warn(`[REGISTER] ${guild.id}/${member.id}: ${errorMessage(error)}`);
    return { status: 'error', message: 'Rol verilemedi, bir yetkiliye haber ver.' };
  }
  await RegistrationModel.updateOne({ guildId: guild.id, userId: member.id }, { $set: { gender } }, { upsert: true });

  // Public "joined us" message in the chat channel; it removes itself after 10 seconds.
  const chat = textChannel(guild, cfg.chatChannelId) ?? textChannel(guild, cfg.channelId);
  if (chat) {
    const sent = await chat
      .send({ content: `<@${member.id}> kişisi aramıza katıldı! 🎉`, allowedMentions: { users: [member.id] } })
      .catch(() => null);
    if (sent) deleteLater(sent, ANNOUNCE_DELETE_MS);
  }
  await logEvent(guild, { category: 'GUILD', title: `Registered as ${LABEL[gender]}`, targetId: member.id }).catch(() => undefined);
  return { status: 'ok', gender };
}

// ---- greeting --------------------------------------------------------------------------------------

const greeted = new TtlCache<string, true>({ ttlMs: 30_000, max: 5000 });

/** Lower-cases, drops accents / punctuation and collapses repeated letters: "S.A", "saaa" -> "sa". */
function normalize(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .replace(/(.)\1+/g, '$1');
}

const RELIGIOUS = new Set(['sa', 'sea', 'selamunaleykum', 'selamunaleikum', 'eselamunaleykum', 'eselamunaleikum', 'selamualeykum', 'eselamualeykum']);
const CASUAL = new Set(['selam', 'slm', 'merhaba', 'mrb']);

/**
 * Answers "sa" & co. in every channel it can write in (no setup needed). One answer per user every 30 seconds,
 * and the bot's reply removes itself after 5 seconds.
 */
export async function handleGreeting(message: Message): Promise<void> {
  if (message.author.bot || !message.inGuild() || message.content.length > 40) return;
  const word = normalize(message.content);
  const reply = RELIGIOUS.has(word) ? 'Aleyküm selam hoşgeldin yavrum! 💜' : CASUAL.has(word) ? 'Selam hoşgeldin yavrum! 💜' : null;
  if (!reply) return;

  const key = `${message.guildId}:${message.author.id}`;
  if (greeted.has(key)) return;
  greeted.set(key, true);

  const sent = await message.reply({ content: reply, allowedMentions: { repliedUser: false } }).catch(() => null);
  if (sent) deleteLater(sent, GREETING_DELETE_MS);
}
