import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { getClient } from '../../client';
import { GuildModel } from '../../database/models/Guild';
import { addWhitelist, listWhitelist, removeWhitelist } from '../../protection/whitelist';
import { createGiveaway, deleteGiveaway } from '../../services/giveawayService';
import { getGuildSettings, invalidateGuild, setLogChannel, setTagConfig, setWelcomeField, type WelcomeField } from '../../services/guildService';
import { MAX_PANEL_ROLES, createRolePanel, deleteRolePanel, roleProblem } from '../../services/rolePanelService';
import { getTagConfig, isScanning, scanGuild } from '../../services/tagService';
import { disableRegistration, setupRegistration } from '../../services/registerService';
import { buildWelcomePayload } from '../../services/welcomeService';
import { renderWelcomeCard } from '../../utils/welcomeCard';
import { logEvent } from '../../services/loggerService';
import { getProtection, updateProtection } from '../../services/protectionService';
import { protectionPatchSchema } from '../../types/protection';
import { errorMessage } from '../../utils/logger';
import { asyncHandler, requireGuildAccess, requireTrusted } from '../middleware/auth';
import { actionsRouter, botRouter } from './actions';
import { listServersFor } from '../access';
import { overview, parseCategory, parsePage, queryCases, queryGiveaways, queryLogs, selectableRoles, textChannels } from '../data';

const snowflake = z.string().regex(/^\d{15,25}$/, 'Invalid id');

const settingsSchema = z.object({ logChannelId: snowflake.nullable() }).strict();
const giveawaySchema = z
  .object({
    channelId: snowflake,
    prize: z.string().trim().min(1).max(200),
    winnerCount: z.number().int().min(1).max(50),
    durationMinutes: z.number().int().min(1).max(129_600),
  })
  .strict();
const welcomeSchema = z
  .object({
    channelId: snowflake.nullable(),
    goodbyeChannelId: snowflake.nullable(),
    autoRoleId: snowflake.nullable(),
    message: z.string().trim().max(500).nullable(),
    goodbyeMessage: z.string().trim().max(500).nullable(),
  })
  .strict();
const giveawayDeleteSchema = z.object({ id: z.string().refine((v) => isValidObjectId(v), 'Invalid giveaway id') }).strict();
const whitelistAddSchema = z.object({ targetId: snowflake, type: z.enum(['user', 'role', 'bot']) }).strict();
const whitelistDeleteSchema = z.object({ targetId: snowflake }).strict();

export const apiRouter = Router();

// Dashboard-driven control: moderation, messages, channel tools (guild) and status / restart (bot owner).
apiRouter.use('/guilds/:guildId/actions', requireGuildAccess, actionsRouter);
apiRouter.use('/bot', botRouter);

/** Sends a 400 with the first validation problem when the body does not match. */
function parseBody<T>(schema: z.ZodType<T>, body: unknown, res: import('express').Response): T | null {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  res.status(400).json({ error: `${issue.path.join('.') || 'body'}: ${issue.message}` });
  return null;
}

apiRouter.get(
  '/guilds',
  asyncHandler(async (req, res) => {
    const client = getClient();
    const entries = await listServersFor(req.session.user!.id, req.session.guilds ?? []);
    const list = entries.filter((e) => e.access).flatMap((e) => {
      const guild = client.guilds.cache.get(e.id);
      return guild ? [overview(guild)] : [];
    });
    res.json({ guilds: list });
  }),
);

apiRouter.get('/guilds/:guildId', requireGuildAccess, (req, res) => {
  const { guild, trusted } = req.guildCtx!;
  res.json({ ...overview(guild), trusted, channels: textChannels(guild), roles: selectableRoles(guild) });
});

apiRouter.get(
  '/guilds/:guildId/protection',
  requireGuildAccess,
  asyncHandler(async (req, res) => {
    res.json({ protection: await getProtection(req.guildCtx!.guild.id) });
  }),
);

apiRouter.patch(
  '/guilds/:guildId/protection',
  requireGuildAccess,
  requireTrusted,
  asyncHandler(async (req, res) => {
    const patch = parseBody(protectionPatchSchema, req.body, res);
    if (!patch) return;
    const { guild } = req.guildCtx!;
    const next = await updateProtection(guild.id, patch);
    await logEvent(guild, {
      category: 'PROTECTION',
      title: 'Protection settings changed from the dashboard',
      executorId: req.session.user!.id,
      description: '```json\n' + JSON.stringify(patch).slice(0, 1500) + '\n```',
    });
    res.json({ protection: next });
  }),
);

