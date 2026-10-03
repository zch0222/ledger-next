import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, databasePool } from '@ledger/db/index';
import { closeRedis } from '@ledger/db/redis';
import {
  fxBatches,
  fxFetchStatus,
  fxHistoryRequests,
  fxRefreshJobs,
  fxSnapshots,
  memberships,
  transactionAmounts,
} from '@ledger/db/schema';
import { createAccount } from '@ledger/domain/accounts';
import { createCategory } from '@ledger/domain/catalog';
import {
  createManualRateRecord,
  createRefreshJob,
  getExchangeRates,
  getRefreshJob,
  ingestBatch,
  listManualRateRecords,
  manualRate,
  processHistoryRequests,
  processRefreshJobs,
  pruneMinuteBatches,
  quote,
  refreshLatest,
} from '@ledger/domain/fx';
import { fxConfig, type FxConfig, type ProviderQuote } from '@ledger/domain/fx-provider';
import type { AuthContext } from '@ledger/domain/identity';
import { createPreview, createRefund, createTransaction } from '@ledger/domain/transactions';
import { seedLedger, seedUser } from './db';

// Each test owns a provider name, so batches written here never mix with the worker's live "fixer" data.
const RATES = { USD: '1.08', CNY: '7.8', HKD: '8.43', JPY: '161' };
const useProvider = (tag: string): FxConfig => {
  process.env.FX_PROVIDER = `itest-${tag}-${randomUUID().slice(0, 8)}`;
  return { ...fxConfig(), staleFailures: 3 };
};
const batch = (sourceAt: Date, rates: Record<string, string> = RATES): ProviderQuote => ({
  pivot: 'EUR',
  sourceAt,
  date: sourceAt.toISOString().slice(0, 10),
  rates,
});
const ago = (ms: number, from = new Date()) => new Date(from.getTime() - ms);
const fakeFetch = (status: number, body = '') =>
  (async () => new Response(body, { status })) as unknown as typeof fetch;
let ctx: AuthContext;
let ledger: string;
let usd: string;
let hkd: string;
let cny: string;
let food: string;

beforeAll(async () => {
  const owner = await seedUser();
  ctx = { userId: owner, requestId: randomUUID() };
  ledger = await seedLedger(owner, 'CNY');
  usd = (await createAccount(ctx, ledger, { name: '美元卡', type: 'credit_card', currency: 'USD' })).id;
  hkd = (await createAccount(ctx, ledger, { name: '港币', type: 'bank', currency: 'HKD', openingBalance: '1000' })).id;
  cny = (await createAccount(ctx, ledger, { name: '人民币', type: 'bank', currency: 'CNY', openingBalance: '1000' }))
    .id;
  food = (await createCategory(ctx, ledger, { name: '餐饮', kind: 'expense' })).id;
});
afterAll(async () => {
  await closeRedis();
  await databasePool().end();
});

