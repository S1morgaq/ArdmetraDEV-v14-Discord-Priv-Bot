import 'dotenv/config';
import { generateLicenseKey } from '../src/utils/licenseKey';

const secret = process.env.LICENSE_SECRET?.trim();
if (!secret) {
  console.error('Set LICENSE_SECRET in .env first (any long random string).');
  process.exit(1);
}

const count = Math.max(1, Math.min(50, Number(process.argv[2] ?? 1) || 1));
for (let i = 0; i < count; i++) console.log(generateLicenseKey(secret));
