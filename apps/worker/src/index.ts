import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Redis } from 'ioredis';
import { databasePool } from '../../../packages/db/src/index';
import { closeRedis } from '../../../packages/db/src/redis';
import {
  processHistoryRequests,
  processRefreshJobs,
  pruneMinuteBatches,
  refreshLatest,
} from '../../../packages/domain/src/fx';
import { fxConfig } from '../../../packages/domain/src/fx-provider';
import { pruneIdempotencyRecords } from '../../../packages/domain/src/idempotent';
import { maintainSubscriptions } from '../../../packages/domain/src/subscriptions';
import { claimDue, sweepStuck } from '../../../packages/domain/src/deliveries';
import { fxAlerts, planDueRules } from '../../../packages/domain/src/reminders';
import { pruneExpiredPreviews } from '../../../packages/domain/src/transactions';
import { startQueue } from './queue';

// Background process: infrastructure heartbeat, housekeeping, the FX schedule (M3-FX), reminders (M5) and the outbox queue. It never serves HTTP and
// does not depend on the web process being alive.
const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
const workerId = randomUUID();
const fx = fxConfig();
const FX_POLL_MS = Number(process.env.FX_POLL_SECONDS || 60) * 1000;
let stopping = false;
const log = (entry: Record<string, unknown>) => console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));
const errorCode = (error: unknown) =>
  (error as { cause?: { code?: string } })?.cause?.code ??
  (error as { code?: string })?.code ??
  (error instanceof Error ? error.name : 'unknown');

async function heartbeat() {
  try {
    await databasePool().query('SELECT id FROM ledgers LIMIT 1');
    await redis.ping();
    await writeFile('/tmp/ledger-worker-health', String(Date.now()));
  } catch {
    console.error('Worker dependencies unavailable');
  }
}
async function housekeeping() {
  try {
    const removed = await pruneIdempotencyRecords();
    const previews = await pruneExpiredPreviews();
    const batches = await pruneMinuteBatches(fx.provider);
    if (removed || previews || batches) {
      log({ task: 'housekeeping.prune', idempotencyRecords: removed, previews, fxBatches: batches });
    }
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
      log({
        task: 'fx.latest',
        status: 'failed',
        reason: result.error,
        retryAfterSeconds: result.retryAfterSeconds ?? null,
      });
    } else if (result.status !== 'unchanged') {
      log({ task: 'fx.latest', status: result.status, batchId: result.batchId });
      const alerts = await fxAlerts();
      if (alerts) log({ task: 'reminders.fx', created: alerts });
    }
  } catch (error) {
    console.error(JSON.stringify({ task: 'fx.latest', status: 'error', code: errorCode(error) }));
  }
}
async function fxJobs() {
  if (!fx.url) return;
  try {
    const history = await processHistoryRequests(fx);
    if (history.claimed) log({ task: 'fx.history', ...history });
    const job = await processRefreshJobs(fx);
    if (job) log({ task: 'fx.refresh', jobId: job });
  } catch (error) {
    console.error(JSON.stringify({ task: 'fx.jobs', status: 'error', code: errorCode(error) }));
  }
}

// Subscriptions: materialize bills through the horizon, store due / overdue, end pauses (M4-SUBS).
async function subscriptionsTick() {
  try {
    const result = await maintainSubscriptions();
    if (result.created || result.resumed) log({ task: 'subscriptions.maintain', ...result });
  } catch (error) {
    console.error(JSON.stringify({ task: 'subscriptions.maintain', status: 'error', code: errorCode(error) }));
  }
}

// Reminders (M5): plan rules near their horizon, claim due deliveries and hand them to the queue, recover stuck ones.
// The tick bounds the dispatch delay (TECHNICAL_DESIGN §7.3: p95 ≤ 60 s from scheduled_at to the worker starting).
const NOTIFY_TICK_MS = Number(process.env.NOTIFY_TICK_SECONDS || 10) * 1000;
let notifying = false;
async function notifyTick() {
  if (notifying || stopping) return;
  notifying = true;
  try {
    const planned = await planDueRules();
    if (planned.created) log({ task: 'reminders.plan', ...planned });
    const stuck = await sweepStuck();
    if (stuck.requeued || stuck.unknown) log({ task: 'reminders.sweep', ...stuck });
    for (let claimed = await claimDue(); claimed.length; claimed = await claimDue()) {
      await queue.publishDeliveries(claimed);
      log({ task: 'reminders.dispatch', claimed: claimed.length });
      if (claimed.length < 50) break;
    }
  } catch (error) {
    console.error(JSON.stringify({ task: 'reminders.tick', status: 'error', code: errorCode(error) }));
  } finally {
    notifying = false;
  }
}

await heartbeat();
await housekeeping();
void subscriptionsTick();
const queue = startQueue(process.env.REDIS_URL!, log);
void fxLatest();
void notifyTick();
const timers = [
  setInterval(notifyTick, NOTIFY_TICK_MS),
  setInterval(heartbeat, 10000),
  setInterval(housekeeping, 60 * 60 * 1000),
  setInterval(fxLatest, FX_POLL_MS),
  setInterval(fxJobs, 5000),
  setInterval(subscriptionsTick, Number(process.env.SUBSCRIPTION_TICK_SECONDS || 600) * 1000),
];
async function stop() {
  if (stopping) return;
  stopping = true;
  timers.forEach(clearInterval);
  await queue.close();
  await redis.quit();
  await closeRedis();
  await databasePool().end();
}
process.on('SIGTERM', () => {
  void stop();
});
process.on('SIGINT', () => {
  void stop();
});
log({
  task: 'worker.ready',
  fxProvider: fx.url ? fx.provider : 'not configured',
  fxPollSeconds: FX_POLL_MS / 1000,
  notifyTickSeconds: NOTIFY_TICK_MS / 1000,
  smtp: process.env.SMTP_URL ? 'configured' : 'not configured',
});
