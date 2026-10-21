import { Schema, model } from 'mongoose';

export interface WarningDoc {
  guildId: string;
  userId: string;
  moderatorId: string;
  reason: string;
  createdAt: Date;
}

const schema = new Schema<WarningDoc>(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    moderatorId: { type: String, required: true },
    reason: { type: String, required: true, maxlength: 1000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

schema.index({ guildId: 1, userId: 1, createdAt: -1 });

export const WarningModel = model<WarningDoc>('Warning', schema);
