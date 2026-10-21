import { AuditLogEvent, type GuildMember } from 'discord.js';
import { getProtection } from '../services/protectionService';
import { logEvent } from '../services/loggerService';
import { findAuditEntry } from './auditLog';
import { enforce } from './guard';
import { isBotWhitelisted, isTrusted } from './whitelist';
import { recordNukeAction } from './antiNuke';

/** Runs for every newly joined *bot* account (detected through guildMemberAdd). */
export async function handleBotJoin(member: GuildMember): Promise<void> {
  if (!member.user.bot || member.id === member.client.user.id) return;
  const guild = member.guild;
  const { botProtection, antiNuke } = await getProtection(guild.id);
  if (!botProtection.enabled && !antiNuke.enabled) return;

  const entry = await findAuditEntry(guild, { types: [AuditLogEvent.BotAdd], targetId: member.id });
  const adderId = entry?.executorId ?? null;

  const whitelisted = await isBotWhitelisted(guild.id, member.id);
  const adderTrusted = adderId ? await isTrusted(guild, adderId) : false;

  if (botProtection.enabled && !whitelisted && !(botProtection.allowIfAdderTrusted && adderTrusted)) {
    if (botProtection.action !== 'ALLOW') {
      const actionTaken =
        botProtection.action === 'LOG'
          ? 'LOG ✅ — Logged only'
          : await enforce(guild, member.id, botProtection.action, 'Bot Protection: bot is not whitelisted');
      await logEvent(guild, {
        category: 'BOT',
        title: 'BOT PROTECTION — Unapproved bot added',
        executorId: adderId,
        targetId: member.id,
        fields: [{ name: 'Bot', value: `${member.user.tag} (\`${member.id}\`)` }],
        actionTaken,
      });
    }
  }

  if (adderId && !adderTrusted) await recordNukeAction(guild, adderId, 'botAdd', `Bot: ${member.user.tag}`);
}
