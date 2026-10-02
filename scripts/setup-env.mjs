import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const secret = () => randomBytes(32).toString('hex');
const password = secret();
writeFileSync('.env', `MYSQL_DATABASE=ledger\nMYSQL_USER=ledger\nMYSQL_PASSWORD=${password}\nMYSQL_ROOT_PASSWORD=${secret()}\nBETTER_AUTH_SECRET=${secret()}\nAPP_URL=http://localhost:3000\nWEB_PORT=3000\nDATABASE_URL=mysql://ledger:${password}@localhost:3306/ledger\nREDIS_URL=redis://localhost:6379\n`, { flag: 'wx', mode: 0o600 });
console.log('Created .env with random local credentials. Existing files are never overwritten.');
