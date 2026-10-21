import { ProtectionConfigModel } from '../database/models/ProtectionConfig';
import {
  PROTECTION_SECTIONS,
  protectionSchema,
  type ProtectionPatch,
  type ProtectionSettings,
} from '../types/protection';
import { TtlCache } from '../utils/cache';
import { logger } from '../utils/logger';

// Short TTL as a safety net; every write in this process invalidates immediately.
const cache = new TtlCache<string, ProtectionSettings>({ ttlMs: 60_000, max: 5000 });
const inflight = new Map<string, Promise<ProtectionSettings>>();

export function invalidateProtection(guildId: string): void {
  cache.delete(guildId);
}

async function load(guildId: string): Promise<ProtectionSettings> {
  const doc = await ProtectionConfigModel.findOne({ guildId }).lean();
  const result = protectionSchema.safeParse(doc ?? {});
  if (result.success) return result.data;
  logger.error(`[PROTECTION] Stored config for ${guildId} is invalid, using defaults: ${result.error.message}`);
  return protectionSchema.parse({});
}

/** Hot path (every message goes through here): cache first, coalesced DB load on a miss. */
export async function getProtection(guildId: string): Promise<ProtectionSettings> {
  const cached = cache.get(guildId);
  if (cached) return cached;
  let pending = inflight.get(guildId);
  if (!pending) {
    pending = load(guildId)
      .then((settings) => {
        cache.set(guildId, settings);
        return settings;
      })
      .finally(() => inflight.delete(guildId));
    inflight.set(guildId, pending);
  }
  return pending;
}

/** Loads the configs of many guilds with a single query (used during recovery). */
export async function warmProtectionCache(guildIds: string[]): Promise<void> {
  const docs = await ProtectionConfigModel.find({ guildId: { $in: guildIds } }).lean();
  const byGuild = new Map(docs.map((doc) => [String(doc.guildId), doc]));
  for (const guildId of guildIds) {
    const parsed = protectionSchema.safeParse(byGuild.get(guildId) ?? {});
    if (parsed.success) cache.set(guildId, parsed.data);
  }
}

async function save(guildId: string, settings: ProtectionSettings): Promise<void> {
  await ProtectionConfigModel.updateOne({ guildId }, { $set: settings }, { upsert: true, strict: false });
  cache.set(guildId, settings);
}

/** Merges a validated partial patch into the current settings and stores the result. */
export async function updateProtection(guildId: string, patch: ProtectionPatch): Promise<ProtectionSettings> {
  const current = await getProtection(guildId);
  const merged: Record<string, unknown> = {};
  for (const section of PROTECTION_SECTIONS) {
    merged[section] = { ...current[section], ...(patch[section] ?? {}) };
  }
  const next = protectionSchema.parse(merged);
  await save(guildId, next);
  return next;
}

export async function resetProtection(guildId: string): Promise<ProtectionSettings> {
  const defaults = protectionSchema.parse({});
  await save(guildId, defaults);
  return defaults;
}
