import 'dotenv/config';
import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().trim().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  DISCORD_TOKEN: z.string().trim().min(20, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().trim().regex(/^\d{15,25}$/, 'DISCORD_CLIENT_ID must be a snowflake'),
  DISCORD_CLIENT_SECRET: z.string().trim().min(10, 'DISCORD_CLIENT_SECRET is required'),
  DISCORD_CALLBACK_URL: z.string().trim().url('DISCORD_CALLBACK_URL must be a URL'),

  MONGODB_URI: z
    .string()
    .trim()
    .regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI must start with mongodb:// or mongodb+srv://'),

  DASHBOARD_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // 0.0.0.0 = reachable from other machines (VDS). Use 127.0.0.1 when a reverse proxy runs on the same host.
  DASHBOARD_HOST: z.string().trim().min(1).default('0.0.0.0'),
  DASHBOARD_URL: z.string().trim().url('DASHBOARD_URL must be a URL'),

  SESSION_SECRET: z.string().trim().min(32, 'SESSION_SECRET must be at least 32 characters'),

  // License values are validated by the license service so that a missing key
  // produces the dedicated "[LICENSE] License key not found." message.
  LICENSE_KEY: optionalString,
  LICENSE_SECRET: optionalString,
  LICENSE_API_URL: z.preprocess(emptyToUndefined, z.string().trim().url().optional()),

  BOT_OWNER_IDS: z.preprocess(emptyToUndefined, z.string().optional()),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[CONFIG] Invalid or missing environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('[CONFIG] Startup cancelled. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const env = parsed.data;

export const config = Object.freeze({
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  logLevel: env.LOG_LEVEL,
  version: '1.0.0',
  prefix: '.',
  /** Shown in every embed footer and as the bot's "Watching" status. */
  tagline: 'S1morg Bu Sunucuyu İzliyor',
  discord: Object.freeze({
    token: env.DISCORD_TOKEN,
    clientId: env.DISCORD_CLIENT_ID,
    clientSecret: env.DISCORD_CLIENT_SECRET,
    callbackUrl: env.DISCORD_CALLBACK_URL,
  }),
  database: Object.freeze({ uri: env.MONGODB_URI }),
  dashboard: Object.freeze({
    port: env.DASHBOARD_PORT,
    host: env.DASHBOARD_HOST,
    url: env.DASHBOARD_URL.replace(/\/+$/, ''),
    sessionSecret: env.SESSION_SECRET,
    secureCookies: env.DASHBOARD_URL.startsWith('https://'),
    trustProxy: env.TRUST_PROXY,
    ownerIds: Object.freeze(
      (env.BOT_OWNER_IDS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  }),
  license: Object.freeze({
    key: env.LICENSE_KEY,
    secret: env.LICENSE_SECRET,
    apiUrl: env.LICENSE_API_URL,
  }),
});

export type AppConfig = typeof config;
