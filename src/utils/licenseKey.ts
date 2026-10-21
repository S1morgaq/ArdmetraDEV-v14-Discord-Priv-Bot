import crypto from 'node:crypto';

export const KEY_FORMAT = /^SK-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})$/;

export function computeChecksum(part1: string, part2: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${part1}-${part2}`).digest('hex').slice(0, 4).toUpperCase();
}

/** Generates a key that the local license provider accepts. */
export function generateLicenseKey(secret: string): string {
  const chunk = () => crypto.randomBytes(4).toString('hex').slice(0, 4).toUpperCase();
  const a = chunk();
  const b = chunk();
  return `SK-${a}-${b}-${computeChecksum(a, b, secret)}`;
}

/** SK-XXXX-XXXX-1234 -> SK-****-****-1234 */
export function maskLicenseKey(key: string | undefined): string {
  if (!key) return 'N/A';
  const parts = key.split('-');
  if (parts.length < 2) return '****';
  return `${parts[0]}-****-****-${parts[parts.length - 1].slice(-4)}`;
}
