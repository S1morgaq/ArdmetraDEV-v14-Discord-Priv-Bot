import { Schema, model } from 'mongoose';

export type Gender = 'male' | 'female';

export interface RegistrationDoc {
  guildId: string;
  userId: string;
  gender: Gender;
  createdAt: Date;
}

const schema = new Schema<RegistrationDoc>(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    gender: { type: String, enum: ['male', 'female'], required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

schema.index({ guildId: 1, userId: 1 }, { unique: true });

export const RegistrationModel = model<RegistrationDoc>('Registration', schema);
