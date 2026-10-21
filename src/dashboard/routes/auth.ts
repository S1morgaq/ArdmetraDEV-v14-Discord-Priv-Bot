import crypto from 'node:crypto';
import { PermissionFlagsBits } from 'discord.js';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { UserModel } from '../../database/models/User';
import { logger, errorMessage } from '../../utils/logger';
import { asyncHandler } from '../middleware/auth';
import type { SessionGuild, SessionUser } from '../types';

const DISCORD_API = 'https://discord.com/api/v10';

const tokenSchema = z.object({ access_token: z.string().min(1) });
const userSchema = z.object({
  id: z.string().regex(/^\d{15,25}$/),
  username: z.string(),
  global_name: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
});
const guildsSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    icon: z.string().nullable().optional(),
    owner: z.boolean().optional(),
    permissions: z.string().optional(),
  }),
);

async function discordFetch<T>(path: string, token: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(`${DISCORD_API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Discord API ${path} responded with ${response.status}`);
  return schema.parse(await response.json());
}

async function exchangeCode(code: string): Promise<string> {
  const response = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.discord.clientId,
      client_secret: config.discord.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.discord.callbackUrl,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Token exchange failed with ${response.status}`);
  return tokenSchema.parse(await response.json()).access_token;
}

/** The token is only needed once, to read identity + guild list. It is revoked right away. */
async function revokeToken(token: string): Promise<void> {
  await fetch(`${DISCORD_API}/oauth2/token/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.discord.clientId, client_secret: config.discord.clientSecret, token }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
}

function canManage(permissions: string | undefined, owner: boolean | undefined): boolean {
  if (owner) return true;
  if (!permissions) return false;
  const bits = BigInt(permissions);
  return (bits & PermissionFlagsBits.Administrator) !== 0n || (bits & PermissionFlagsBits.ManageGuild) !== 0n;
}

export const authRouter = Router();

authRouter.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('pages/login', { title: 'Login', error: typeof req.query.error === 'string' ? 'Login failed. Please try again.' : null });
});

authRouter.get('/auth/discord', (req, res) => {
  const state = crypto.randomBytes(24).toString('hex');
  req.session.oauthState = state;
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: config.discord.clientId,
    redirect_uri: config.discord.callbackUrl,
    response_type: 'code',
    scope: 'identify guilds',
    state,
    prompt: 'none',
  }).toString();
  req.session.save(() => res.redirect(url.toString()));
});

authRouter.get(
  new URL(config.discord.callbackUrl).pathname,
  asyncHandler(async (req, res) => {
    const { code, state } = req.query;
    const expected = req.session.oauthState;
    delete req.session.oauthState;

    const valid =
      typeof code === 'string' &&
      typeof state === 'string' &&
      typeof expected === 'string' &&
      state.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expected));
    if (!valid) return res.redirect('/login?error=state');

    let token: string | null = null;
    try {
      token = await exchangeCode(code);
      const profile = await discordFetch('/users/@me', token, userSchema);
      const guilds = await discordFetch('/users/@me/guilds', token, guildsSchema);

      const user: SessionUser = {
        id: profile.id,
        username: profile.username,
        globalName: profile.global_name ?? null,
        avatar: profile.avatar ?? null,
      };
      // All guilds are kept (capped) because whitelisted users do not need any Discord permission.
      const manageable: SessionGuild[] = guilds.slice(0, 200).map((g) => ({
        id: g.id,
        name: g.name,
        icon: g.icon ?? null,
        owner: g.owner ?? false,
        manage: canManage(g.permissions, g.owner),
      }));

      await UserModel.updateOne(
        { userId: user.id },
        { $set: { username: user.username, avatar: user.avatar, lastLoginAt: new Date() }, $setOnInsert: { userId: user.id } },
        { upsert: true },
      );

      // New session id after login: prevents session fixation.
      await new Promise<void>((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
      req.session.user = user;
      req.session.guilds = manageable;
      await new Promise<void>((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
      logger.info(`[DASHBOARD] ${user.username} (${user.id}) logged in.`);
      res.redirect('/dashboard');
    } catch (error) {
      logger.warn(`[DASHBOARD] OAuth login failed: ${errorMessage(error)}`);
      res.redirect('/login?error=oauth');
    } finally {
      if (token) void revokeToken(token);
    }
  }),
);

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('priv.sid');
    res.redirect('/login');
  });
});