apiRouter.get(
  '/guilds/:guildId/settings',
  requireGuildAccess,
  asyncHandler(async (req, res) => {
    const settings = await getGuildSettings(req.guildCtx!.guild.id);
    res.json({ logChannelId: settings.logChannelId });
  }),
);

apiRouter.patch(
  '/guilds/:guildId/settings',
  requireGuildAccess,
  requireTrusted,
  asyncHandler(async (req, res) => {
    const body = parseBody(settingsSchema, req.body, res);
    if (!body) return;
    const { guild } = req.guildCtx!;
    if (body.logChannelId && !textChannels(guild).some((c) => c.id === body.logChannelId)) {
      res.status(400).json({ error: 'That channel does not exist or is not a text channel.' });
      return;
    }
    await setLogChannel(guild.id, body.logChannelId);
    invalidateGuild(guild.id);
    res.json({ logChannelId: body.logChannelId });
  }),
);

// ---- welcome / goodbye cards --------------------------------------------------------------------

apiRouter.get(
  '/guilds/:guildId/welcome',
  requireGuildAccess,
  asyncHandler(async (req, res) => {
    const w = (await getGuildSettings(req.guildCtx!.guild.id)).welcome;
    res.json({
      channelId: w?.channelId ?? null,
      goodbyeChannelId: w?.goodbyeChannelId ?? null,
      autoRoleId: w?.autoRoleId ?? null,
      message: w?.message ?? null,
      goodbyeMessage: w?.goodbyeMessage ?? null,
    });
  }),
);

apiRouter.put(
  '/guilds/:guildId/welcome',
  requireGuildAccess,
  requireTrusted,
  asyncHandler(async (req, res) => {
    const body = parseBody(welcomeSchema, req.body, res);
    if (!body) return;
    const { guild } = req.guildCtx!;
    const channels = textChannels(guild);
    for (const id of [body.channelId, body.goodbyeChannelId]) {
      if (id && !channels.some((c) => c.id === id)) {
        res.status(400).json({ error: 'A selected channel does not exist or is not a text channel.' });
        return;
      }
    }
    if (body.autoRoleId) {
      const role = guild.roles.cache.get(body.autoRoleId);
      const me = guild.members.me;
      if (!role || role.managed || role.id === guild.id) {
        res.status(400).json({ error: 'That role cannot be used as an auto role.' });
        return;
      }
      if (!me?.permissions.has('ManageRoles') || role.position >= me.roles.highest.position) {
        res.status(400).json({ error: 'The bot cannot assign that role (it is above the bot or Manage Roles is missing).' });
        return;
      }
    }
    const fields: WelcomeField[] = ['channelId', 'goodbyeChannelId', 'autoRoleId', 'message', 'goodbyeMessage'];
    for (const field of fields) await setWelcomeField(guild.id, field, body[field] || null);
    await logEvent(guild, { category: 'GUILD', title: 'Welcome settings changed from the dashboard', executorId: req.session.user!.id });
    res.json({ ok: true });
  }),
);

/** Animated preview using the viewer's own avatar. */
apiRouter.get(
  '/guilds/:guildId/welcome/preview',
  requireGuildAccess,
  asyncHandler(async (req, res) => {
    const { guild, member } = req.guildCtx!;
    const card = await renderWelcomeCard({
      mode: req.query.mode === 'goodbye' ? 'goodbye' : 'welcome',
      name: member.displayName,
      server: guild.name,
      count: guild.memberCount,
      avatarUrl: member.displayAvatarURL({ extension: 'png', size: 256 }),
    });
    if (!card) {
      res.status(503).json({ error: 'The renderer is busy, try again in a moment.' });
      return;
    }
    res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'private, no-store' }).send(card.attachment);
  }),
);

apiRouter.post(
  '/guilds/:guildId/welcome/test',
  requireGuildAccess,
  requireTrusted,
  asyncHandler(async (req, res) => {
    const { guild, member } = req.guildCtx!;
    const w = (await getGuildSettings(guild.id)).welcome;
    const channel = w?.channelId ? guild.channels.cache.get(w.channelId) : null;
    if (!channel || !('send' in channel)) {
      res.status(400).json({ error: 'Save a welcome channel first.' });
      return;
    }
    try {
      await channel.send(await buildWelcomePayload('welcome', member, w?.message));
      res.json({ ok: true, message: 'Test card sent.' });
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
    }
  }),
);

// ---- registration ------------------------------------------------------------------------------------

