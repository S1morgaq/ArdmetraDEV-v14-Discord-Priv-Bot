import { Schema, model } from 'mongoose';

export interface RolePanelDoc {
  guildId: string;
  channelId: string;
  messageId: string;
  title: string;
  description: string;
  roles: { roleId: string; label: string }[];
  createdBy: string;
  createdAt: Date;
}

const schema = new Schema<RolePanelDoc>(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, required: true, unique: true },
    title: { type: String, required: true, maxlength: 256 },
    description: { type: String, default: '', maxlength: 1000 },
    roles: [{ _id: false, roleId: { type: String, required: true }, label: { type: String, required: true } }],
    createdBy: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const RolePanelModel = model<RolePanelDoc>('RolePanel', schema);
