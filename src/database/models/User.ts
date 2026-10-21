import { Schema, model } from 'mongoose';

export interface UserDoc {
  userId: string;
  username: string;
  avatar: string | null;
  lastLoginAt: Date;
}

const schema = new Schema<UserDoc>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    username: { type: String, default: '' },
    avatar: { type: String, default: null },
    lastLoginAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const UserModel = model<UserDoc>('User', schema);