const registerSchema = z
  .object({
    channelId: snowflake,
    chatChannelId: snowflake.nullable(),
    maleRoleId: snowflake,
    femaleRoleId: snowflake,
    unregisteredRoleId: snowflake.nullable(),
  })
  .strict();

apiRouter.put(
  '/guilds/:guildId/register',
  requireGuildAccess,
  requireTrusted,
  asyncHandler(async (req, res) => {
    const body = parseBody(registerSchema, req.body, res);
    if (!body) return;
    const { guild } = req.guildCtx!;
    try {
      await setupRegistration(guild, body);
      await logEvent(guild, { category: 'GUILD', title: 'Registration panel posted from the dashboard', executorId: req.session.user!.id });
      res.json({ ok: true, message: 'Panel posted and settings saved.' });
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
    }
  }),
);

apiRouter.delete(
  '/guilds/:guildId/register',
  requireGuildAccess,
  requireTrusted,
  asyncHandler(async (req, res) => {
    await disableRegistration(req.guildCtx!.guild);
    res.json({ ok: true, message: 'Registration turned off.' });
  }),
);

// ---- tag system ---------------------------------------------------------------------------------

const tagSchema = z.object({ text: z.string().trim().min(1).max(16).nullable(), roleId: snowflake.nullable() }).strict();

apiRouter.put(
  '/guilds/:guildId/tag',
  requireGuildAccess,
  requireTrusted,
  asyncHandler(async (req, res) => {
    const body = parseBody(tagSchema, req.body, res);
    if (!body) return;
    const { guild } = req.guildCtx!;
    if (!body.text || !body.roleId) {
      await setTagConfig(guild.id, null, null);
      res.json({ ok: true, message: 'Tag system turned off.' });
      return;
    }
    const role = guild.roles.cache.get(body.roleId);
    const problem = role ? roleProblem(guild, role) : 'That role does not exist.';
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }
    await setTagConfig(guild.id, body.text, body.roleId);
    await logEvent(guild, { category: 'GUILD', title: 'Tag system configured from the dashboard', executorId: req.session.user!.id, description: `Tag \`${body.text}\`` });
    res.json({ ok: true, message: 'Tag settings saved.' });
  }),
);

apiRouter.post(
  '/guilds/:guildId/tag/scan',
  requireGuildAccess,
  requireTrusted,
  asyncHandler(async (req, res) => {
    const { guild } = req.guildCtx!;
    if (!(await getTagConfig(guild.id))) {
      res.status(400).json({ error: 'Save the tag settings first.' });
      return;
    }
    if (isScanning(guild.id)) {
      res.status(409).json({ error: 'A scan is already running.' });
      return;
    }
    // Runs in the background; the result lands in the log channel.
    void scanGuild(guild)
      .then((r) => logEvent(guild, { category: 'GUILD', title: 'Tag scan finished', executorId: req.session.user!.id, description: `${r.withTag} members wear the tag. Roles added: ${r.added}, removed: ${r.removed}.` }))
      .catch(() => undefined);
    res.json({ ok: true, message: 'Scan started. The result is posted to the log channel.' });
  }),
);

// ---- button role panels -------------------------------------------------------------------------

const rolePanelSchema = z
  .object({
    channelId: snowflake,
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).default(''),
    roleIds: z.array(snowflake).min(1).max(MAX_PANEL_ROLES),
  })
  .strict();

apiRouter.post(
  '/guilds/:guildId/rolepanels',
  requireGuildAccess,
  requireTrusted,
  asyncHandler(async (req, res) => {
    const body = parseBody(rolePanelSchema, req.body, res);
    if (!body) return;
    const { guild } = req.guildCtx!;
    try {
      const panel = await createRolePanel({ guild, ...body, description: body.description ?? '', createdBy: req.session.user!.id });
      await logEvent(guild, { category: 'GUILD', title: 'Role panel created from the dashboard', executorId: req.session.user!.id, description: panel.title });
      res.json({ ok: true, message: 'Panel posted.' });
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
    }
  }),
);

apiRouter.delete(
  '/guilds/:guildId/rolepanels/:messageId',
  requireGuildAccess,
  requireTrusted,
  asyncHandler(async (req, res) => {
    const removed = await deleteRolePanel(req.guildCtx!.guild, String(req.params.messageId));
    if (!removed) {
      res.status(404).json({ error: 'Panel not found.' });
      return;
    }
    res.json({ ok: true });
  }),
);

