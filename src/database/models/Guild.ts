import { Schema, model } from 'mongoose';

export interface GuildDoc {
  guildId: string;
  name: string;
  ownerId: string;
  logChannelId: string | null;
  caseCounter: number;
  active: boolean;
  joinedAt: Date;
  lockdown: {
    active: boolean;
    until: Date | null;
    previousVerificationLevel: number | null;
    previousInvitesDisabled: boolean;
  };
  register?: {
    channelId: string | null;
    chatChannelId: string | null;
    maleRoleId: string | null;
    femaleRoleId: string | null;
    unregisteredRoleId: string | null;
    panelMessageId: string | null;
  };
  voice?: { channelId: string | null; selfDeaf: boolean };
  tag?: { text: string | null; roleId: string | null };
  welcome?: {
    channelId: string | null;
    message: string | null;
    goodbyeChannelId: string | null;
    goodbyeMessage: string | null;
    autoRoleId: string | null;
  };
}

const schema = new Schema<GuildDoc>(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: '' },
    ownerId: { type: String, default: '' },
    logChannelId: { type: String, default: null },
    caseCounter: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    joinedAt: { type: Date, default: Date.now },
    lockdown: {
      active: { type: Boolean, default: false },
      until: { type: Date, default: null },
      previousVerificationLevel: { type: Number, default: null },
      previousInvitesDisabled: { type: Boolean, default: false },
    },
    register: {
      channelId: { type: String, default: null },
      chatChannelId: { type: String, default: null },
      maleRoleId: { type: String, default: null },
      femaleRoleId: { type: String, default: null },
      unregisteredRoleId: { type: String, default: null },
      panelMessageId: { type: String, default: null },
    },
    voice: {
      channelId: { type: String, default: null },
      selfDeaf: { type: Boolean, default: true },
    },
    tag: {
      text: { type: String, default: null },
      roleId: { type: String, default: null },
    },
    welcome: {
      channelId: { type: String, default: null },
      message: { type: String, default: null },
      goodbyeChannelId: { type: String, default: null },
      goodbyeMessage: { type: String, default: null },
      autoRoleId: { type: String, default: null },
    },
  },
  { timestamps: true },
);

schema.index({ 'lockdown.active': 1, 'lockdown.until': 1 });

export const GuildModel = model<GuildDoc>('Guild', schema);
