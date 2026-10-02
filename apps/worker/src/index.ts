import { writeFile } from 'node:fs/promises';
import { Redis } from 'ioredis';
import { databasePool } from '../../../packages/db/src/index';
import { pruneIdempotencyRecords } from '../../../packages/domain/src/idempotent';
import { pruneExpiredPreviews } from '../../../packages/domain/src/transactions';

// M1 process foundation. Business queues are implemented at M3/M5; this process verifies the shared
// infrastructure, exposes a heartbeat for Compose readiness and expires Idempotency-Key records and write previews.
const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
let stopping = false;
async function heartbeat() {
  try {
    await databasePool().query('SELECT id FROM ledgers LIMIT 1');
    await redis.ping();
    await writeFile('/tmp/ledger-worker-health', String(Date.now()));
  } catch { console.error('Worker dependencies unavailable'); }
}
async function housekeeping() {
  try {
    const removed = await pruneIdempotencyRecords(), previews = await pruneExpiredPreviews();
    if (removed || previews) console.log(JSON.stringify({ task: 'housekeeping.prune', idempotencyRecords: removed, previews }));
  } catch (error) {
    // Retried on the next hourly run; a failure right after startup usually means MySQL is still starting.
    console.error(JSON.stringify({ task: 'housekeeping.prune', status: 'failed', code: (error as { code?: string; cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code ?? 'unknown' }));
  }
}
await heartbeat();
await housekeeping();
const timers = [setInterval(heartbeat, 10000), setInterval(housekeeping, 60 * 60 * 1000)];
async function stop() {
  if (stopping) return;
  stopping = true;
  timers.forEach(clearInterval);
  await redis.quit();
  await databasePool().end();
}
process.on('SIGTERM', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });
console.log('Ledger worker ready (infrastructure heartbeat)');
