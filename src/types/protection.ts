import { z } from 'zod';

export const PUNISH_ACTIONS = ['LOG', 'WARN', 'TIMEOUT', 'KICK', 'BAN', 'REMOVE_ROLES'] as const;
export type PunishAction = (typeof PUNISH_ACTIONS)[number];

const punish = z.enum(PUNISH_ACTIONS);

const roleProtection = z.object({
  enabled: z.boolean().default(true),
  create: z.boolean().default(true),
  delete: z.boolean().default(true),
  update: z.boolean().default(true),
  permissionUpdate: z.boolean().default(true),
  action: punish.default('LOG'),
});

const channelProtection = z.object({
  enabled: z.boolean().default(true),
  create: z.boolean().default(true),
  delete: z.boolean().default(true),
  update: z.boolean().default(true),
  permissionUpdate: z.boolean().default(true),
  action: punish.default('LOG'),
});

const serverProtection = z.object({
  enabled: z.boolean().default(true),
  revert: z.boolean().default(true),
  action: punish.default('LOG'),
});

const permissionProtection = z.object({
  enabled: z.boolean().default(true),
  revoke: z.boolean().default(true),
  action: punish.default('LOG'),
});

const webhookProtection = z.object({
  enabled: z.boolean().default(true),
  create: z.boolean().default(true),
  delete: z.boolean().default(true),
  update: z.boolean().default(true),
  action: punish.default('LOG'),
});

const botProtection = z.object({
  enabled: z.boolean().default(true),
  action: z.enum(['ALLOW', 'LOG', 'KICK', 'BAN']).default('KICK'),
  allowIfAdderTrusted: z.boolean().default(true),
});

const antiNuke = z.object({
  enabled: z.boolean().default(true),
  interval: z.number().int().min(1000).max(120_000).default(10_000),
  channelDeleteLimit: z.number().int().min(1).max(50).default(3),
  roleDeleteLimit: z.number().int().min(1).max(50).default(3),
  banLimit: z.number().int().min(1).max(50).default(5),
  kickLimit: z.number().int().min(1).max(50).default(5),
  webhookLimit: z.number().int().min(1).max(50).default(3),
  permissionUpdateLimit: z.number().int().min(1).max(50).default(3),
  botAddLimit: z.number().int().min(1).max(50).default(2),
  guildUpdateLimit: z.number().int().min(1).max(50).default(3),
  action: punish.default('REMOVE_ROLES'),
});

const antiRaid = z.object({
  enabled: z.boolean().default(true),
  joinLimit: z.number().int().min(2).max(500).default(20),
  interval: z.number().int().min(1000).max(300_000).default(10_000),
  action: z.enum(['LOG', 'ALERT', 'LOCK', 'KICK', 'BAN']).default('ALERT'),
  /** When > 0 only accounts younger than this many days count towards the threshold. */
  newAccountDays: z.number().int().min(0).max(365).default(0),
  cooldownSeconds: z.number().int().min(10).max(3600).default(120),
  lockdownSeconds: z.number().int().min(30).max(86_400).default(300),
});

const antiSpam = z.object({
  enabled: z.boolean().default(true),
  messageLimit: z.number().int().min(2).max(50).default(6),
  interval: z.number().int().min(1000).max(60_000).default(5000),
  duplicateLimit: z.number().int().min(2).max(20).default(4),
  mentionLimit: z.number().int().min(1).max(50).default(6),
  emojiLimit: z.number().int().min(1).max(100).default(15),
  linkLimit: z.number().int().min(1).max(50).default(4),
  blockEveryone: z.boolean().default(true),
  action: z.enum(['DELETE', 'WARN', 'TIMEOUT', 'KICK', 'BAN']).default('TIMEOUT'),
  timeoutSeconds: z.number().int().min(10).max(2_419_200).default(300),
  ignoredChannels: z.array(z.string().regex(/^\d{15,25}$/)).max(50).default([]),
});

const general = z.object({
  timeoutSeconds: z.number().int().min(60).max(2_419_200).default(3600),
});

export const protectionSchema = z.object({
  roleProtection: roleProtection.default({}),
  channelProtection: channelProtection.default({}),
  serverProtection: serverProtection.default({}),
  permissionProtection: permissionProtection.default({}),
  webhookProtection: webhookProtection.default({}),
  botProtection: botProtection.default({}),
  antiNuke: antiNuke.default({}),
  antiRaid: antiRaid.default({}),
  antiSpam: antiSpam.default({}),
  general: general.default({}),
});

/** Every section is optional and every field inside is optional: a partial update. */
export const protectionPatchSchema = z
  .object({
    roleProtection: roleProtection.partial().optional(),
    channelProtection: channelProtection.partial().optional(),
    serverProtection: serverProtection.partial().optional(),
    permissionProtection: permissionProtection.partial().optional(),
    webhookProtection: webhookProtection.partial().optional(),
    botProtection: botProtection.partial().optional(),
    antiNuke: antiNuke.partial().optional(),
    antiRaid: antiRaid.partial().optional(),
    antiSpam: antiSpam.partial().optional(),
    general: general.partial().optional(),
  })
  .strict();

export type ProtectionSettings = z.infer<typeof protectionSchema>;
export type ProtectionPatch = z.infer<typeof protectionPatchSchema>;
export type ProtectionSection = keyof ProtectionSettings;

export const PROTECTION_SECTIONS = Object.keys(protectionSchema.shape) as ProtectionSection[];
