import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getClient, hasClient } from '../../client';
import { config } from '../../config';
import { resolveAccess } from '../access';

const SNOWFLAKE = /^\d{15,25}$/;

const wantsJson = (req: Request) => req.originalUrl.startsWith('/api');

function deny(req: Request, res: Response, status: number, message: string): void {
  res.status(status);
  if (wantsJson(req)) res.json({ error: message });
  else res.render('pages/error', { code: status, message });
}

/** Step 1 — Authentication: a valid session with a Discord user. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session.user) return next();
  if (wantsJson(req)) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }
  res.redirect('/login');
}

/**
 * Steps 2-4 — User -> Guild membership -> Permission. Permissions are checked live against the
 * bot's view of the guild on every request (never trusted from the session snapshot).
 */
export const requireGuildAccess: RequestHandler = async (req, res, next) => {
  try {
    const user = req.session.user;
    const guildId = req.params.guildId;
    if (!user) return deny(req, res, 401, 'Not authenticated.');
    if (!guildId || !SNOWFLAKE.test(guildId)) return deny(req, res, 400, 'Invalid server id.');
    if (!hasClient() || !getClient().isReady()) return deny(req, res, 503, 'The bot is not connected to Discord right now.');

    const guild = getClient().guilds.cache.get(guildId);
    if (!guild) return deny(req, res, 404, 'The bot is not in that server.');

    const access = await resolveAccess(guild, user.id);
    if (!access.member) return deny(req, res, 403, 'You are not a member of that server.');
    if (!access.allowed) {
      return deny(req, res, 403, 'The dashboard is limited to administrators and whitelisted users of this server.');
    }

    req.guildCtx = { guild, member: access.member, trusted: access.trusted };
    res.locals.guildCtx = req.guildCtx;
    next();
  } catch (error) {
    next(error);
  }
};

/** Security-critical writes (protection config, whitelist, log channel) need owner / whitelist status. */
export const requireTrusted: RequestHandler = (req, res, next) => {
  if (req.guildCtx?.trusted) return next();
  deny(req, res, 403, 'Only the server owner or a whitelisted user can change this.');
};

export const requireBotOwner: RequestHandler = (req, res, next) => {
  const id = req.session.user?.id;
  if (id && config.dashboard.ownerIds.includes(id)) return next();
  deny(req, res, 403, 'Only the bot owner can view this page.');
};

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
