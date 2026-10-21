import { Router } from 'express';
import { getClient } from '../../client';
import { config } from '../../config';
import { GiveawayModel } from '../../database/models/Giveaway';
import { GuildModel } from '../../database/models/Guild';
import { WarningModel } from '../../database/models/Warning';
import { listWhitelist } from '../../protection/whitelist';
import { getGuildSettings } from '../../services/guildService';
import { MAX_PANEL_ROLES, listRolePanels } from '../../services/rolePanelService';
import { listVoiceChannels, voiceStatus } from '../../services/voiceService';
import { getRegisterConfig, registrationStats } from '../../services/registerService';
import { getTagConfig, isScanning } from '../../services/tagService';
import { getLicenseInfo } from '../../services/licenseService';
import { getProtection } from '../../services/protectionService';
import { getHealth } from '../../core/state';
import { asyncHandler, requireAuth, requireBotOwner, requireGuildAccess } from '../middleware/auth';
import { listServersFor } from '../access';
import {
  overview,
  parseCategory,
  parsePage,
  queryCases,
  queryGiveaways,
  queryLogs,
  selectableRoles,
  textChannels,
} from '../data';
import { PROTECTION_UI } from '../ui';
import { LOG_CATEGORIES } from '../../database/models/ActivityLog';

export const pagesRouter = Router();

pagesRouter.get('/', (req, res) => res.redirect(req.session.user ? '/dashboard' : '/login'));

pagesRouter.use(requireAuth);

pagesRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const client = getClient();
    const memory = process.memoryUsage();
    const mine = (await listServersFor(req.session.user!.id, req.session.guilds ?? [])).filter((g) => g.access);
    res.render('pages/dashboard', {
      title: 'Dashboard',
      active: 'dashboard',
      stats: {
        guilds: client.guilds.cache.size,
        members: client.guilds.cache.reduce((sum, g) => sum + g.memberCount, 0),
        ping: Math.round(client.ws.ping),
        uptime: Math.floor(process.uptime()),
        memoryMb: Math.round(memory.rss / 1024 / 1024),
        manageable: mine.length,
      },
      health: getHealth(),
      guilds: mine.slice(0, 6),
    });
  }),
);

pagesRouter.get(
  '/servers',
  asyncHandler(async (req, res) => {
    const guilds = await listServersFor(req.session.user!.id, req.session.guilds ?? []);
    const invite =
      'https://discord.com/oauth2/authorize?' +
      new URLSearchParams({ client_id: config.discord.clientId, scope: 'bot applications.commands', permissions: '8' }).toString();
    res.render('pages/servers', { title: 'Servers', active: 'servers', guilds, invite });
  }),
);

pagesRouter.get('/profile', (req, res) => {
  res.render('pages/profile', { title: 'Profile', active: 'profile', guildCount: req.session.guilds?.length ?? 0 });
});

pagesRouter.get('/license', requireBotOwner, (_req, res) => {
  res.render('pages/license', { title: 'License', active: 'license', license: getLicenseInfo(), health: getHealth() });
});

// ---- guild scoped pages -------------------------------------------------------------------------

const guildRouter = Router({ mergeParams: true });
pagesRouter.use('/servers/:guildId', requireGuildAccess, guildRouter);

guildRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { guild } = req.guildCtx!;
    const [protection, settings, logs, activeGiveaways, warnings, lockdown] = await Promise.all([
      getProtection(guild.id),
      getGuildSettings(guild.id),
      queryLogs(guild.id, null, 1),
      GiveawayModel.countDocuments({ guildId: guild.id, ended: false }),
      WarningModel.countDocuments({ guildId: guild.id }),
      GuildModel.findOne({ guildId: guild.id }).select('lockdown').lean(),
    ]);
    res.render('pages/guild', {
      title: guild.name,
      active: 'overview',
      info: overview(guild),
      protection,
      settings,
      recentLogs: logs.items.slice(0, 6),
      activeGiveaways,
      warnings,
      lockdown: lockdown?.lockdown ?? { active: false },
    });
  }),
);

