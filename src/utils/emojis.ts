import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  ok: '✅',
  error: '❌',
  shield: '🛡️',
  music: '🎵',
  trash: '🗑️',
  edit: '✏️',
  giveaway: '🎉',
  on: '🟢',
  off: '🔴',
  warn: '⚠️',
  alert: '🚨',
  ban: '🔨',
  role: '🎭',
  channel: '📁',
  guild: '🏰',
  member: '👤',
  webhook: '🪝',
  bot: '🤖',
  sparkles: '✨',
} as const;

export type EmojiKey = keyof typeof DEFAULTS;

const CUSTOM = /^<a?:\w{2,32}:\d{17,20}>$/;

/**
 * Emojis used in embed titles / descriptions. Put a file called `emojis.json` next to package.json to
 * replace any of them with animated custom emojis, e.g. { "ok": "<a:tick:123456789012345678>" }.
 * The bot must be in the server that owns the emoji and needs "Use External Emojis" elsewhere.
 * (Footers and buttons cannot render custom emojis in embeds, so they keep the Unicode versions.)
 */
function load(): Record<EmojiKey, string> {
  const result: Record<EmojiKey, string> = { ...DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'emojis.json'), 'utf8')) as Record<string, unknown>;
    for (const key of Object.keys(DEFAULTS) as EmojiKey[]) {
      const value = raw[key];
      if (typeof value === 'string' && (CUSTOM.test(value) || (value.length > 0 && value.length <= 16 && !value.includes('<')))) {
        result[key] = value;
      }
    }
  } catch {
    // no override file (or invalid JSON): defaults are used
  }
  return result;
}

export const E = Object.freeze(load());
