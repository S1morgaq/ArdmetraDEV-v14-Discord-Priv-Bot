import crypto from 'node:crypto';
import { config } from '../config';
import { logger, errorMessage } from '../utils/logger';
import { registerInterval } from '../utils/scheduler';
import { LicenseModel } from '../database/models/License';
import { KEY_FORMAT, computeChecksum, maskLicenseKey } from '../utils/licenseKey';

export interface LicenseInfo {
  valid: boolean;
  maskedKey: string;
  provider: string;
  validatedAt: Date | null;
  expiresAt: Date | null;
  owner: string | null;
  reason: string | null;
}

/** Abstraction so local checks can be swapped for a remote API without touching callers. */
export interface LicenseProvider {
  readonly name: string;
  verify(key: string): Promise<{ valid: boolean; reason?: string; expiresAt?: Date | null; owner?: string | null }>;
}

class LocalLicenseProvider implements LicenseProvider {
  readonly name = 'local';

  async verify(key: string) {
    const match = KEY_FORMAT.exec(key);
    if (!match) return { valid: false, reason: 'Invalid license key format (expected SK-XXXX-XXXX-XXXX).' };
    if (!config.license.secret) return { valid: false, reason: 'LICENSE_SECRET is not configured.' };
    const expected = computeChecksum(match[1], match[2], config.license.secret);
    const a = Buffer.from(expected);
    const b = Buffer.from(match[3]);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { valid: false, reason: 'License key checksum mismatch.' };
    }
    return { valid: true, expiresAt: null, owner: null };
  }
}

class RemoteLicenseProvider implements LicenseProvider {
  readonly name = 'remote';

  constructor(private readonly url: string) {}

  async verify(key: string) {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, product: 'priv-bot', version: config.version }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { valid: false, reason: `License server responded with HTTP ${response.status}.` };
    const data = (await response.json()) as { valid?: boolean; reason?: string; expiresAt?: string | null; owner?: string | null };
    return {
      valid: data.valid === true,
      reason: data.reason,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      owner: data.owner ?? null,
    };
  }
}

function createProvider(): LicenseProvider {
  return config.license.apiUrl ? new RemoteLicenseProvider(config.license.apiUrl) : new LocalLicenseProvider();
}

let info: LicenseInfo = {
  valid: false,
  maskedKey: maskLicenseKey(config.license.key),
  provider: 'none',
  validatedAt: null,
  expiresAt: null,
  owner: null,
  reason: 'Not validated yet.',
};

/** Validates the configured license. Never throws; returns the result. */
export async function validateLicense(): Promise<boolean> {
  const key = config.license.key;
  if (!key) {
    info = { ...info, valid: false, reason: 'License key not found.' };
    logger.error('[LICENSE] License key not found.');
    return false;
  }

  const provider = createProvider();
  try {
    const result = await provider.verify(key);
    const expired = result.expiresAt ? result.expiresAt.getTime() < Date.now() : false;
    const valid = result.valid && !expired;
    info = {
      valid,
      maskedKey: maskLicenseKey(key),
      provider: provider.name,
      validatedAt: valid ? new Date() : info.validatedAt,
      expiresAt: result.expiresAt ?? null,
      owner: result.owner ?? null,
      reason: valid ? null : expired ? 'License has expired.' : (result.reason ?? 'License rejected.'),
    };
  } catch (error) {
    // Transient remote failures must not kill an already validated bot.
    if (info.valid && provider.name === 'remote') {
      logger.warn(`[LICENSE] Re-validation failed, keeping previous state: ${errorMessage(error)}`);
      return true;
    }
    info = { ...info, valid: false, provider: provider.name, reason: `License check failed: ${errorMessage(error)}` };
  }

  if (info.valid) logger.info('[LICENSE] License validated successfully.');
  else logger.error(`[LICENSE] ${info.reason}`);
  return info.valid;
}

export function isLicenseValid(): boolean {
  return info.valid;
}

export function getLicenseInfo(): LicenseInfo {
  return { ...info };
}

/** Persists the (masked) license record. Called once MongoDB is up. */
export async function persistLicenseRecord(): Promise<void> {
  const key = config.license.key;
  if (!key || !info.valid) return;
  const keyHash = crypto.createHash('sha256').update(key).digest('hex');
  await LicenseModel.updateOne(
    { keyHash },
    {
      $set: {
        maskedKey: info.maskedKey,
        provider: info.provider,
        validatedAt: info.validatedAt ?? new Date(),
        expiresAt: info.expiresAt,
        owner: info.owner,
      },
    },
    { upsert: true },
  );
}

/** Remote licenses are re-checked periodically; an invalidated license stops the bot. */
export function startLicenseRevalidation(onInvalid: () => void): void {
  if (!config.license.apiUrl) return;
  registerInterval('license-revalidation', 6 * 3600_000, async () => {
    const ok = await validateLicense();
    if (!ok) onInvalid();
  });
}
