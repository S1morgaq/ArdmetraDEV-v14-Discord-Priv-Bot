import { hasClient, getClient } from '../client';
import { isDatabaseConnected } from '../database/connect';
import { isLicenseValid } from '../services/licenseService';

export const startedAt = Date.now();

export interface HealthReport {
  status: 'ok' | 'degraded';
  discord: boolean;
  database: boolean;
  license: boolean;
  uptime: number;
}

export function getHealth(): HealthReport {
  const discord = hasClient() && getClient().isReady();
  const database = isDatabaseConnected();
  const license = isLicenseValid();
  return {
    status: discord && database && license ? 'ok' : 'degraded',
    discord,
    database,
    license,
    uptime: Math.floor(process.uptime()),
  };
}
