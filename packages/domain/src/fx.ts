import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { ENABLED_CURRENCIES } from '../../contracts/src/common';
import { ExchangeRateQuery, ManualRateRecordCreate, RefreshJobCreate } from '../../contracts/src/planning';
import { database, type Executor, type Tx } from '../../db/src/index';
import { cacheGet, cacheSet, redis } from '../../db/src/redis';
import { currencies, fxBatches, fxFetchStatus, fxHistoryRequests, fxRates, fxRefreshJobs, manualRateRecords } from '../../db/src/schema';
import { ledgerAccess } from './access';
import { audit, bumpDataVersion } from './audit';
import { fetchFixer, fxConfig, ProviderError, type FxConfig, type ProviderQuote } from './fx-provider';
import type { AuthContext, Keyset } from './identity';
import { parseRate, sum } from './money';
import { DomainError } from './policy';

import { crossFromBatch, DELAYED_MS, FRESH_MS, HISTORICAL_FRESH_MS, HISTORY_WINDOW_MS, historicalFreshness, jumpedCurrency, LIVE_WINDOW_MS, liveFreshness, type Freshness } from './fx-pure';

export { crossFromBatch, DELAYED_MS, FRESH_MS, HISTORY_WINDOW_MS, historicalFreshness, jumpedCurrency, LIVE_WINDOW_MS, liveFreshness, type Freshness };
type Db = Executor | Tx;

type Batch = { id: string; provider: string; pivot: string; sourceAt: Date; fetchedAt: Date; rates: Record<string, string> };
const LATEST_KEY = (provider: string) => `fx:latest:${provider}`;

async function withRates(db: Db, rows: (typeof fxBatches.$inferSelect)[]): Promise<Batch[]> {
  if (!rows.length) return [];
  const rates = await db.select().from(fxRates).where(inArray(fxRates.batchId, rows.map(r => r.id)));
  return rows.map(row => ({
    id: row.id, provider: row.provider, pivot: row.pivotCurrency, sourceAt: row.sourceAt, fetchedAt: row.fetchedAt,
    rates: Object.fromEntries(rates.filter(r => r.batchId === row.id).map(r => [r.quoteCurrency, sum([r.rate]).toFixed()])),
  }));
}
async function latestAcceptedFromDb(db: Db, provider: string) {
  const rows = await db.select().from(fxBatches).where(and(eq(fxBatches.provider, provider), eq(fxBatches.quality, 'accepted'))).orderBy(desc(fxBatches.sourceAt)).limit(1);
  return (await withRates(db, rows))[0] ?? null;
}
/** Latest accepted batch: Redis pointer first (shared market data, TTL 60 s), MySQL when Redis is cold or down. */
export async function latestBatch(db: Db, provider = fxConfig().provider): Promise<Batch | null> {
  const cached = await cacheGet(LATEST_KEY(provider));
  if (cached) {
    try { const b = JSON.parse(cached); return { ...b, sourceAt: new Date(b.sourceAt), fetchedAt: new Date(b.fetchedAt) }; } catch { /* fall through */ }
  }
  const batch = await latestAcceptedFromDb(db, provider);
  if (batch) await cacheSet(LATEST_KEY(provider), JSON.stringify(batch), 60);
  return batch;
}
/**
 * Batch in force at a past instant: the newest one quoted at or before it (within 7 days). When that is older than a
 * daily reference rate allows, the provider's historical rate for the instant's UTC date is used instead — its
 * timestamp is end-of-day, but it is the published rate for that business date.
 */
async function batchAt(db: Db, provider: string, at: Date): Promise<{ batch: Batch; gapMs: number } | null> {
  const rows = await db.select().from(fxBatches)
    .where(and(eq(fxBatches.provider, provider), eq(fxBatches.quality, 'accepted'), lte(fxBatches.sourceAt, at), gte(fxBatches.sourceAt, new Date(at.getTime() - HISTORY_WINDOW_MS))))
    .orderBy(desc(fxBatches.sourceAt)).limit(1);
  const [before] = await withRates(db, rows);
  const gapMs = before ? at.getTime() - before.sourceAt.getTime() : Infinity;
  if (gapMs > HISTORICAL_FRESH_MS) {
    const daily = await db.select().from(fxBatches)
      .where(and(eq(fxBatches.provider, provider), eq(fxBatches.quality, 'accepted'), eq(fxBatches.kind, 'historical'), eq(fxBatches.effectiveDate, at.toISOString().slice(0, 10)))).limit(1);
    const [sameDay] = await withRates(db, daily);
    if (sameDay) return { batch: sameDay, gapMs: 0 };
  }
  return before ? { batch: before, gapMs } : null;
}
async function failureStreak(db: Db, provider: string) {
  const [row] = await db.select({ failures: fxFetchStatus.consecutiveFailures }).from(fxFetchStatus).where(eq(fxFetchStatus.provider, provider));
  return row?.failures ?? 0;
}

