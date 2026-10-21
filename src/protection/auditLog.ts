import { AuditLogEvent, PermissionFlagsBits, type Guild, type GuildAuditLogsEntry } from 'discord.js';
import { TtlCache } from '../utils/cache';
import { logger, errorMessage } from '../utils/logger';

export type AuditEntry = GuildAuditLogsEntry;

/** Discord writes the audit entry slightly after the gateway event: retry a few times, then give up. */
const RETRY_DELAYS_MS = [100, 250, 500];
const FIRST_FETCH_MAX_AGE_MS = 300;
const RETRY_FETCH_MAX_AGE_MS = 80;
const DEFAULT_ENTRY_MAX_AGE_MS = 15_000;

interface Snapshot {
  at: number;
  promise: Promise<AuditEntry[]>;
}

const snapshots = new TtlCache<string, Snapshot>({ ttlMs: 2000, max: 2000 });
const consumed = new TtlCache<string, true>({ ttlMs: 60_000, max: 10_000 });
const warned = new TtlCache<string, true>({ ttlMs: 10 * 60_000, max: 2000 });

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One audit-log request is shared by every concurrent lookup for the same guild. During a mass
 * delete this turns hundreds of lookups into a handful of REST calls.
 */
function fetchEntries(guild: Guild, maxAgeMs: number): Promise<AuditEntry[]> {
  const cached = snapshots.get(guild.id);
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.promise;

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
    if (!warned.has(`perm:${guild.id}`)) {
      warned.set(`perm:${guild.id}`, true);
      logger.warn(`[AUDIT] Missing "View Audit Log" in ${guild.name} (${guild.id}); protection cannot identify executors.`);
    }
    return Promise.resolve([]);
  }

  const promise = guild
    .fetchAuditLogs({ limit: 50 })
    .then((logs) => [...logs.entries.values()] as AuditEntry[])
    .catch((error: unknown) => {
      if (!warned.has(`err:${guild.id}`)) {
        warned.set(`err:${guild.id}`, true);
        logger.warn(`[AUDIT] Could not fetch audit logs for ${guild.id}: ${errorMessage(error)}`);
      }
      return [] as AuditEntry[];
    });
  snapshots.set(guild.id, { at: Date.now(), promise });
  return promise;
}

export interface FindOptions {
  types: AuditLogEvent[];
  /** Only accept entries whose target is this id. */
  targetId?: string;
  /** Mark the returned entry as handled so the same entry is never processed twice. */
  consume?: boolean;
  /** Set to false to skip the retry delays (fast path for events that often have no entry). */
  retry?: boolean;
  maxAgeMs?: number;
}

export async function findAuditEntry(guild: Guild, options: FindOptions): Promise<AuditEntry | null> {
  const delays = options.retry === false ? [] : RETRY_DELAYS_MS;
  const maxAge = options.maxAgeMs ?? DEFAULT_ENTRY_MAX_AGE_MS;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    const entries = await fetchEntries(guild, attempt === 0 ? FIRST_FETCH_MAX_AGE_MS : RETRY_FETCH_MAX_AGE_MS);
    const now = Date.now();
    const found = entries.find(
      (entry) =>
        options.types.includes(entry.action) &&
        (options.targetId === undefined || entry.targetId === options.targetId) &&
        now - entry.createdTimestamp <= maxAge &&
        !(options.consume && consumed.has(entry.id)),
    );
    if (found) {
      if (options.consume) consumed.set(found.id, true);
      return found;
    }
  }
  return null;
}