apiRouter.get(
  '/guilds/:guildId/logs',
  requireGuildAccess,
  asyncHandler(async (req, res) => {
    res.json(await queryLogs(req.guildCtx!.guild.id, parseCategory(req.query.category), parsePage(req.query.page)));
  }),
);

apiRouter.get(
  '/guilds/:guildId/moderation',
  requireGuildAccess,
  asyncHandler(async (req, res) => {
    res.json(await queryCases(req.guildCtx!.guild.id, parsePage(req.query.page)));
  }),
);

apiRouter.get(
  '/guilds/:guildId/giveaways',
  requireGuildAccess,
  asyncHandler(async (req, res) => {
    const list = await queryGiveaways(req.guildCtx!.guild.id);
    res.json({
      giveaways: list.map((g) => ({
        id: String(g._id),
        prize: g.prize,
        channelId: g.channelId,
        messageId: g.messageId,
        winnerCount: g.winnerCount,
        participants: g.participants.length,
        endsAt: g.endsAt,
        ended: g.ended,
        winners: g.winners,
      })),
    });
  }),
);

apiRouter.post(
  '/guilds/:guildId/giveaways',
  requireGuildAccess,
  asyncHandler(async (req, res) => {
    const body = parseBody(giveawaySchema, req.body, res);
    if (!body) return;
    const { guild } = req.guildCtx!;
    try {
      const created = await createGiveaway({
        guild,
        channelId: body.channelId,
        hostId: req.session.user!.id,
        prize: body.prize,
        winnerCount: body.winnerCount,
        durationMs: body.durationMinutes * 60_000,
      });
      res.status(201).json({ id: String(created._id) });
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
    }
  }),
);

apiRouter.delete(
  '/guilds/:guildId/giveaways',
  requireGuildAccess,
  asyncHandler(async (req, res) => {
    const body = parseBody(giveawayDeleteSchema, req.body, res);
    if (!body) return;
    const removed = await deleteGiveaway(getClient(), req.guildCtx!.guild.id, body.id);
    if (!removed) {
      res.status(404).json({ error: 'Giveaway not found.' });
      return;
    }
    res.json({ ok: true });
  }),
);

apiRouter.get(
  '/guilds/:guildId/whitelist',
  requireGuildAccess,
  asyncHandler(async (req, res) => {
    res.json({ entries: await listWhitelist(req.guildCtx!.guild.id) });
  }),
);

apiRouter.post(
  '/guilds/:guildId/whitelist',
  requireGuildAccess,
  requireTrusted,
  asyncHandler(async (req, res) => {
    const body = parseBody(whitelistAddSchema, req.body, res);
    if (!body) return;
    const { guild } = req.guildCtx!;

    let type = body.type;
    if (type === 'role') {
      if (!guild.roles.cache.has(body.targetId)) {
        res.status(400).json({ error: 'That role does not exist in this server.' });
        return;
      }
    } else {
      const user = await getClient().users.fetch(body.targetId).catch(() => null);
      if (!user) {
        res.status(400).json({ error: 'No Discord user with that id.' });
        return;
      }
      type = user.bot ? 'bot' : 'user'; // never trust the client-supplied type for accounts
    }

    await addWhitelist(guild.id, body.targetId, type, req.session.user!.id);
    await logEvent(guild, {
      category: 'PROTECTION',
      title: 'Whitelist entry added from the dashboard',
      executorId: req.session.user!.id,
      targetId: body.targetId,
      fields: [{ name: 'Type', value: type }],
    });
    res.status(201).json({ ok: true, type });
  }),
);

apiRouter.delete(
  '/guilds/:guildId/whitelist',
  requireGuildAccess,
  requireTrusted,
  asyncHandler(async (req, res) => {
    const body = parseBody(whitelistDeleteSchema, req.body, res);
    if (!body) return;
    const { guild } = req.guildCtx!;
    const removed = await removeWhitelist(guild.id, body.targetId);
    if (!removed) {
      res.status(404).json({ error: 'Entry not found.' });
      return;
    }
    await logEvent(guild, {
      category: 'PROTECTION',
      title: 'Whitelist entry removed from the dashboard',
      executorId: req.session.user!.id,
      targetId: body.targetId,
    });
    res.json({ ok: true });
  }),
);

/** Lightweight lockdown info for the overview page. */
apiRouter.get(
  '/guilds/:guildId/lockdown',
  requireGuildAccess,
  asyncHandler(async (req, res) => {
    const doc = await GuildModel.findOne({ guildId: req.guildCtx!.guild.id }).select('lockdown').lean();
    res.json({ lockdown: doc?.lockdown ?? { active: false } });
  }),
);
