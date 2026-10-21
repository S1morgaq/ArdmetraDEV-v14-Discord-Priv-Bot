import { ActivityType, ChannelType, EmbedBuilder, PermissionFlagsBits, type Guild, type GuildMember } from 'discord.js';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { getClient } from '../../client';
import { config } from '../../config';
import { shutdown } from '../../core/shutdown';
import { logEvent } from '../../services/loggerService';
import { addWarning, recordCase } from '../../services/moderationService';
import { notifyModeration } from '../../services/dmService';
import { checkMemberHierarchy } from '../../utils/hierarchy';
import { errorMessage } from '../../utils/logger';
import { joinVoice, leaveVoice } from '../../services/voiceService';
import { asyncHandler, requireBotOwner } from '../middleware/auth';

const snowflake = z.string().regex(/^\d{15,25}$/, 'Invalid id');

const moderateSchema = z
  .object({
    action: z.enum(['ban', 'unban', 'kick', 'timeout', 'untimeout', 'warn']),
    userId: snowflake,
    reason: z.string().trim().max(500).optional(),
    durationMinutes: z.number().int().min(1).max(40_320).optional(),
    deleteDays: z.number().int().min(0).max(7).optional(),
  })
  .strict();

const messageSchema = z
  .object({
    channelId: snowflake,
    content: z.string().max(2000).optional(),
    title: z.string().trim().max(256).optional(),
    description: z.string().max(4000).optional(),
    color: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.content?.trim() || v.title?.trim() || v.description?.trim()), 'Write some content, a title or a description.');

const channelSchema = z
  .object({
    channelId: snowflake,
    action: z.enum(['lock', 'unlock', 'slowmode']),
    seconds: z.number().int().min(0).max(21_600).optional(),
  })
  .strict();

const voiceSchema = z
  .object({
    action: z.enum(['join', 'leave']),
    channelId: snowflake.optional(),
    selfDeaf: z.enum(['true', 'false']).optional(),
  })
  .strict();

const presenceSchema = z
  .object({
    text: z.string().trim().min(1).max(128),
    type: z.enum(['Playing', 'Watching', 'Listening', 'Competing']),
  })
  .strict();

const ACTIVITY: Record<'Playing' | 'Watching' | 'Listening' | 'Competing', ActivityType> = {
  Playing: ActivityType.Playing,
  Watching: ActivityType.Watching,
  Listening: ActivityType.Listening,
  Competing: ActivityType.Competing,
};

const MEMBER_PERMISSION = {
  ban: PermissionFlagsBits.BanMembers,
  unban: PermissionFlagsBits.BanMembers,
  kick: PermissionFlagsBits.KickMembers,
  timeout: PermissionFlagsBits.ModerateMembers,
  untimeout: PermissionFlagsBits.ModerateMembers,
  warn: PermissionFlagsBits.ModerateMembers,
} as const;

function parse<T>(schema: z.ZodType<T>, body: unknown, res: Response): T | null {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  res.status(400).json({ error: `${issue.path.join('.') || 'body'}: ${issue.message}` });
  return null;
}

export const actionsRouter = Router();

/**
 * Every action is executed *as the dashboard user*: they need the matching Discord permission and the
 * usual role hierarchy rules apply to them and to the bot, exactly like the slash commands.
 */
