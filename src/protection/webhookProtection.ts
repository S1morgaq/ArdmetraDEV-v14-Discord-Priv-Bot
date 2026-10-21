import { AuditLogEvent, type Guild } from 'discord.js';
import { getProtection } from '../services/protectionService';
import { logEvent } from '../services/loggerService';
import { findAuditEntry } from './auditLog';
import { enforce, protectionQueue } from './guard';
import { isTrusted } from './whitelist';
import { recordNukeAction } from './antiNuke';
import { errorMessage } from '../utils/logger';

const WEBHOOK_EVENTS = [AuditLogEvent.WebhookCreate, AuditLogEvent.WebhookDelete, AuditLogEvent.WebhookUpdate];
const MAX_ENTRIES_PER_EVENT = 5;

/**
 * `webhooksUpdate` carries no actor and no webhook id, so the audit log is scanned for fresh,
 * not yet processed webhook entries (each entry is consumed once).
 */
export async function handleWebhooksUpdate(guild: Guild): Promise<void> {
  const { webhookProtection, antiNuke } = await getProtection(guild.id);
  if (!webhookProtection.enabled && !antiNuke.enabled) return;

  for (let i = 0; i < MAX_ENTRIES_PER_EVENT; i++) {
    const entry = await findAuditEntry(guild, { types: WEBHOOK_EVENTS, consume: true, retry: i === 0, maxAgeMs: 10_000 });
    if (!entry?.executorId) return;
    const executorId = entry.executorId;
    if (await isTrusted(guild, executorId)) continue;

    const webhookId = entry.targetId ?? 'unknown';
    let label: string;
    let reverted = 'Log only';
    let enabled: boolean;

    if (entry.action === AuditLogEvent.WebhookCreate) {
      label = 'Webhook Created';
      enabled = webhookProtection.enabled && webhookProtection.create;
      if (enabled && entry.targetId) {
        const id = entry.targetId;
        protectionQueue.enqueue(guild.id, async () => {
          try {
            const webhook = await guild.client.fetchWebhook(id);
            await webhook.delete('Webhook Protection: unauthorized webhook creation');
          } catch (error) {
            await logEvent(guild, {
              category: 'WEBHOOK',
              title: 'WEBHOOK PROTECTION — Delete failed',
              description: errorMessage(error),
              targetId: id,
            });
          }
        });
        reverted = 'Webhook deleted';
      }
    } else if (entry.action === AuditLogEvent.WebhookDelete) {
      label = 'Webhook Deleted';
      enabled = webhookProtection.enabled && webhookProtection.delete;
      reverted = 'Cannot be restored (webhook tokens cannot be recreated)';
    } else {
      label = 'Webhook Updated';
      enabled = webhookProtection.enabled && webhookProtection.update;
      reverted = 'Logged (webhook changes cannot be reverted safely)';
    }

    const actionTaken = enabled
      ? await enforce(guild, executorId, webhookProtection.action, `Webhook Protection: ${label.toLowerCase()}`)
      : null;
    if (enabled || antiNuke.enabled) {
      await logEvent(guild, {
        category: 'WEBHOOK',
        title: `WEBHOOK PROTECTION — ${label}`,
        executorId,
        targetId: webhookId,
        fields: [{ name: 'Revert', value: reverted }],
        actionTaken,
      });
    }
    await recordNukeAction(guild, executorId, 'webhook', label);
  }
}
