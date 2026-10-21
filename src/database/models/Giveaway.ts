import { Schema, model } from 'mongoose';

export interface GiveawayDoc {
  guildId: string;
  channelId: string;
  messageId: string | null;
  hostId: string;
  prize: string;
  winnerCount: number;
  endsAt: Date;
  ended: boolean;
  cancelled: boolean;
  participants: string[];
  winners: string[];
  createdAt: Date;
}

const schema = new Schema<GiveawayDoc>(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, default: null, index: true },
    hostId: { type: String, required: true },
    prize: { type: String, required: true, maxlength: 256 },
    winnerCount: { type: Number, required: true, min: 1, max: 50 },
    endsAt: { type: Date, required: true },
    ended: { type: Boolean, default: false },
    cancelled: { type: Boolean, default: false },
    participants: { type: [String], default: [] },
    winners: { type: [String], default: [] },
  },
  { timestamps: true },
);

// Used by the resume/tick logic after restarts.
schema.index({ ended: 1, endsAt: 1 });

export const GiveawayModel = model<GiveawayDoc>('Giveaway', schema);