guildRouter.get(
  '/protection',
  asyncHandler(async (req, res) => {
    const { guild } = req.guildCtx!;
    const [protection, entries] = await Promise.all([getProtection(guild.id), listWhitelist(guild.id)]);
    const whitelist = entries.map((e) => ({
      targetId: e.targetId,
      type: e.type,
      label:
        e.type === 'role'
          ? (guild.roles.cache.get(e.targetId)?.name ?? 'Unknown role')
          : (guild.members.cache.get(e.targetId)?.displayName ?? getClient().users.cache.get(e.targetId)?.username ?? 'Unknown user'),
    }));
    res.render('pages/protection', {
      title: 'Protection',
      active: 'protection',
      info: overview(guild),
      sections: PROTECTION_UI,
      protection,
      whitelist,
      roles: selectableRoles(guild),
    });
  }),
);

guildRouter.get(
  '/moderation',
  asyncHandler(async (req, res) => {
    const { guild } = req.guildCtx!;
    const page = parsePage(req.query.page);
    const [cases, settings, warnings] = await Promise.all([
      queryCases(guild.id, page),
      getGuildSettings(guild.id),
      WarningModel.countDocuments({ guildId: guild.id }),
    ]);
    res.render('pages/moderation', {
      title: 'Moderation',
      active: 'moderation',
      info: overview(guild),
      cases,
      settings,
      warnings,
      channels: textChannels(guild),
    });
  }),
);

guildRouter.get(
  '/giveaways',
  asyncHandler(async (req, res) => {
    const { guild } = req.guildCtx!;
    res.render('pages/giveaways', {
      title: 'Giveaways',
      active: 'giveaways',
      info: overview(guild),
      giveaways: await queryGiveaways(guild.id),
      channels: textChannels(guild),
    });
  }),
);

guildRouter.get(
  '/welcome',
  asyncHandler(async (req, res) => {
    const { guild } = req.guildCtx!;
    const settings = await getGuildSettings(guild.id);
    res.render('pages/welcome', {
      title: 'Welcome',
      active: 'welcome',
      info: overview(guild),
      welcome: settings.welcome ?? {},
      channels: textChannels(guild),
      roles: selectableRoles(guild),
    });
  }),
);

guildRouter.get(
  '/rolepanels',
  asyncHandler(async (req, res) => {
    const { guild } = req.guildCtx!;
    res.render('pages/rolepanels', {
      title: 'Role panels',
      active: 'rolepanels',
      info: overview(guild),
      panels: await listRolePanels(guild.id),
      channels: textChannels(guild),
      roles: selectableRoles(guild),
      maxRoles: MAX_PANEL_ROLES,
    });
  }),
);

guildRouter.get(
  '/tag',
  asyncHandler(async (req, res) => {
    const { guild } = req.guildCtx!;
    const config = await getTagConfig(guild.id);
    const role = config ? guild.roles.cache.get(config.roleId) : null;
    res.render('pages/tag', {
      title: 'Tag',
      active: 'tag',
      info: overview(guild),
      tag: config,
      wearing: role ? role.members.size : 0,
      scanning: isScanning(guild.id),
      roles: selectableRoles(guild),
    });
  }),
);

guildRouter.get(
  '/register',
  asyncHandler(async (req, res) => {
    const { guild } = req.guildCtx!;
    res.render('pages/register', {
      title: 'Register',
      active: 'register',
      info: overview(guild),
      cfg: await getRegisterConfig(guild.id),
      stats: await registrationStats(guild.id),
      channels: textChannels(guild),
      roles: selectableRoles(guild),
    });
  }),
);

guildRouter.get('/control', asyncHandler(async (req, res) => {
  const { guild } = req.guildCtx!;
  res.render('pages/control', {
    voice: await voiceStatus(guild),
    voiceChannels: listVoiceChannels(guild),
    title: 'Control',
    active: 'control',
    info: overview(guild),
    channels: textChannels(guild),
  });
}));

guildRouter.get(
  '/logs',
  asyncHandler(async (req, res) => {
    const { guild } = req.guildCtx!;
    const category = parseCategory(req.query.category);
    res.render('pages/logs', {
      title: 'Logs',
      active: 'logs',
      info: overview(guild),
      logs: await queryLogs(guild.id, category, parsePage(req.query.page)),
      category,
      categories: LOG_CATEGORIES,
    });
  }),
);
