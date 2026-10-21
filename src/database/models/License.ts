import { Schema, model } from 'mongoose';

export interface LicenseDoc {
  keyHash: string;
  maskedKey: string;
  provider: string;
  validatedAt: Date;
  expiresAt: Date | null;
  owner: string | null;
}

const schema = new Schema<LicenseDoc>(
  {
    keyHash: { type: String, required: true, unique: true },
    maskedKey: { type: String, required: true },
    provider: { type: String, required: true },
    validatedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
    owner: { type: String, default: null },
  },
  { timestamps: true },
);

export const LicenseModel = model<LicenseDoc>('License', schema);