actionsRouter.post(
  '/moderate',
  asyncHandler(async (req, res) => {
    const body = parse(moderateSchema, req.body, res);
    if (!body) return;
    const { guild, member: moderator } = req.guildCtx!;
    const username = req.session.user!.username;
    // Bot owners run the panel as super users: Discord permissions and their own role rank do not apply to them.
    const superuser = config.dashboard.ownerIds.includes(req.session.user!.id);

    if (!superuser && !moderator.permissions.has(MEMBER_PERMISSION[body.action])) {
      res.status(403).json({ error: 'You do not have the Discord permission required for this action.' });
      return;
    }
    const me = guild.members.me;
    if (!me?.permissions.has(MEMBER_PERMISSION[body.action])) {
      res.status(400).json({ error: 'The bot lacks the required permission for this action.' });
      return;
    }

    const reason = body.reason || 'No reason provided';
    const auditReason = `${username} (dashboard): ${reason}`.slice(0, 500);
    const client = getClient();

    try {
      if (body.action === 'unban') {
        const ban = await guild.bans.fetch({ user: body.userId, force: true }).catch(() => null);
        if (!ban) {
          res.status(404).json({ error: 'That user is not banned.' });
          return;
        }
        await guild.members.unban(body.userId, auditReason);
        const caseId = await recordCase({ guild, type: 'UNBAN', userId: body.userId, moderatorId: moderator.id, reason });
        res.json({ ok: true, message: `Unbanned ${ban.user.username}. Case #${caseId}` });
        return;
      }

      const target = guild.members.cache.get(body.userId) ?? (await guild.members.fetch(body.userId).catch(() => null));
      if (target) {
        const problem = checkMemberHierarchy(guild, moderator, target, superuser);
        if (problem) {
          res.status(403).json({ error: problem });
          return;
        }
      } else if (body.action !== 'ban') {
        res.status(404).json({ error: 'That user is not in this server.' });
        return;
      } else if (body.userId === guild.ownerId || body.userId === moderator.id) {
        res.status(400).json({ error: 'You cannot ban that user.' });
        return;
      }

      const name = target?.user.username ?? body.userId;
      let message: string;
      let durationMs: number | null = null;

      switch (body.action) {
        case 'ban': {
          const user = target?.user ?? (await client.users.fetch(body.userId).catch(() => null));
          if (user) await notifyModeration(user, { guild, action: 'BAN', moderator: moderator.displayName, reason });
          await guild.members.ban(body.userId, { reason: auditReason, deleteMessageSeconds: (body.deleteDays ?? 0) * 86_400 });
          message = `Banned ${name}`;
          break;
        }
        case 'kick':
          await notifyModeration(target!.user, { guild, action: 'KICK', moderator: moderator.displayName, reason });
          await target!.kick(auditReason);
          message = `Kicked ${name}`;
          break;
        case 'timeout':
          if (!body.durationMinutes) {
            res.status(400).json({ error: 'durationMinutes is required for a timeout.' });
            return;
          }
          if (!target!.moderatable) {
            res.status(400).json({ error: 'The bot cannot time out that member (administrator or higher role).' });
            return;
          }
          durationMs = body.durationMinutes * 60_000;
          await target!.timeout(durationMs, auditReason);
          await notifyModeration(target!.user, { guild, action: 'TIMEOUT', moderator: moderator.displayName, reason, durationMs });
          message = `Timed out ${name} for ${body.durationMinutes} min`;
          break;
        case 'untimeout':
          await target!.timeout(null, auditReason);
          message = `Removed the timeout from ${name}`;
          break;
        case 'warn': {
          const total = await addWarning(guild.id, body.userId, moderator.id, reason);
          await notifyModeration(target!.user, { guild, action: 'WARN', moderator: moderator.displayName, reason, warnCount: total });
          message = `Warned ${name} (total ${total})`;
          break;
        }
      }

      const caseId = await recordCase({
        guild,
        type: body.action === 'untimeout' ? 'TIMEOUT' : (body.action.toUpperCase() as 'BAN' | 'KICK' | 'TIMEOUT' | 'WARN'),
        userId: body.userId,
        moderatorId: moderator.id,
        reason: body.action === 'untimeout' ? `Timeout removed. ${reason}` : reason,
        durationMs,
      });
      res.json({ ok: true, message: `${message}. Case #${caseId}` });
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
    }
  }),
);

function sendableChannel(guild: Guild, channelId: string, moderator: GuildMember, superuser: boolean) {
  const channel = guild.channels.cache.get(channelId);
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) return null;
  const me = guild.members.me;
  const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
  if (!me || !channel.permissionsFor(me).has([...needed, PermissionFlagsBits.EmbedLinks])) return null;
  if (!superuser && !channel.permissionsFor(moderator).has(needed)) return null;
  return channel;
}