describe('batches and freshness', () => {
  it('serves the latest accepted batch with freshness from the source age, not the fetch time', async () => {
    const config = useProvider('live');
    const now = new Date();
    expect((await ingestBatch(batch(ago(30_000, now)), 'latest', config, now)).status).toBe('accepted');
    const fresh = await quote(database(), 'USD', 'CNY', now, now, config);
    expect(fresh).toMatchObject({ freshness: 'fresh', value: '7.222222222222222222', source: config.provider });
    const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
    expect((await quote(database(), 'USD', 'CNY', later(5), later(5), config)).freshness).toBe('delayed');
    expect((await quote(database(), 'USD', 'CNY', later(20), later(20), config)).freshness).toBe('stale');
    expect(await quote(database(), 'CNY', 'CNY', now, now, config)).toMatchObject({ value: '1', freshness: 'fresh' });
    // A failing source turns the same data stale after the configured streak, and one success resets it.
    for (let i = 0; i < 3; i++) {
      expect(await refreshLatest(config, fakeFetch(503), now)).toMatchObject({ ok: false, error: 'server' });
    }
    const [status] = await database().select().from(fxFetchStatus).where(eq(fxFetchStatus.provider, config.provider));
    expect(status).toMatchObject({ consecutiveFailures: 3, lastError: 'server: FX provider server error 503' });
    expect((await quote(database(), 'USD', 'CNY', now, now, config)).freshness).toBe('stale');
    const body = JSON.stringify({
      success: true,
      timestamp: Math.floor(now.getTime() / 1000),
      base: 'EUR',
      date: now.toISOString().slice(0, 10),
      rates: { USD: 1.09, CNY: 7.81, HKD: 8.44, JPY: 160 },
    });
    expect(await refreshLatest(config, fakeFetch(200, body), now)).toMatchObject({ ok: true, status: 'accepted' });
    expect(await quote(database(), 'USD', 'CNY', now, now, config)).toMatchObject({
      freshness: 'fresh',
      value: '7.165137614678899083',
    });
  });
  it('ignores batches that do not advance and holds back implausible jumps until three agree', async () => {
    const config = useProvider('jump');
    const now = new Date();
    const first = await ingestBatch(batch(ago(180_000, now)), 'latest', config, now);
    expect((await ingestBatch(batch(ago(180_000, now)), 'latest', config, now)).status).toBe('unchanged');
    const jumped = { ...RATES, USD: '1.62' };
    expect((await ingestBatch(batch(ago(120_000, now), jumped), 'latest', config, now)).status).toBe('suspect');
    expect((await quote(database(), 'USD', 'EUR', now, now, config)).batchId).toBe(first.batchId); // still the old rate
    expect((await ingestBatch(batch(ago(60_000, now), jumped), 'latest', config, now)).status).toBe('suspect');
    const confirmed = await ingestBatch(batch(ago(1_000, now), jumped), 'latest', config, now);
    expect(confirmed.status).toBe('accepted');
    expect(await quote(database(), 'EUR', 'USD', now, now, config)).toMatchObject({
      value: '1.62',
      batchId: confirmed.batchId,
    });
  });
  it('uses the rate in force for backdated instants and queues missing days for the worker', async () => {
    const config = useProvider('history');
    const at = new Date('2026-09-01T10:00:00Z');
    const now = new Date('2026-10-02T08:00:00Z');
    expect((await quote(database(), 'USD', 'CNY', at, now, config)).freshness).toBe('missing');
    const [request] = await database()
      .select()
      .from(fxHistoryRequests)
      .where(and(eq(fxHistoryRequests.provider, config.provider), eq(fxHistoryRequests.effectiveDate, '2026-09-01')));
    expect(request).toMatchObject({ status: 'pending', attempts: 0 });
    // The worker backfills from the provider's historical endpoint (local mock in the test stack).
    expect(await processHistoryRequests(config)).toEqual({ claimed: 1, done: 1 });
    const daily = await quote(database(), 'USD', 'CNY', at, now, config);
    expect(daily).toMatchObject({ freshness: 'fresh' });
    expect(daily.sourceAt?.toISOString()).toBe('2026-09-01T23:59:59.000Z');
    // Three days later the same batch is the newest one, but too old to count as fresh: the day is requested too.
    expect((await quote(database(), 'USD', 'CNY', new Date('2026-09-04T12:00:00Z'), now, config)).freshness).toBe(
      'stale',
    );
    expect(
      (await database().select().from(fxHistoryRequests).where(eq(fxHistoryRequests.provider, config.provider)))
        .map(r => r.effectiveDate)
        .sort(),
    ).toEqual(['2026-09-01', '2026-09-04']);
    // Failed backfills are retried a bounded number of times.
    const broken = { ...config, url: 'http://127.0.0.1:9/none' };
    for (let i = 0; i < 5; i++) await processHistoryRequests(broken);
    const [failed] = await database()
      .select()
      .from(fxHistoryRequests)
      .where(and(eq(fxHistoryRequests.provider, config.provider), eq(fxHistoryRequests.effectiveDate, '2026-09-04')));
    expect(failed).toMatchObject({ status: 'failed', attempts: 5 });
  });
  it('keeps the backfill request even when the failing preview rolls back', async () => {
    const config = useProvider('rollback');
    const day = new Date(Date.now() - 20 * 86400_000).toISOString().slice(0, 10);
    await expect(
      createPreview(ctx, ledger, {
        kind: 'expense',
        accountId: usd,
        settlement: { amount: '1.00', currency: 'USD' },
        occurredAt: `${day}T08:00:00.000Z`,
        timezone: 'UTC',
      }),
    ).rejects.toMatchObject({ code: 'FX_RATE_MISSING' });
    const [request] = await database()
      .select()
      .from(fxHistoryRequests)
      .where(and(eq(fxHistoryRequests.provider, config.provider), eq(fxHistoryRequests.effectiveDate, day)));
    expect(request?.status).toBe('pending');
  });
  it('keeps one minute batch per day once batches are old', async () => {
    const config = useProvider('prune');
    const now = new Date();
    for (const minutes of [0, 10, 20]) {
      await ingestBatch(batch(new Date(Date.parse('2026-08-01T12:00:00Z') + minutes * 60_000)), 'latest', config, now);
    }
    expect(await pruneMinuteBatches(config.provider, 35, now)).toBe(2);
    const left = await database().select().from(fxBatches).where(eq(fxBatches.provider, config.provider));
    expect(left.map(b => b.sourceAt.toISOString())).toEqual(['2026-08-01T12:20:00.000Z']);
  });
});

