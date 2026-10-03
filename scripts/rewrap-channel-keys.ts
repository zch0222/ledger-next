// Usage: pnpm channels:rewrap — after prepending a new key to LEDGER_ENCRYPTION_KEYS (keep the old key until this
// reports moved == total), re-wraps every channel's data key with the new master key. Prints counts only.
import { databasePool } from '@ledger/db/index';
import { rewrapChannelKeys } from '@ledger/domain/notify-channels';

try {
  console.log(JSON.stringify(await rewrapChannelKeys()));
} finally {
  await databasePool().end();
}
