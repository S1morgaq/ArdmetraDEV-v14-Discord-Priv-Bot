import { PermissionFlagsBits, type Guild, type GuildMember } from 'discord.js';
import { getClient } from '../client';
import { isTrusted } from '../protection/whitelist';
import { iconUrl } from './data';
import type { SessionGuild } from './types';

export interface AccessResult {
  /** May open the dashboard for this guild. */
  allowed: boolean;
  /** Owner or whitelisted: may also change security-critical settings. */
  trusted: boolean;
  member: GuildMember | null;
}

/**
 * Dashboard access rule (evaluated live against the bot's view of the guild, never from the session):
 *   guild owner  OR  whitelisted user / whitelisted role  OR  member with the Administrator permission.
 * Having only "Manage Server" is deliberately not enough.
 * Bot owners (BOT_OWNER_IDS) may open the dashboard of every server the bot is in, even without owning it.
 */
export async function resolveAccess(guild: Guild, userId: string): Promise<AccessResult> {
  const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
  if (!member) return { allowed: false, trusted: false, member: null };
  const trusted = await isTrusted(guild, userId);
  const allowed = trusted || member.permissions.has(PermissionFlagsBits.Administrator);
  return { allowed, trusted, member };
}

export interface ServerListEntry {
  id: string;
  name: string;
  iconUrl: string | null;
  owner: boolean;
  botIn: boolean;
  /** The user may open the dashboard for this server. */
  access: boolean;
  /** The user could add the bot themselves (Manage Server / Administrator in a server without the bot). */
  canInvite: boolean;
}

/** Builds the server list of a user from the guilds captured at login, re-checking access live. */
export async function listServersFor(userId: string, sessionGuilds: SessionGuild[]): Promise<ServerListEntry[]> {
  const client = getClient();
  const entries = await Promise.all(
    sessionGuilds.map(async (g): Promise<ServerListEntry> => {
      const guild = client.guilds.cache.get(g.id);
      const access = guild ? (await resolveAccess(guild, userId)).allowed : false;
      return {
        id: g.id,
        name: g.name,
        iconUrl: iconUrl(g),
        owner: g.owner,
        botIn: guild !== undefined,
        access,
        canInvite: !guild && g.manage,
      };
    }),
  );
  // Servers the user cannot do anything with are not listed at all.
  return entries.filter((e) => e.access || e.canInvite).sort((a, b) => Number(b.access) - Number(a.access) || a.name.localeCompare(b.name));
}
