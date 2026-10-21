import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type Role,
} from 'discord.js';
import { RolePanelModel, type RolePanelDoc } from '../database/models/RolePanel';
import { COLORS, brand } from '../utils/reply';
import { withCard } from '../utils/card';

export const MAX_PANEL_ROLES = 15;

/** Roles that must never be self-assignable, otherwise a panel becomes a privilege-escalation button. */
const DANGEROUS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MentionEveryone,
];

/** Returns why a role cannot go on a panel, or null when it is fine. */
export function roleProblem(guild: Guild, role: Role): string | null {
  const me = guild.members.me;
  if (role.id === guild.id) return '@everyone cannot be used.';
  if (role.managed) return `${role.name} is managed by an integration.`;
  if (DANGEROUS.some((p) => role.permissions.has(p))) return `${role.name} has moderator/admin permissions, so it cannot be self-assigned.`;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return 'The bot needs the Manage Roles permission.';
  if (role.position >= me.roles.highest.position) return `${role.name} is above the bot's highest role.`;
  return null;
}

function buildComponents(roles: { roleId: string; label: string }[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < roles.length; i += 5) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        roles.slice(i, i + 5).map((r) =>
          new ButtonBuilder().setCustomId(`rolepanel:toggle:${r.roleId}`).setLabel(r.label.slice(0, 80)).setStyle(ButtonStyle.Secondary),
        ),
      ),
    );
  }
  return rows;
}

export interface CreatePanelInput {
  guild: Guild;
  channelId: string;
  title: string;
  description: string;
  roleIds: string[];
  createdBy: string;
}

/** Validates, posts the panel message and stores it. Throws an Error with a user-facing message on problems. */
export async function createRolePanel(input: CreatePanelInput): Promise<RolePanelDoc> {
  const { guild } = input;
  const ids = [...new Set(input.roleIds)];
  if (ids.length === 0) throw new Error('Pick at least one role.');
  if (ids.length > MAX_PANEL_ROLES) throw new Error(`A panel holds at most ${MAX_PANEL_ROLES} roles.`);

  const roles: Role[] = [];
  for (const id of ids) {
    const role = guild.roles.cache.get(id);
    if (!role) throw new Error('One of the selected roles no longer exists.');
    const problem = roleProblem(guild, role);
    if (problem) throw new Error(problem);
    roles.push(role);
  }

  const channel = guild.channels.cache.get(input.channelId);
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) throw new Error('Pick a text channel.');
  const me = guild.members.me;
  if (!me || !channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles])) {
    throw new Error('The bot needs View Channel, Send Messages, Embed Links and Attach Files there.');
  }

  const stored = roles.map((r) => ({ roleId: r.id, label: r.name }));
  const embed = brand(new EmbedBuilder().setColor(COLORS.info).setTitle(input.title).setDescription(input.description || 'Press a button to get or remove a role.'));
  const card = await withCard(embed, {
    kind: 'star',
    chip: 'Roles',
    title: input.title,
    text: input.description || 'Press a button to get or remove a role.',
  });
  const message = await channel.send({
    embeds: card.embeds,
    files: card.files,
    components: buildComponents(stored),
    allowedMentions: { parse: [] },
  });

  return RolePanelModel.create({
    guildId: guild.id,
    channelId: channel.id,
    messageId: message.id,
    title: input.title,
    description: input.description,
    roles: stored,
    createdBy: input.createdBy,
  });
}

export const listRolePanels = (guildId: string) => RolePanelModel.find({ guildId }).sort({ createdAt: -1 }).limit(50).lean<RolePanelDoc[]>();

/** Deletes the stored panel and (best effort) the Discord message. */
export async function deleteRolePanel(guild: Guild, messageId: string): Promise<boolean> {
  const panel = await RolePanelModel.findOneAndDelete({ guildId: guild.id, messageId }).lean<RolePanelDoc>();
  if (!panel) return false;
  const channel = guild.channels.cache.get(panel.channelId);
  if (channel?.isTextBased()) await channel.messages.delete(panel.messageId).catch(() => undefined);
  return true;
}

export type ToggleResult = { status: 'added' | 'removed'; role: Role } | { status: 'error'; message: string };

export async function toggleRole(member: GuildMember, messageId: string, roleId: string): Promise<ToggleResult> {
  const panel = await RolePanelModel.findOne({ guildId: member.guild.id, messageId }).lean<RolePanelDoc>();
  if (!panel || !panel.roles.some((r) => r.roleId === roleId)) return { status: 'error', message: 'This panel is no longer active.' };
  const role = member.guild.roles.cache.get(roleId);
  if (!role) return { status: 'error', message: 'That role no longer exists.' };
  const problem = roleProblem(member.guild, role);
  if (problem) return { status: 'error', message: problem };
  try {
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(role, 'Role panel');
      return { status: 'removed', role };
    }
    await member.roles.add(role, 'Role panel');
    return { status: 'added', role };
  } catch {
    return { status: 'error', message: 'I could not change that role.' };
  }
}