export type Quote =
  | { freshness: Exclude<Freshness, 'missing'>; value: string; source: string; batchId: string | null; sourceAt: Date | null; fetchedAt: Date | null }
  | { freshness: 'missing'; value: null; source: string | null; batchId: null; sourceAt: null; fetchedAt: null };
const missing = (source: string | null = null): Quote => ({ freshness: 'missing', value: null, source, batchId: null, sourceAt: null, fetchedAt: null });

/**
 * Requests a daily historical batch for the worker; never fetched inside a web request. Written on its own connection,
 * not the caller's transaction: a preview that fails with FX_RATE_MISSING rolls back, but the request must remain.
 */
export async function requestHistory(provider: string, date: string) {
  const now = new Date();
  await database().insert(fxHistoryRequests).values({ provider, effectiveDate: date, status: 'pending', createdAt: now, updatedAt: now })
    .onDuplicateKeyUpdate({ set: { status: sql`IF(${fxHistoryRequests.status} = 'failed', 'pending', ${fxHistoryRequests.status})`, updatedAt: sql`IF(${fxHistoryRequests.status} = 'failed', ${now}, ${fxHistoryRequests.updatedAt})` } });
}

/**
 * Reference rate for converting `from` into `to` at an instant. Live instants use the latest accepted batch and its
 * source age; earlier instants use the batch in force then (historical backfill). A gap queues a history request.
 */
export async function quote(db: Db, from: string, to: string, at: Date, now = new Date(), config: FxConfig = fxConfig()): Promise<Quote> {
  if (from === to) return { freshness: 'fresh', value: '1', source: 'identity', batchId: null, sourceAt: null, fetchedAt: null };
  const live = at.getTime() >= now.getTime() - LIVE_WINDOW_MS;
  const found = live ? await latestBatch(db, config.provider).then(batch => batch && { batch, gapMs: 0 }) : await batchAt(db, config.provider, at);
  const value = found && crossFromBatch(found.batch.rates, found.batch.pivot, from, to);
  const freshness = !found || !value ? 'missing' : live ? liveFreshness(now.getTime() - found.batch.sourceAt.getTime(), await failureStreak(db, config.provider), config.staleFailures) : historicalFreshness(found.gapMs);
  // A gap in history is filled asynchronously by the worker; a retry later finds the day's rate.
  const day = at.toISOString().slice(0, 10);
  if (!live && freshness !== 'fresh' && day < now.toISOString().slice(0, 10)) await requestHistory(config.provider, day);
  if (!found || !value || freshness === 'missing') return missing(config.provider);
  const { batch } = found;
  return { freshness, value, source: batch.provider, batchId: batch.id, sourceAt: batch.sourceAt, fetchedAt: batch.fetchedAt };
}

/** Newest manual rate of a ledger effective on or before `date`. */
export async function manualRate(db: Db, ledgerId: string, from: string, to: string, date: string) {
  const [row] = await db.select().from(manualRateRecords)
    .where(and(eq(manualRateRecords.ledgerId, ledgerId), eq(manualRateRecords.baseCurrency, from), eq(manualRateRecords.quoteCurrency, to), lte(manualRateRecords.effectiveDate, date)))
    .orderBy(desc(manualRateRecords.effectiveDate), desc(manualRateRecords.createdAt)).limit(1);
  return row ? { value: sum([row.rate]).toFixed(), effectiveDate: row.effectiveDate, reason: row.reason, id: row.id } : null;
}

// ---------- ingestion (worker) ----------

const duplicate = (error: unknown) => [error, (error as { cause?: unknown })?.cause].some(e => (e as { code?: string })?.code === 'ER_DUP_ENTRY');
export async function activeCurrencies(db: Db = database()) {
  return (await db.select({ code: currencies.code }).from(currencies).where(eq(currencies.enabled, true))).map(r => r.code).sort();
}

/**
 * Stores one provider batch unchanged. A latest batch that jumps beyond the threshold is kept as "suspect" and not
 * served, unless the previous two batches were suspects consistent with it (the market really moved).
 */