actionsRouter.post(
  '/message',
  asyncHandler(async (req, res) => {
    const body = parse(messageSchema, req.body, res);
    if (!body) return;
    const { guild, member: moderator } = req.guildCtx!;

    const channel = sendableChannel(guild, body.channelId, moderator, config.dashboard.ownerIds.includes(req.session.user!.id));
    if (!channel) {
      res.status(400).json({ error: 'Pick a text channel where both you and the bot can send embeds.' });
      return;
    }

    const embeds: EmbedBuilder[] = [];
    if (body.title?.trim() || body.description?.trim()) {
      const embed = new EmbedBuilder().setColor(parseInt((body.color ?? '#7c5cff').replace('#', ''), 16)).setFooter({ text: `👁️ ${config.tagline}` }).setTimestamp();
      if (body.title?.trim()) embed.setTitle(body.title.trim());
      if (body.description?.trim()) embed.setDescription(body.description);
      embeds.push(embed);
    }

    try {
      // No mentions are parsed: the dashboard cannot be used to mass-ping.
      const sent = await channel.send({ content: body.content?.trim() || undefined, embeds, allowedMentions: { parse: [] } });
      await logEvent(guild, {
        category: 'GUILD',
        title: 'Message sent from the dashboard',
        executorId: moderator.id,
        fields: [{ name: 'Channel', value: `<#${channel.id}>` }, { name: 'Message', value: sent.url, inline: false }],
      });
      res.json({ ok: true, message: 'Message sent.' });
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
    }
  }),
);

actionsRouter.post(
  '/channel',
  asyncHandler(async (req, res) => {
    const body = parse(channelSchema, req.body, res);
    if (!body) return;
    const { guild, member: moderator } = req.guildCtx!;

    if (!config.dashboard.ownerIds.includes(req.session.user!.id) && !moderator.permissions.has(PermissionFlagsBits.ManageChannels)) {
      res.status(403).json({ error: 'You need the Manage Channels permission.' });
      return;
    }
    const channel = guild.channels.cache.get(body.channelId);
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
      res.status(400).json({ error: 'Pick a text channel.' });
      return;
    }
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      res.status(400).json({ error: 'The bot lacks Manage Channels.' });
      return;
    }

    const reason = `${req.session.user!.username} (dashboard)`;
    try {
      let message: string;
      if (body.action === 'slowmode') {
        if (channel.type !== ChannelType.GuildText) {
          res.status(400).json({ error: 'Slowmode only works in text channels.' });
          return;
        }
        await channel.setRateLimitPerUser(body.seconds ?? 0, reason);
        message = `Slowmode set to ${body.seconds ?? 0}s`;
      } else {
        await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: body.action === 'lock' ? false : null }, { reason });
        message = body.action === 'lock' ? 'Channel locked' : 'Channel unlocked';
      }
      await recordCase({
        guild,
        type: body.action === 'lock' ? 'LOCK' : body.action === 'unlock' ? 'UNLOCK' : 'SLOWMODE',
        moderatorId: moderator.id,
        reason: `#${channel.name} (dashboard)`,
      });
      res.json({ ok: true, message });
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
    }
  }),
);

actionsRouter.post(
  '/voice',
  asyncHandler(async (req, res) => {
    const body = parse(voiceSchema, req.body, res);
    if (!body) return;
    const { guild, trusted } = req.guildCtx!;
    if (!trusted) {
      res.status(403).json({ error: 'Only the server owner or a whitelisted user can control the bot voice connection.' });
      return;
    }
    try {
      if (body.action === 'leave') {
        const was = await leaveVoice(guild);
        res.json({ ok: true, message: was ? 'Left the voice channel.' : 'The bot was not in a voice channel.' });
        return;
      }
      if (!body.channelId) {
        res.status(400).json({ error: 'Pick a voice channel.' });
        return;
      }
      await joinVoice(guild, body.channelId, body.selfDeaf !== 'false');
      res.json({ ok: true, message: 'Joined the voice channel.' });
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
    }
  }),
);

// ---- bot level controls (bot owners only) --------------------------------------------------------

export const botRouter = Router();
botRouter.use(requireBotOwner);

botRouter.post(
  '/presence',
  asyncHandler(async (req, res) => {
    const body = parse(presenceSchema, req.body, res);
    if (!body) return;
    getClient().user?.setPresence({ activities: [{ name: body.text, type: ACTIVITY[body.type] }], status: 'online' });
    res.json({ ok: true, message: 'Status updated (resets to the default on restart).' });
  }),
);

botRouter.post('/restart', (_req, res) => {
  res.json({ ok: true, message: 'Restarting… PM2 will bring the bot back in a few seconds.' });
  // Exit code 1 -> PM2 treats it as a crash and restarts the process after the graceful shutdown.
  setTimeout(() => void shutdown('restart requested from the dashboard', 1), 500);
});
