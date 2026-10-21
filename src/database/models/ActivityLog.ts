import { Schema, model } from 'mongoose';

export const LOG_CATEGORIES = [
  'PROTECTION',
  'MODERATION',
  'GIVEAWAY',
  'GUILD',
  'MEMBER',
  'ROLE',
  'CHANNEL',
  'WEBHOOK',
  'BOT',
] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];

export interface ActivityLogDoc {
  guildId: string;
  category: LogCategory;
  title: string;
  description: string;
  executorId: string | null;
  targetId: string | null;
  actionTaken: string | null;
  createdAt: Date;
}

const schema = new Schema<ActivityLogDoc>(
  {
    guildId: { type: String, required: true },
    category: { type: String, enum: LOG_CATEGORIES, required: true },
    title: { type: String, required: true, maxlength: 256 },
    description: { type: String, default: '', maxlength: 2000 },
    executorId: { type: String, default: null },
    targetId: { type: String, default: null },
    actionTaken: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

schema.index({ guildId: 1, createdAt: -1 });
schema.index({ guildId: 1, category: 1, createdAt: -1 });
// Keep the collection bounded: entries expire after 30 days.
schema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export const ActivityLogModel = model<ActivityLogDoc>('ActivityLog', schema);
