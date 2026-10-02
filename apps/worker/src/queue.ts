import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { expireExports, runExport, stalledExportJobs } from '../../../packages/domain/src/exports';
import { commitImport, importEventFor, revertImport, stalledImportJobs, validateImport } from '../../../packages/domain/src/imports';
import { dispatchOutbox, enqueueEvent, type OutboxEvent } from '../../../packages/domain/src/outbox';

// Outbox → BullMQ → handlers (TECHNICAL_DESIGN §2.1). BullMQ job ids are outbox ids, so a re-published event is
// deduplicated by the queue while it exists; handlers are idempotent for the rest.
export const QUEUE = 'ledger-events';
type Handler = (event: OutboxEvent) => Promise<unknown>;
const handlers: Record<string, Handler> = {
  'import.validate': e => validateImport(String(e.payload.importJobId)),
  'import.commit': e => commitImport(String(e.payload.importJobId)),
  'import.revert': e => revertImport(String(e.payload.importJobId)),
  'export.run': e => runExport(String(e.payload.exportJobId)),
};
export function registerHandler(type: string, handler: Handler) { handlers[type] = handler; }

export function startQueue(redisUrl: string, log: (entry: Record<string, unknown>) => void) {
  // BullMQ does not close connections it was given; both are quit in close().
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null }), workerConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE, { connection, defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: { age: 3600, count: 5000 }, removeOnFail: { age: 7 * 86400 } } });
  const worker = new Worker(QUEUE, async (job: Job<OutboxEvent>) => {
    const handler = handlers[job.name];
    if (!handler) return 'ignored'; // informational events (e.g. transaction.created) have no consumer yet
    const started = Date.now();
    const result = await handler(job.data);
    log({ task: 'queue.job', type: job.name, eventId: job.id, result: typeof result === 'string' ? result : 'ok', ms: Date.now() - started });
    return result;
  }, { connection: workerConnection, concurrency: 4 });
  worker.on('failed', (job, error) => log({ task: 'queue.job', type: job?.name, eventId: job?.id, status: 'failed', attempt: job?.attemptsMade, code: (error as { code?: string })?.code ?? error.name }));
  const publish = (events: OutboxEvent[]) => queue.addBulk(events.map(e => ({ name: e.type, data: e, opts: { jobId: e.id } }))).then(() => undefined);
  async function dispatch() {
    try { while ((await dispatchOutbox(publish)) > 0) { /* drain */ } }
    catch (error) { log({ task: 'outbox.dispatch', status: 'failed', code: (error as { code?: string })?.code ?? (error as Error).name }); }
  }
  async function sweep() {
    try {
      for (const job of await stalledImportJobs()) await enqueueEvent(job.ledgerId, importEventFor(job.status), { importJobId: job.id });
      for (const job of await stalledExportJobs()) await enqueueEvent(job.ledgerId, 'export.run', { exportJobId: job.id });
      const expired = await expireExports();
      if (expired) log({ task: 'exports.expire', expired });
    } catch (error) { log({ task: 'queue.sweep', status: 'failed', code: (error as { code?: string })?.code ?? (error as Error).name }); }
  }
  const timers = [setInterval(dispatch, 1000), setInterval(sweep, 60_000)];
  return {
    async close() {
      timers.forEach(clearInterval);
      await worker.close();
      await queue.close();
      await Promise.all([connection.quit(), workerConnection.quit()]);
    },
  };
}
