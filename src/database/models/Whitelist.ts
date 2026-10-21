import { Schema, model } from 'mongoose';

export const WHITELIST_TYPES = ['user', 'role', 'bot'] as const;
export type WhitelistType = (typeof WHITELIST_TYPES)[number];

export interface WhitelistDoc {
  guildId: string;
  targetId: string;
  type: WhitelistType;
  addedBy: string;
  createdAt: Date;
}

const schema = new Schema<WhitelistDoc>(
  {
    guildId: { type: String, required: true },
    targetId: { type: String, required: true },
    type: { type: String, enum: WHITELIST_TYPES, required: true },
    addedBy: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

schema.index({ guildId: 1, targetId: 1 }, { unique: true });

export const WhitelistModel = model<WhitelistDoc>('Whitelist', schema);
