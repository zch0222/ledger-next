import { randomBytes } from 'node:crypto';
import { chownSync, statSync, writeFileSync } from 'node:fs';
const secret = () => randomBytes(32).toString('hex');
const password = secret();
writeFileSync('.env', `MYSQL_DATABASE=ledger\nMYSQL_USER=ledger\nMYSQL_PASSWORD=${password}\nMYSQL_ROOT_PASSWORD=${secret()}\nBETTER_AUTH_SECRET=${secret()}\nLEDGER_ENCRYPTION_KEYS=k1:${randomBytes(32).toString('base64')}\nAPP_URL=http://localhost:3000\nWEB_PORT=3000\nDATABASE_URL=mysql://ledger:${password}@localhost:3306/ledger\nREDIS_URL=redis://localhost:6379\n`, { flag: 'wx', mode: 0o600 });
// Run as root in the toolbox container (compose.tools.yaml): hand the file to the checkout's owner so Compose on a
// Linux host can still read it. Docker Desktop mounts map ownership themselves and may refuse chown.
if (process.getuid?.() === 0) {
  const { uid, gid } = statSync('.');
  try { if (uid !== 0) chownSync('.env', uid, gid); } catch { /* ownership already belongs to the host user */ }
}
console.log('Created .env with random local credentials. Existing files are never overwritten.');