describe('transactions with market rates', () => {
  it('locks the previewed rate; a newer batch never changes what is booked', async () => {
    const config = useProvider('lock');
    const now = new Date();
    const a = await ingestBatch(batch(ago(20_000, now)), 'latest', config, now);
    const preview = await createPreview(ctx, ledger, {
      kind: 'expense',
      accountId: usd,
      settlement: { amount: '12.00', currency: 'USD' },
      categoryId: food,
      occurredAt: now.toISOString(),
      timezone: 'Asia/Hong_Kong',
    });
    expect(preview).toMatchObject({
      base: { amount: '86.67', currency: 'CNY' },
      exchangeRate: {
        value: '7.222222222222222222',
        base: 'USD',
        quote: 'CNY',
        freshness: 'fresh',
        source: config.provider,
      },
      warnings: [],
    });
    await ingestBatch(batch(ago(1_000, now), { ...RATES, CNY: '7.9' }), 'latest', config, now);
    const created = await createTransaction(ctx, ledger, { previewId: preview.previewId });
    expect(created).toMatchObject({ base: { amount: '86.67' }, exchangeRate: { value: '7.222222222222222222' } });
    const [amount] = await database()
      .select()
      .from(transactionAmounts)
      .where(eq(transactionAmounts.transactionId, created.id));
    const [snapshot] = await database().select().from(fxSnapshots).where(eq(fxSnapshots.id, amount.fxSnapshotId!));
    expect(snapshot).toMatchObject({ batchId: a.batchId, freshness: 'fresh', source: config.provider });
    const next = await createPreview(ctx, ledger, {
      kind: 'expense',
      accountId: usd,
      settlement: { amount: '12.00', currency: 'USD' },
      occurredAt: now.toISOString(),
      timezone: 'UTC',
    });
    expect(next.exchangeRate?.value).toBe('7.314814814814814815');
  });
  it('requires an explicit choice for stale quotes and warns about delayed ones', async () => {
    const body = {
      kind: 'expense',
      accountId: usd,
      settlement: { amount: '5.00', currency: 'USD' },
      occurredAt: new Date().toISOString(),
      timezone: 'UTC',
    };
    let config = useProvider('stale');
    await ingestBatch(batch(ago(20 * 60_000)), 'latest', config);
    await expect(createPreview(ctx, ledger, body)).rejects.toMatchObject({
      status: 422,
      code: 'FX_RATE_STALE',
      errors: [{ path: 'fxPolicy', code: 'choice_required' }],
    });
    const accepted = await createPreview(ctx, ledger, { ...body, fxPolicy: 'accept-stale' });
    expect(accepted.exchangeRate?.freshness).toBe('stale');
    expect(accepted.warnings.map(w => w.code)).toEqual(['FX_STALE_ACCEPTED']);
    config = useProvider('delayed');
    await ingestBatch(batch(ago(5 * 60_000)), 'latest', config);
    const delayed = await createPreview(ctx, ledger, body);
    expect(delayed.exchangeRate?.freshness).toBe('delayed');
    expect(delayed.warnings.map(w => w.code)).toEqual(['FX_DELAYED']);
    useProvider('empty');
    await expect(createPreview(ctx, ledger, body)).rejects.toMatchObject({
      code: 'FX_RATE_MISSING',
      errors: [{ path: 'fxPolicy' }],
    });
    const manual = await createPreview(ctx, ledger, {
      ...body,
      fxPolicy: 'manual',
      manualRate: { value: '7.1', reason: '银行流水' },
    });
    expect(manual.exchangeRate).toMatchObject({ freshness: 'manual', value: '7.1' });
    await expect(createPreview(ctx, ledger, { ...body, fxPolicy: 'manual' })).rejects.toMatchObject({
      code: 'FX_RATE_MISSING',
    });
  });
  it('values a transfer between two foreign accounts at the quoted rate', async () => {
    const config = useProvider('transfer');
    await ingestBatch(batch(ago(10_000)), 'latest', config);
    const preview = await createPreview(ctx, ledger, {
      kind: 'transfer',
      sourceAccountId: hkd,
      targetAccountId: usd,
      sourceAmount: { amount: '100.00', currency: 'HKD' },
      targetAmount: { amount: '12.80', currency: 'USD' },
      occurredAt: new Date().toISOString(),
      timezone: 'UTC',
    });
    expect(preview).toMatchObject({
      base: { amount: '92.53', currency: 'CNY' },
      exchangeRate: { base: 'HKD', quote: 'CNY', source: config.provider },
    });
  });
  it('refunds across currencies against the original payment and its locked rate', async () => {
    useProvider('refund');
    const now = new Date().toISOString();
    const paid = await createTransaction(ctx, ledger, {
      previewId: (
        await createPreview(ctx, ledger, {
          kind: 'expense',
          accountId: usd,
          settlement: { amount: '12.00', currency: 'USD' },
          categoryId: food,
          occurredAt: now,
          timezone: 'UTC',
          fxPolicy: 'manual',
          manualRate: { value: '7.2', reason: '账单' },
        })
      ).previewId,
    });
    const refund = (amount: string, extra: Record<string, unknown>) => ({
      kind: 'refund',
      originalTransactionId: paid.id,
      accountId: hkd,
      settlement: { amount, currency: 'HKD' },
      occurredAt: now,
      timezone: 'UTC',
      ...extra,
    });
    await expect(createPreview(ctx, ledger, refund('50.00', {}))).rejects.toMatchObject({
      code: 'ORIGINAL_AMOUNT_REQUIRED',
    });
    await expect(
      createPreview(ctx, ledger, refund('50.00', { originalAmount: { amount: '6.00', currency: 'HKD' } })),
    ).rejects.toMatchObject({ code: 'CURRENCY_MISMATCH' });
    const preview = await createPreview(
      ctx,
      ledger,
      refund('50.00', { originalAmount: { amount: '6.00', currency: 'USD' } }),
    );
    expect(preview).toMatchObject({
      settlement: { amount: '50.00', currency: 'HKD' },
      base: { amount: '43.20', currency: 'CNY' },
      exchangeRate: { base: 'HKD', quote: 'CNY', value: '0.864', source: 'refund' },
    });
    const created = await createRefund(ctx, ledger, paid.id, { previewId: preview.previewId });
    expect(created).toMatchObject({
      kind: 'refund',
      refundOf: paid.id,
      original: { amount: '6.00', currency: 'USD' },
      settlement: { amount: '50.00', currency: 'HKD' },
    });
    await expect(
      createPreview(ctx, ledger, refund('51.00', { originalAmount: { amount: '6.01', currency: 'USD' } })),
    ).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_PAID' });
    await expect(
      createPreview(ctx, ledger, {
        ...refund('6.00', { originalAmount: { amount: '5.00', currency: 'USD' } }),
        accountId: usd,
        settlement: { amount: '6.00', currency: 'USD' },
      }),
    ).rejects.toMatchObject({ code: 'REFUND_AMOUNT_MISMATCH' });
    const sameCurrency = await createPreview(ctx, ledger, {
      ...refund('6.00', {}),
      accountId: usd,
      settlement: { amount: '6.00', currency: 'USD' },
    });
    expect(sameCurrency).toMatchObject({
      base: { amount: '43.20', currency: 'CNY' },
      exchangeRate: { value: '7.2', source: 'manual' },
    });
    // Refund into a base-currency account needs no rate at all.
    const toBase = await createPreview(ctx, ledger, {
      ...refund('43.00', { originalAmount: { amount: '6.00', currency: 'USD' } }),
      accountId: cny,
      settlement: { amount: '43.00', currency: 'CNY' },
    });
    expect(toBase).toMatchObject({ base: { amount: '43.00', currency: 'CNY' }, exchangeRate: null });
  });
});

