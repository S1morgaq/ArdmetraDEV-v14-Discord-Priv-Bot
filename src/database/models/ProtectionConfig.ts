import { Schema, model } from 'mongoose';

/**
 * Stores one document per guild. The section layout is defined (and validated, and defaulted) by
 * `protectionSchema` in src/types/protection.ts, so the Mongoose schema stays open (`strict: false`)
 * and only `guildId` is declared. Old documents keep working when new settings are added.
 */
const schema = new Schema({ guildId: { type: String, required: true, unique: true, index: true } }, {
  strict: false,
  timestamps: true,
  minimize: false,
});

export const ProtectionConfigModel = model('ProtectionConfig', schema);
