import { Schema, model } from 'mongoose';

export const MODERATION_TYPES = [
  'BAN',
  'UNBAN',
  'KICK',
  'TIMEOUT',
  'WARN',
  'CLEAR',
  'LOCK',
  'UNLOCK',
  'SLOWMODE',
  'NICK',
  'ROLE',
] as const;
export type ModerationType = (typeof MODERATION_TYPES)[number];

export interface ModerationLogDoc {
  guildId: string;
  caseId: number;
  type: ModerationType;
  userId: string | null;
  moderatorId: string;
  reason: string;
  durationMs: number | null;
  createdAt: Date;
}

const schema = new Schema<ModerationLogDoc>(
  {
    guildId: { type: String, required: true },
    caseId: { type: Number, required: true },
    type: { type: String, enum: MODERATION_TYPES, required: true },
    userId: { type: String, default: null },
    moderatorId: { type: String, required: true },
    reason: { type: String, default: 'No reason provided', maxlength: 1000 },
    durationMs: { type: Number, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

schema.index({ guildId: 1, caseId: -1 }, { unique: true });
schema.index({ guildId: 1, userId: 1 });

export const ModerationLogModel = model<ModerationLogDoc>('ModerationLog', schema);