describe('REST use cases', () => {
  it('answers exchange-rate queries with freshness per quote', async () => {
    const config = useProvider('rest');
    await ingestBatch(batch(ago(10_000)), 'latest', config);
    const result = await getExchangeRates({ base: 'CNY', quotes: 'USD,HKD,CNY' });
    expect(result.rates.map(r => [r.quote, r.freshness])).toEqual([
      ['USD', 'fresh'],
      ['HKD', 'fresh'],
      ['CNY', 'fresh'],
    ]);
    expect(result.rates[0].value).toBe('0.138461538461538462');
    await expect(getExchangeRates({ base: 'CNY', quotes: 'GBP' })).rejects.toMatchObject({
      status: 422,
      code: 'UNSUPPORTED_CURRENCY',
    });
    await expect(
      getExchangeRates({ base: 'CNY', quotes: 'USD', asOf: new Date(Date.now() + 3600_000).toISOString() }),
    ).rejects.toMatchObject({ code: 'INVALID_AS_OF' });
    useProvider('rest-empty');
    expect((await getExchangeRates({ base: 'CNY', quotes: 'USD' })).rates[0]).toMatchObject({
      value: null,
      freshness: 'missing',
      sourceAt: null,
    });
  });
  it('records manual rates with a reason for editors only', async () => {
    const record = await createManualRateRecord(ctx, ledger, {
      base: 'USD',
      quote: 'CNY',
      value: '7.1',
      effectiveDate: '2026-09-30',
      reason: '月末银行牌价',
    });
    expect(record).toMatchObject({
      base: 'USD',
      quote: 'CNY',
      value: '7.1',
      reason: '月末银行牌价',
      createdBy: ctx.userId,
    });
    expect(await manualRate(database(), ledger, 'USD', 'CNY', '2026-10-01')).toMatchObject({
      value: '7.1',
      effectiveDate: '2026-09-30',
    });
    expect(await manualRate(database(), ledger, 'USD', 'CNY', '2026-09-29')).toBeNull();
    expect((await listManualRateRecords(ctx, ledger, { limit: 10 }))[0].id).toBe(record.id);
    await expect(
      createManualRateRecord(ctx, ledger, {
        base: 'USD',
        quote: 'USD',
        value: '1',
        effectiveDate: '2026-09-30',
        reason: 'x',
      }),
    ).rejects.toMatchObject({ code: 'SAME_CURRENCY' });
    const viewer = await seedUser();
    await database()
      .insert(memberships)
      .values({ id: randomUUID(), ledgerId: ledger, userId: viewer, role: 'viewer', createdAt: new Date() });
    await expect(
      createManualRateRecord({ userId: viewer, requestId: randomUUID() }, ledger, {
        base: 'USD',
        quote: 'CNY',
        value: '7',
        effectiveDate: '2026-09-30',
        reason: 'x',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('deduplicates administrator refresh jobs and runs them in the worker', async () => {
    const config = useProvider('refresh');
    process.env.LEDGER_ADMIN_EMAILS = 'fx-admin@example.test';
    await database().delete(fxRefreshJobs); // isolated test database; dedupe spans all jobs
    await expect(createRefreshJob({ ...ctx, email: 'someone@example.test' }, {})).rejects.toMatchObject({
      status: 403,
    });
    const admin = { ...ctx, email: 'FX-Admin@example.test' };
    const first = await createRefreshJob(admin, { reason: '手动刷新' });
    expect(first).toMatchObject({ created: true, job: { status: 'queued' } });
    expect((await createRefreshJob(admin, {})).job.id).toBe(first.job.id);
    const body = JSON.stringify({
      success: true,
      timestamp: Math.floor(Date.now() / 1000),
      base: 'EUR',
      date: new Date().toISOString().slice(0, 10),
      rates: { USD: 1.08, CNY: 7.8, HKD: 8.43, JPY: 161 },
    });
    // In the Docker stack the live worker may claim the job first; either way it must finish.
    expect([first.job.id, null]).toContain(await processRefreshJobs(config, fakeFetch(200, body)));
    await expect
      .poll(async () => (await getRefreshJob(admin, first.job.id)).status, { timeout: 20000 })
      .toBe('succeeded');
    expect((await createRefreshJob(admin, {})).created).toBe(false); // finished less than 60 s ago
    await expect(getRefreshJob({ ...ctx, email: 'someone@example.test' }, first.job.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});