export async function ingestBatch(q: ProviderQuote, kind: 'latest' | 'historical', config: FxConfig = fxConfig(), now = new Date()) {
  const result = await database().transaction(async tx => {
    let quality: 'accepted' | 'suspect' = 'accepted', note: string | null = null;
    if (kind === 'latest') {
      const accepted = await latestAcceptedFromDb(tx, config.provider);
      if (accepted && accepted.sourceAt.getTime() >= q.sourceAt.getTime()) return { status: 'unchanged' as const, batchId: accepted.id };
      const jumped = accepted && jumpedCurrency(accepted.rates, q.rates, config.jumpThreshold);
      if (jumped) {
        const recent = await withRates(tx, await tx.select().from(fxBatches).where(and(eq(fxBatches.provider, config.provider), eq(fxBatches.kind, 'latest'), gt(fxBatches.sourceAt, accepted.sourceAt))).orderBy(desc(fxBatches.sourceAt)).limit(2));
        const confirmed = recent.length === 2 && recent.every(b => !jumpedCurrency(b.rates, q.rates, config.jumpThreshold));
        if (!confirmed) { quality = 'suspect'; note = `${jumped} 变动超过 ${config.jumpThreshold}，待核验`; }
        else note = `${jumped} 连续三批一致，确认行情变动`;
      }
    }
    const id = randomUUID();
    try {
      await tx.insert(fxBatches).values({ id, provider: config.provider, pivotCurrency: q.pivot, kind, sourceAt: q.sourceAt, fetchedAt: now, effectiveDate: q.date, quality, note, createdAt: now });
    } catch (error) {
      if (duplicate(error)) return { status: 'unchanged' as const, batchId: null };
      throw error;
    }
    await tx.insert(fxRates).values(Object.entries(q.rates).map(([quoteCurrency, rate]) => ({ batchId: id, quoteCurrency, rate })));
    return { status: quality, batchId: id };
  });
  await recordAttempt(config.provider, null, now);
  if (kind === 'latest' && result.status === 'accepted') {
    const fresh = await latestAcceptedFromDb(database(), config.provider);
    if (fresh) await cacheSet(LATEST_KEY(config.provider), JSON.stringify(fresh), 60);
    try { await redis()?.incr('fx:version'); } catch { /* version only tags caches */ }
  }
  return result;
}

/** Success resets the failure streak; failures keep the last error without secrets. */
async function recordAttempt(provider: string, error: ProviderError | null, now = new Date()) {
  const lastError = error ? `${error.kind}: ${error.message}`.slice(0, 200) : null;
  await database().insert(fxFetchStatus).values({ provider, lastAttemptAt: now, lastSuccessAt: error ? null : now, consecutiveFailures: error ? 1 : 0, lastError, updatedAt: now })
    .onDuplicateKeyUpdate({ set: error
      ? { lastAttemptAt: now, consecutiveFailures: sql`${fxFetchStatus.consecutiveFailures} + 1`, lastError, updatedAt: now }
      : { lastAttemptAt: now, lastSuccessAt: now, consecutiveFailures: 0, lastError: null, updatedAt: now } });
}

/** One batched request for every active currency; failures are recorded, never thrown to the scheduler. */
export async function refreshLatest(config: FxConfig = fxConfig(), fetcher: typeof fetch = fetch, now = new Date()) {
  try {
    const q = await fetchFixer(config, 'latest', await activeCurrencies(), fetcher);
    return { ok: true as const, ...(await ingestBatch(q, 'latest', config, now)) };
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    await recordAttempt(config.provider, error, now);
    return { ok: false as const, error: error.kind, retryAfterSeconds: error.retryAfterSeconds };
  }
}

/** Claims pending history requests (SKIP LOCKED, so several workers never fetch the same day) and backfills them. */
export async function processHistoryRequests(config: FxConfig = fxConfig(), fetcher: typeof fetch = fetch, limit = 5) {
  const claimed = await database().transaction(async tx => {
    const rows = await tx.select().from(fxHistoryRequests)
      .where(and(eq(fxHistoryRequests.provider, config.provider), eq(fxHistoryRequests.status, 'pending'), lt(fxHistoryRequests.attempts, 5)))
      .orderBy(asc(fxHistoryRequests.updatedAt)).limit(limit).for('update', { skipLocked: true });
    for (const row of rows) await tx.update(fxHistoryRequests).set({ attempts: row.attempts + 1, updatedAt: new Date() }).where(and(eq(fxHistoryRequests.provider, row.provider), eq(fxHistoryRequests.effectiveDate, row.effectiveDate)));
    return rows;
  });
  let done = 0;
  for (const row of claimed) {
    try {
      await ingestBatch(await fetchFixer(config, row.effectiveDate, await activeCurrencies(), fetcher), 'historical', config);
      await database().update(fxHistoryRequests).set({ status: 'done', lastError: null, updatedAt: new Date() }).where(and(eq(fxHistoryRequests.provider, row.provider), eq(fxHistoryRequests.effectiveDate, row.effectiveDate)));
      done++;
    } catch (error) {
      const message = error instanceof ProviderError ? `${error.kind}: ${error.message}` : 'internal error';
      await database().update(fxHistoryRequests).set({ status: row.attempts + 1 >= 5 ? 'failed' : 'pending', lastError: message.slice(0, 200), updatedAt: new Date() })
        .where(and(eq(fxHistoryRequests.provider, row.provider), eq(fxHistoryRequests.effectiveDate, row.effectiveDate)));
    }
  }
  return { claimed: claimed.length, done };
}

