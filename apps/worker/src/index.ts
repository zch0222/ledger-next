import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Redis } from 'ioredis';
import { databasePool } from '../../../packages/db/src/index';
import { closeRedis } from '../../../packages/db/src/redis';
import { processHistoryRequests, processRefreshJobs, pruneMinuteBatches, refreshLatest } from '../../../packages/domain/src/fx';
import { fxConfig } from '../../../packages/domain/src/fx-provider';
import { pruneIdempotencyRecords } from '../../../packages/domain/src/idempotent';
import { pruneExpiredPreviews } from '../../../packages/domain/src/transactions';
import { startQueue } from './queue';

// Background process: infrastructure heartbeat, housekeeping, the FX schedule (M3-FX) and the outbox queue (imports, exports). It never serves HTTP and
// does not depend on the web process being alive.
const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
const workerId = randomUUID();
const fx = fxConfig();
const FX_POLL_MS = Number(process.env.FX_POLL_SECONDS || 60) * 1000;
let stopping = false;
const log = (entry: Record<string, unknown>) => console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));
const errorCode = (error: unknown) => (error as { cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code ?? (error instanceof Error ? error.name : 'unknown');

async function heartbeat() {
  try {
    await databasePool().query('SELECT id FROM ledgers LIMIT 1');
    await redis.ping();
    await writeFile('/tmp/ledger-worker-health', String(Date.now()));
  } catch { console.error('Worker dependencies unavailable'); }
}
async function housekeeping() {
  try {
    const removed = await pruneIdempotencyRecords(), previews = await pruneExpiredPreviews(), batches = await pruneMinuteBatches(fx.provider);
    if (removed || previews || batches) log({ task: 'housekeeping.prune', idempotencyRecords: removed, previews, fxBatches: batches });
  } catch (error) {
    // Retried on the next hourly run; a failure right after startup usually means MySQL is still starting.
    console.error(JSON.stringify({ task: 'housekeeping.prune', status: 'failed', code: errorCode(error) }));
  }
}

// One batched provider request per interval across all workers: a Redis lease elects the fetcher. Without Redis the
// fetch still runs; duplicate batches collide on the (provider, kind, source_at) key and are ignored.
let fxBackoffUntil = 0;
async function fxLatest() {
  if (!fx.url || Date.now() < fxBackoffUntil) return;
  try {
    const lease = await redis.set('fx:lease', workerId, 'PX', Math.max(FX_POLL_MS - 500, 1000), 'NX').catch(() => 'OK');
    if (lease !== 'OK') return;
    const result = await refreshLatest(fx);
    if (!result.ok) {
      if (result.retryAfterSeconds) fxBackoffUntil = Date.now() + result.retryAfterSeconds * 1000;
      log({ task: 'fx.latest', status: 'failed', reason: result.error, retryAfterSeconds: result.retryAfterSeconds ?? null });
    } else if (result.status !== 'unchanged') log({ task: 'fx.latest', status: result.status, batchId: result.batchId });
  } catch (error) { console.error(JSON.stringify({ task: 'fx.latest', status: 'error', code: errorCode(error) })); }
}
async function fxJobs() {
  if (!fx.url) return;
  try {
    const history = await processHistoryRequests(fx);
    if (history.claimed) log({ task: 'fx.history', ...history });
    const job = await processRefreshJobs(fx);
    if (job) log({ task: 'fx.refresh', jobId: job });
  } catch (error) { console.error(JSON.stringify({ task: 'fx.jobs', status: 'error', code: errorCode(error) })); }
}

await heartbeat();
await housekeeping();
const queue = startQueue(process.env.REDIS_URL!, log);
void fxLatest();
const timers = [setInterval(heartbeat, 10000), setInterval(housekeeping, 60 * 60 * 1000), setInterval(fxLatest, FX_POLL_MS), setInterval(fxJobs, 5000)];
async function stop() {
  if (stopping) return;
  stopping = true;
  timers.forEach(clearInterval);
  await queue.close();
  await redis.quit();
  await closeRedis();
  await databasePool().end();
}
process.on('SIGTERM', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });
log({ task: 'worker.ready', fxProvider: fx.url ? fx.provider : 'not configured', fxPollSeconds: FX_POLL_MS / 1000 });
