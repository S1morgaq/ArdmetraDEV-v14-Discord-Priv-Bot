import { PUNISH_ACTIONS, type ProtectionSection } from '../types/protection';

export interface FieldDef {
  key: string;
  label: string;
  type: 'toggle' | 'number' | 'select' | 'idlist';
  options?: readonly string[];
  min?: number;
  max?: number;
  /** Stored value = shown value * scale (e.g. 1000 for milliseconds shown as seconds). */
  scale?: number;
  unit?: string;
}

export interface SectionDef {
  key: ProtectionSection;
  title: string;
  icon: string;
  description: string;
  fields: FieldDef[];
}

const action: FieldDef = { key: 'action', label: 'Action', type: 'select', options: PUNISH_ACTIONS };
const on = (key: string, label: string): FieldDef => ({ key, label, type: 'toggle' });
const num = (key: string, label: string, min: number, max: number, unit?: string, scale?: number): FieldDef => ({
  key, label, type: 'number', min, max, unit, scale,
});

/** Drives the generated protection form; every key maps 1:1 to protectionSchema. */
export const PROTECTION_UI: SectionDef[] = [
  {
    key: 'roleProtection', title: 'Role Protection', icon: '🎭',
    description: 'Reverts unauthorized role creation, deletion and edits.',
    fields: [on('enabled', 'Enabled'), on('create', 'Role create'), on('delete', 'Role delete'), on('update', 'Role update'), on('permissionUpdate', 'Permission update'), action],
  },
  {
    key: 'channelProtection', title: 'Channel Protection', icon: '📁',
    description: 'Restores deleted channels and reverts unauthorized changes.',
    fields: [on('enabled', 'Enabled'), on('create', 'Channel create'), on('delete', 'Channel delete'), on('update', 'Channel update'), on('permissionUpdate', 'Overwrite update'), action],
  },
  {
    key: 'serverProtection', title: 'Server Protection', icon: '🏰',
    description: 'Watches name, icon, vanity URL, verification level and more.',
    fields: [on('enabled', 'Enabled'), on('revert', 'Revert changes'), action],
  },
  {
    key: 'permissionProtection', title: 'Permission Protection', icon: '🔑',
    description: 'Takes back dangerous roles handed out by untrusted users.',
    fields: [on('enabled', 'Enabled'), on('revoke', 'Revoke roles'), action],
  },
  {
    key: 'webhookProtection', title: 'Webhook Protection', icon: '🪝',
    description: 'Deletes rogue webhooks and tracks webhook abuse.',
    fields: [on('enabled', 'Enabled'), on('create', 'Webhook create'), on('delete', 'Webhook delete'), on('update', 'Webhook update'), action],
  },
  {
    key: 'botProtection', title: 'Bot Protection', icon: '🤖',
    description: 'Decides what happens when a non-whitelisted bot joins.',
    fields: [on('enabled', 'Enabled'), { key: 'action', label: 'Action', type: 'select', options: ['ALLOW', 'LOG', 'KICK', 'BAN'] }, on('allowIfAdderTrusted', 'Allow if adder is trusted')],
  },
  {
    key: 'antiNuke', title: 'Anti-Nuke', icon: '☢️',
    description: 'Punishes users who perform too many critical actions in a short window.',
    fields: [
      on('enabled', 'Enabled'),
      num('interval', 'Interval', 1, 120, 'seconds', 1000),
      num('channelDeleteLimit', 'Channel delete limit', 1, 50),
      num('roleDeleteLimit', 'Role delete limit', 1, 50),
      num('banLimit', 'Ban limit', 1, 50),
      num('kickLimit', 'Kick limit', 1, 50),
      num('webhookLimit', 'Webhook limit', 1, 50),
      num('permissionUpdateLimit', 'Permission update limit', 1, 50),
      num('botAddLimit', 'Bot add limit', 1, 50),
      num('guildUpdateLimit', 'Server update limit', 1, 50),
      action,
    ],
  },
  {
    key: 'antiRaid', title: 'Anti-Raid', icon: '🚨',
    description: 'Detects join floods. Optionally only counts young accounts.',
    fields: [
      on('enabled', 'Enabled'),
      num('joinLimit', 'Join limit', 2, 500),
      num('interval', 'Interval', 1, 300, 'seconds', 1000),
      { key: 'action', label: 'Action', type: 'select', options: ['LOG', 'ALERT', 'LOCK', 'KICK', 'BAN'] },
      num('newAccountDays', 'Only count accounts younger than', 0, 365, 'days'),
      num('cooldownSeconds', 'Cooldown', 10, 3600, 'seconds'),
      num('lockdownSeconds', 'Lockdown length', 30, 86400, 'seconds'),
    ],
  },
  {
    key: 'antiSpam', title: 'Anti-Spam', icon: '💬',
    description: 'Rate limits, duplicate messages, mention / link / emoji spam.',
    fields: [
      on('enabled', 'Enabled'),
      num('messageLimit', 'Messages per interval', 2, 50),
      num('interval', 'Interval', 1, 60, 'seconds', 1000),
      num('duplicateLimit', 'Duplicate limit', 2, 20),
      num('mentionLimit', 'Mention limit', 1, 50),
      num('emojiLimit', 'Emoji limit', 1, 100),
      num('linkLimit', 'Link limit', 1, 50),
      on('blockEveryone', 'Block @everyone / @here'),
      { key: 'action', label: 'Action', type: 'select', options: ['DELETE', 'WARN', 'TIMEOUT', 'KICK', 'BAN'] },
      num('timeoutSeconds', 'Timeout length', 10, 2419200, 'seconds'),
      { key: 'ignoredChannels', label: 'Ignored channel IDs (comma separated)', type: 'idlist' },
    ],
  },
  {
    key: 'general', title: 'General', icon: '⚙️',
    description: 'Defaults shared by every protection module.',
    fields: [num('timeoutSeconds', 'Timeout length for TIMEOUT actions', 60, 2419200, 'seconds')],
  },
];