/** Runs queued administrator refresh jobs. */
export async function processRefreshJobs(config: FxConfig = fxConfig(), fetcher: typeof fetch = fetch) {
  const job = await database().transaction(async tx => {
    const [row] = await tx.select().from(fxRefreshJobs).where(eq(fxRefreshJobs.status, 'queued')).orderBy(asc(fxRefreshJobs.createdAt)).limit(1).for('update', { skipLocked: true });
    if (row) await tx.update(fxRefreshJobs).set({ status: 'running' }).where(eq(fxRefreshJobs.id, row.id));
    return row;
  });
  if (!job) return null;
  const result = await refreshLatest(config, fetcher);
  await database().update(fxRefreshJobs).set({ status: result.ok ? 'succeeded' : 'failed', error: result.ok ? null : result.error, completedAt: new Date() }).where(eq(fxRefreshJobs.id, job.id));
  return job.id;
}

/** Keeps one minute batch per UTC day after `keepDays`; booked amounts hold their own copy in fx_snapshots. */
export async function pruneMinuteBatches(provider = fxConfig().provider, keepDays = 35, now = new Date()) {
  const cutoff = new Date(now.getTime() - keepDays * 86400_000);
  const old = await database().select({ id: fxBatches.id, day: fxBatches.effectiveDate, sourceAt: fxBatches.sourceAt }).from(fxBatches)
    .where(and(eq(fxBatches.provider, provider), eq(fxBatches.kind, 'latest'), lt(fxBatches.sourceAt, cutoff))).orderBy(asc(fxBatches.effectiveDate), desc(fxBatches.sourceAt)).limit(5000);
  const keep = new Set<string>(), drop: string[] = [];
  for (const row of old) { if (keep.has(row.day)) drop.push(row.id); else keep.add(row.day); }
  if (!drop.length) return 0;
  await database().transaction(async tx => {
    await tx.delete(fxRates).where(inArray(fxRates.batchId, drop));
    await tx.delete(fxBatches).where(inArray(fxBatches.id, drop));
  });
  return drop.length;
}

// ---------- REST use cases ----------

const iso = (d: Date | null) => d?.toISOString() ?? null;
export async function getExchangeRates(query: unknown, now = new Date()) {
  const q = ExchangeRateQuery.parse(query);
  const quotes = [...new Set(q.quotes.split(','))];
  const unknown = quotes.filter(code => !(ENABLED_CURRENCIES as readonly string[]).includes(code));
  if (unknown.length) throw new DomainError(422, 'UNSUPPORTED_CURRENCY', `不支持的币种：${unknown.join(', ')}`);
  const asOf = q.asOf ? new Date(q.asOf) : now;
  if (asOf.getTime() > now.getTime() + 60_000) throw new DomainError(422, 'INVALID_AS_OF', 'asOf 不能晚于当前时间');
  const db = database();
  const rates = [];
  for (const code of quotes) {
    const r = await quote(db, q.base, code, asOf, now);
    rates.push({ quote: code, value: r.value, sourceAt: iso(r.sourceAt), fetchedAt: iso(r.fetchedAt), freshness: r.freshness, source: r.source });
  }
  return { base: q.base, asOf: asOf.toISOString(), rates };
}

