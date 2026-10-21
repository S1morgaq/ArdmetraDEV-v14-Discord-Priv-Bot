import { AuditLogEvent, PermissionsBitField, type Guild, type Role, type RoleEditOptions } from 'discord.js';
import { getProtection } from '../services/protectionService';
import { logEvent } from '../services/loggerService';
import { botCanManageRole } from '../utils/hierarchy';
import { enforce, getUntrustedExecutor, protectionQueue } from './guard';
import { recordNukeAction } from './antiNuke';
import { errorMessage } from '../utils/logger';

/** Discord only lets a bot grant permissions it holds itself (unless it is an administrator). */
function grantable(guild: Guild, permissions: PermissionsBitField): PermissionsBitField {
  const me = guild.members.me;
  if (!me || me.permissions.has('Administrator')) return permissions;
  return new PermissionsBitField(permissions.bitfield & me.permissions.bitfield);
}

export async function handleRoleCreate(role: Role): Promise<void> {
  if (role.managed) return; // integration roles are created together with a bot
  const guild = role.guild;
  const { roleProtection } = await getProtection(guild.id);
  if (!roleProtection.enabled || !roleProtection.create) return;

  const executorId = await getUntrustedExecutor(guild, { types: [AuditLogEvent.RoleCreate], targetId: role.id });
  if (!executorId) return;

  let reverted = 'Role could not be deleted (hierarchy/permissions).';
  if (botCanManageRole(guild, role)) {
    protectionQueue.enqueue(guild.id, async () => {
      await role.delete('Role Protection: unauthorized role creation');
    });
    reverted = 'Role deleted';
  }
  const actionTaken = await enforce(guild, executorId, roleProtection.action, 'Role Protection: unauthorized role creation');
  await logEvent(guild, {
    category: 'ROLE',
    title: 'ROLE PROTECTION — Role Created',
    executorId,
    fields: [{ name: 'Role', value: `${role.name} (\`${role.id}\`)` }, { name: 'Revert', value: reverted }],
    actionTaken,
  });
}

export async function handleRoleDelete(role: Role): Promise<void> {
  if (role.managed) return;
  const guild = role.guild;
  const { roleProtection, antiNuke } = await getProtection(guild.id);
  const restore = roleProtection.enabled && roleProtection.delete;
  if (!restore && !antiNuke.enabled) return;

  const executorId = await getUntrustedExecutor(guild, { types: [AuditLogEvent.RoleDelete], targetId: role.id });
  if (!executorId) return;

  let reverted = 'Restore disabled';
  if (restore) {
    const me = guild.members.me;
    const position = me ? Math.min(role.position, Math.max(1, me.roles.highest.position - 1)) : undefined;
    const permissions = grantable(guild, role.permissions);
    protectionQueue.enqueue(guild.id, async () => {
      await guild.roles.create({
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        mentionable: role.mentionable,
        permissions,
        position,
        reason: 'Role Protection: restoring deleted role',
      });
    });
    reverted = 'Role re-created (members must be re-assigned; Discord does not allow bulk restore)';
  }

  const actionTaken = restore
    ? await enforce(guild, executorId, roleProtection.action, 'Role Protection: unauthorized role deletion')
    : null;
  await logEvent(guild, {
    category: 'ROLE',
    title: 'ROLE PROTECTION — Role Deleted',
    executorId,
    fields: [{ name: 'Role', value: `${role.name} (\`${role.id}\`)` }, { name: 'Revert', value: reverted }],
    actionTaken,
  });
  await recordNukeAction(guild, executorId, 'roleDelete', `Last deleted role: ${role.name}`);
}

export async function handleRoleUpdate(oldRole: Role, newRole: Role): Promise<void> {
  if (newRole.managed) return;
  const guild = newRole.guild;
  const { roleProtection, antiNuke } = await getProtection(guild.id);
  if (!roleProtection.enabled && !antiNuke.enabled) return;

  const cosmeticChanged =
    oldRole.name !== newRole.name ||
    oldRole.color !== newRole.color ||
    oldRole.hoist !== newRole.hoist ||
    oldRole.mentionable !== newRole.mentionable;
  const permissionsChanged = oldRole.permissions.bitfield !== newRole.permissions.bitfield;
  const positionChanged = oldRole.position !== newRole.position;
  if (!cosmeticChanged && !permissionsChanged && !positionChanged) return;

  // Bulk reorders emit many position-only events without an audit entry: don't wait for retries then.
  const positionOnly = positionChanged && !cosmeticChanged && !permissionsChanged;
  const executorId = await getUntrustedExecutor(guild, {
    types: [AuditLogEvent.RoleUpdate],
    targetId: newRole.id,
    retry: !positionOnly,
  });
  if (!executorId) return;

  const edit: RoleEditOptions = { reason: 'Role Protection: reverting unauthorized change' };
  const changes: string[] = [];

  if (roleProtection.enabled && roleProtection.update) {
    if (oldRole.name !== newRole.name) {
      edit.name = oldRole.name;
      changes.push(`name: ${newRole.name} → ${oldRole.name}`);
    }
    if (oldRole.color !== newRole.color) {
      edit.color = oldRole.color;
      changes.push('color');
    }
    if (oldRole.hoist !== newRole.hoist) {
      edit.hoist = oldRole.hoist;
      changes.push('hoist');
    }
    if (oldRole.mentionable !== newRole.mentionable) {
      edit.mentionable = oldRole.mentionable;
      changes.push('mentionable');
    }
    if (positionChanged) {
      edit.position = oldRole.position;
      changes.push(`position: ${newRole.position} → ${oldRole.position}`);
    }
  }
  if (roleProtection.enabled && roleProtection.permissionUpdate && permissionsChanged) {
    edit.permissions = grantable(guild, oldRole.permissions);
    changes.push('permissions');
  }

  let reverted = 'Nothing to revert (protection for this change is disabled).';
  if (changes.length > 0) {
    if (newRole.editable) {
      protectionQueue.enqueue(guild.id, async () => {
        try {
          await newRole.edit(edit);
        } catch (error) {
          await logEvent(guild, {
            category: 'ROLE',
            title: 'ROLE PROTECTION — Revert failed',
            description: errorMessage(error),
            fields: [{ name: 'Role', value: `${newRole.name} (\`${newRole.id}\`)` }],
          });
        }
      });
      reverted = `Reverted: ${changes.join(', ')}`;
    } else {
      reverted = 'Role is above the bot in the hierarchy: cannot revert.';
    }
  }

  let actionTaken: string | null = null;
  if (changes.length > 0) {
    actionTaken = await enforce(guild, executorId, roleProtection.action, 'Role Protection: unauthorized role update');
  }
  await logEvent(guild, {
    category: 'ROLE',
    title: 'ROLE PROTECTION — Role Updated',
    executorId,
    fields: [{ name: 'Role', value: `${newRole.name} (\`${newRole.id}\`)` }, { name: 'Revert', value: reverted }],
    actionTaken,
  });
  if (permissionsChanged) await recordNukeAction(guild, executorId, 'permissionUpdate', `Role: ${newRole.name}`);
}
