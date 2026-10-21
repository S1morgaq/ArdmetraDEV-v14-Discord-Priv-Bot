import { AuditLogEvent, type GuildMember, type PartialGuildMember } from 'discord.js';
import { getProtection } from '../services/protectionService';
import { logEvent } from '../services/loggerService';
import { hasDangerousPermission } from '../utils/hierarchy';
import { enforce, getUntrustedExecutor, protectionQueue } from './guard';
import { recordNukeAction } from './antiNuke';

/**
 * Detects dangerous roles (Administrator, Manage Guild/Roles/Channels/Webhooks, Ban/Kick, @everyone)
 * being handed to a member by someone who is not trusted, and takes them back.
 */
export async function handleMemberRoleChange(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember): Promise<void> {
  if (oldMember.partial) return; // without the previous roles we cannot compute a diff safely
  const guild = newMember.guild;
  const { permissionProtection, antiNuke } = await getProtection(guild.id);
  if (!permissionProtection.enabled && !antiNuke.enabled) return;

  const added = newMember.roles.cache.filter(
    (role) => !oldMember.roles.cache.has(role.id) && !role.managed && hasDangerousPermission(role.permissions),
  );
  if (added.size === 0) return;

  const executorId = await getUntrustedExecutor(guild, { types: [AuditLogEvent.MemberRoleUpdate], targetId: newMember.id });
  if (!executorId) return;

  const roleIds = [...added.keys()];
  let reverted = 'Revoke disabled';
  if (permissionProtection.enabled && permissionProtection.revoke) {
    const removable = roleIds.filter((id) => {
      const role = guild.roles.cache.get(id);
      return role !== undefined && guild.members.me !== null && guild.members.me.roles.highest.comparePositionTo(role) > 0;
    });
    if (removable.length > 0) {
      protectionQueue.enqueue(guild.id, async () => {
        await newMember.roles.remove(removable, 'Permission Protection: dangerous role granted by an untrusted user');
      });
      reverted = `Removed ${removable.map((id) => `<@&${id}>`).join(', ')}`;
    } else {
      reverted = 'Roles are above the bot: cannot remove';
    }
  }

  const actionTaken = permissionProtection.enabled
    ? await enforce(guild, executorId, permissionProtection.action, 'Permission Protection: dangerous role granted')
    : null;
  await logEvent(guild, {
    category: 'PROTECTION',
    title: 'PERMISSION PROTECTION — Dangerous role granted',
    executorId,
    targetId: newMember.id,
    fields: [
      { name: 'Roles', value: added.map((r) => r.name).join(', ') },
      { name: 'Revert', value: reverted },
    ],
    actionTaken,
  });
  await recordNukeAction(guild, executorId, 'permissionUpdate', `Granted dangerous role to <@${newMember.id}>`);
}