const presentManual = (row: typeof manualRateRecords.$inferSelect) => ({ id: row.id, base: row.baseCurrency, quote: row.quoteCurrency, value: sum([row.rate]).toFixed(), effectiveDate: row.effectiveDate, reason: row.reason, createdBy: row.createdBy, createdAt: row.createdAt.toISOString() });
export async function createManualRateRecord(ctx: AuthContext, ledgerId: string, input: unknown, db: Executor = database()) {
  const data = ManualRateRecordCreate.parse(input);
  if (data.base === data.quote) throw new DomainError(422, 'SAME_CURRENCY', '人工汇率的两个币种不能相同');
  const rate = parseRate(data.value);
  return db.transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const row = { id: randomUUID(), ledgerId, baseCurrency: data.base, quoteCurrency: data.quote, rate, effectiveDate: data.effectiveDate, reason: data.reason, createdBy: ctx.userId, createdAt: new Date() };
    await tx.insert(manualRateRecords).values(row);
    await audit(tx, ctx, ledgerId, 'manual_rate.created', row.id);
    await bumpDataVersion(tx, ledgerId); // reports that excluded rows for a missing rate must recompute
    return presentManual(row);
  });
}
export async function listManualRateRecords(ctx: AuthContext, ledgerId: string, page: Keyset) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const after = page.after && or(lt(manualRateRecords.createdAt, new Date(page.after[0])), and(eq(manualRateRecords.createdAt, new Date(page.after[0])), lt(manualRateRecords.id, page.after[1])));
  const rows = await database().select().from(manualRateRecords).where(and(eq(manualRateRecords.ledgerId, ledgerId), after)).orderBy(desc(manualRateRecords.createdAt), desc(manualRateRecords.id)).limit(page.limit + 1);
  return rows.map(row => ({ ...presentManual(row), createdAtDate: row.createdAt }));
}

const presentJob = (row: typeof fxRefreshJobs.$inferSelect) => ({ id: row.id, status: row.status, createdAt: row.createdAt.toISOString(), completedAt: iso(row.completedAt) });
/** System administrators are configured by e-mail (LEDGER_ADMIN_EMAILS); ledger owners are not administrators. */
export function isAdministrator(email: string, env: Record<string, string | undefined> = process.env) {
  return (env.LEDGER_ADMIN_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}
/** Deduplicated: a queued / running job, or one finished in the last 60 s, is returned instead of a new one. */
export async function createRefreshJob(ctx: AuthContext & { email: string }, input: unknown) {
  const data = RefreshJobCreate.parse(input);
  if (!isAdministrator(ctx.email)) throw new DomainError(403, 'FORBIDDEN', '只有系统管理员可以触发汇率刷新');
  return database().transaction(async tx => {
    await tx.execute(sql`SELECT GET_LOCK('ledger_fx_refresh', 5)`);
    try {
      const [existing] = await tx.select().from(fxRefreshJobs)
        .where(or(inArray(fxRefreshJobs.status, ['queued', 'running']), gte(fxRefreshJobs.completedAt, new Date(Date.now() - 60_000)))).orderBy(desc(fxRefreshJobs.createdAt)).limit(1);
      if (existing) return { job: presentJob(existing), created: false };
      const row = { id: randomUUID(), status: 'queued' as const, reason: data.reason ?? null, requestedBy: ctx.userId, error: null, createdAt: new Date(), completedAt: null };
      await tx.insert(fxRefreshJobs).values(row);
      return { job: presentJob(row), created: true };
    } finally { await tx.execute(sql`SELECT RELEASE_LOCK('ledger_fx_refresh')`); }
  });
}
export async function getRefreshJob(ctx: AuthContext & { email: string }, id: string) {
  if (!isAdministrator(ctx.email)) throw new DomainError(404, 'NOT_FOUND', '任务不存在');
  const [row] = await database().select().from(fxRefreshJobs).where(eq(fxRefreshJobs.id, id));
  if (!row) throw new DomainError(404, 'NOT_FOUND', '任务不存在');
  return presentJob(row);
}

/** Provider health for the settings page (P09): last success, failure streak, suspect batches waiting for review. */
export async function fxStatus(config: FxConfig = fxConfig(), now = new Date()) {
  const [status] = await database().select().from(fxFetchStatus).where(eq(fxFetchStatus.provider, config.provider));
  const latest = await latestBatch(database(), config.provider);
  const [suspects] = await database().select({ n: sql<number>`COUNT(*)` }).from(fxBatches)
    .where(and(eq(fxBatches.provider, config.provider), eq(fxBatches.quality, 'suspect'), gt(fxBatches.sourceAt, latest?.sourceAt ?? new Date(0))));
  return {
    provider: config.provider, configured: Boolean(config.url), sourceAt: iso(latest?.sourceAt ?? null), fetchedAt: iso(latest?.fetchedAt ?? null),
    freshness: latest ? liveFreshness(now.getTime() - latest.sourceAt.getTime(), status?.consecutiveFailures ?? 0, config.staleFailures) : 'missing' as Freshness,
    consecutiveFailures: status?.consecutiveFailures ?? 0, lastError: status?.lastError ?? null, suspectBatches: Number(suspects?.n ?? 0),
  };
}
