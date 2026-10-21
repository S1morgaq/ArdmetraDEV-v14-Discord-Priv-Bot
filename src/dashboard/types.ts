import type { Guild, GuildMember } from 'discord.js';

export interface SessionUser {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
}

export interface SessionGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  /** Had Manage Server / Administrator at login: only used to offer the "invite bot" button. */
  manage: boolean;
}

declare module 'express-session' {
  interface SessionData {
    user?: SessionUser;
    /** Guilds the user is in (captured at login). Access to each one is still re-checked live on every request. */
    guilds?: SessionGuild[];
    oauthState?: string;
    csrf?: string;
  }
}

export interface GuildContext {
  guild: Guild;
  member: GuildMember;
  /** Owner or whitelisted: allowed to change security-critical settings. */
  trusted: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      guildCtx?: GuildContext;
    }
  }
}
