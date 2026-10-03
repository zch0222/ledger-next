import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { expectContract } from './contract';
import { client, ledger, password, test, user } from './helpers';

// The worker polls the local Fixer mock every 2 s (compose.test.yaml); faults are injected through its control API.
const mock = process.env.MOCK_URL ?? 'http://localhost:4010';
async function fixer(state: Record<string, unknown>) {
  const response = await fetch(`${mock}/__control/fixer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  expect(response.ok).toBe(true);
}
const rates = (api: Awaited<ReturnType<typeof client>>, query = 'base=CNY&quotes=USD,HKD') =>
  api.get(`/api/v1/exchange-rates?${query}`);
async function freshnessOf(api: Awaited<ReturnType<typeof client>>) {
  const body = await expectContract(await rates(api), 'getExchangeRates', 200);
  return body.data.rates[0].freshness as string;
}

test.afterEach(async () => {
  await fixer({ mode: 'ok', lagSeconds: 0, jumpFactor: 1 });
});

test('the worker keeps minute rates fresh, and source faults degrade honestly without blocking pages', async () => {
  test.setTimeout(120_000);
  const owner = await user('fx');
  await expect.poll(() => freshnessOf(owner.client), { timeout: 30_000 }).toBe('fresh');
  const body = await expectContract(await rates(owner.client), 'getExchangeRates', 200);
  expect(body.data).toMatchObject({
    base: 'CNY',
    rates: [
      { quote: 'USD', source: 'fixer' },
      { quote: 'HKD', source: 'fixer' },
    ],
  });
  expect(Number(body.data.rates[0].value)).toBeGreaterThan(0.13);
  expect(Date.parse(body.data.rates[0].fetchedAt)).toBeGreaterThanOrEqual(Date.parse(body.data.rates[0].sourceAt));
  await expectContract(await rates(owner.client, 'base=CNY&quotes=GBP'), 'getExchangeRates', 422);
  await expectContract(await rates(owner.client, 'base=CNY'), 'getExchangeRates', 422);

  // Provider down (5xx, then timeouts): after the failure streak the last good data is shown as stale.
  await fixer({ mode: 'server_error' });
  await expect.poll(() => freshnessOf(owner.client), { timeout: 30_000 }).toBe('stale');
  await fixer({ mode: 'timeout' });
  const started = Date.now();
  const page = await owner.client.get('/login');
  expect(page.status()).toBe(200); // pages never wait for the FX provider
  expect(Date.now() - started).toBeLessThan(3000);
  const book = await ledger(owner.client);
  const base = `/api/v1/ledgers/${book.id}`;
  const card = (
    await expectContract(
      await owner.client.post(`${base}/accounts`, { data: { name: '美元卡', type: 'credit_card', currency: 'USD' } }),
      'createAccount',
      201,
    )
  ).data;
  const expense = {
    kind: 'expense',
    accountId: card.id,
    settlement: { amount: '12.00', currency: 'USD' },
    occurredAt: new Date().toISOString(),
    timezone: 'Asia/Hong_Kong',
  };
  const stale = await expectContract(
    await owner.client.post(`${base}/transaction-previews`, { data: expense }),
    'createTransactionPreview',
    422,
  );
  expect(stale).toMatchObject({ code: 'FX_RATE_STALE', errors: [{ path: 'fxPolicy', code: 'choice_required' }] });
  const accepted = await expectContract(
    await owner.client.post(`${base}/transaction-previews`, { data: { ...expense, fxPolicy: 'accept-stale' } }),
    'createTransactionPreview',
    201,
  );
  expect(accepted.data.exchangeRate).toMatchObject({ freshness: 'stale', source: 'fixer' });
  expect(accepted.data.warnings.map((w: { code: string }) => w.code)).toContain('FX_STALE_ACCEPTED');

  // Recovery: the next successful poll resets the streak.
  await fixer({ mode: 'ok' });
  await expect.poll(() => freshnessOf(owner.client), { timeout: 30_000 }).toBe('fresh');
  const preview = await expectContract(
    await owner.client.post(`${base}/transaction-previews`, { data: expense }),
    'createTransactionPreview',
    201,
  );
  expect(preview.data.exchangeRate).toMatchObject({ freshness: 'fresh', base: 'USD', quote: 'CNY', source: 'fixer' });
  const created = await expectContract(
    await owner.client.post(`${base}/transactions`, {
      data: { previewId: preview.data.previewId },
      headers: { 'Idempotency-Key': randomUUID() },
    }),
    'createTransaction',
    201,
  );
  expect(created.data.exchangeRate.value).toBe(preview.data.exchangeRate.value); // the locked rate, even if a newer batch arrived
  expect(created.data.base).toEqual({ ...preview.data.base, estimated: false });
  await owner.client.dispose();
});

test('a stalled feed ages into "delayed" by source time even though fetches keep succeeding', async () => {
  test.setTimeout(240_000);
  const owner = await user('fx-frozen');
  await expect.poll(() => freshnessOf(owner.client), { timeout: 30_000 }).toBe('fresh');
  await fixer({ mode: 'frozen' });
  // Fresh means source age ≤ 120 s; the worker keeps fetching successfully, yet the quote time no longer advances.
  await expect.poll(() => freshnessOf(owner.client), { timeout: 200_000, intervals: [5_000] }).toBe('delayed');
  const body = await expectContract(await rates(owner.client), 'getExchangeRates', 200);
  expect(Date.now() - Date.parse(body.data.rates[0].sourceAt)).toBeGreaterThan(120_000);
  await fixer({ mode: 'ok' });
  await expect.poll(() => freshnessOf(owner.client), { timeout: 30_000 }).toBe('fresh');
  await owner.client.dispose();
});

test('backdated entries wait for the historical backfill instead of using today’s rate', async () => {
  test.setTimeout(60_000);
  const owner = await user('fx-history');
  const book = await ledger(owner.client);
  const base = `/api/v1/ledgers/${book.id}`;
  const card = (
    await expectContract(
      await owner.client.post(`${base}/accounts`, { data: { name: 'USD', type: 'bank', currency: 'USD' } }),
      'createAccount',
      201,
    )
  ).data;
  const day = new Date(Date.now() - 40 * 86400_000).toISOString().slice(0, 10);
  const body = {
    kind: 'expense',
    accountId: card.id,
    settlement: { amount: '20.00', currency: 'USD' },
    occurredAt: `${day}T04:00:00.000Z`,
    timezone: 'UTC',
  };
  const first = await owner.client.post(`${base}/transaction-previews`, { data: body });
  expect((await expectContract(first, 'createTransactionPreview', 422)).code).toBe('FX_RATE_MISSING');
  await expect
    .poll(async () => (await owner.client.post(`${base}/transaction-previews`, { data: body })).status(), {
      timeout: 30_000,
    })
    .toBe(201);
  const preview = await expectContract(
    await owner.client.post(`${base}/transaction-previews`, { data: body }),
    'createTransactionPreview',
    201,
  );
  expect(preview.data.exchangeRate).toMatchObject({ freshness: 'fresh', sourceAt: `${day}T23:59:59.000Z` });
  await owner.client.dispose();
});

test('manual rate records and administrator refresh jobs follow the contract', async () => {
  const owner = await user('fx-manual');
  const book = await ledger(owner.client);
  const base = `/api/v1/ledgers/${book.id}`;
  const record = await expectContract(
    await owner.client.post(`${base}/manual-rate-records`, {
      data: { base: 'USD', quote: 'CNY', value: '7.1', effectiveDate: '2026-09-30', reason: '银行牌价' },
    }),
    'createManualRateRecord',
    201,
  );
  expect(record.data).toMatchObject({ value: '7.1', reason: '银行牌价' });
  await expectContract(
    await owner.client.post(`${base}/manual-rate-records`, {
      data: { base: 'USD', quote: 'CNY', value: '7.1', effectiveDate: '2026-09-30' },
    }),
    'createManualRateRecord',
    422,
  );
  const list = await expectContract(
    await owner.client.get(`${base}/manual-rate-records`),
    'listManualRateRecords',
    200,
  );
  expect(list.data.map((r: { id: string }) => r.id)).toEqual([record.data.id]);
  const outsider = await user('fx-outsider');
  await expectContract(await outsider.client.get(`${base}/manual-rate-records`), 'listManualRateRecords', 404);
  await expectContract(
    await owner.client.post('/api/v1/exchange-rate-refresh-jobs', { data: {} }),
    'createExchangeRateRefreshJob',
    403,
  );

  const admin = await client();
  expect(
    (
      await admin.post('/api/auth/sign-up/email', {
        data: { name: 'admin', email: 'admin-e2e@example.test', password },
      })
    ).status(),
  ).toBe(200);
  const job = await admin.post('/api/v1/exchange-rate-refresh-jobs', { data: { reason: 'e2e' } });
  const created = await expectContract(job, 'createExchangeRateRefreshJob', 202);
  expect(job.headers().location).toBe(`/api/v1/exchange-rate-refresh-jobs/${created.data.id}`);
  await expect
    .poll(
      async () =>
        (await expectContract(await admin.get(job.headers().location!), 'getExchangeRateRefreshJob', 200)).data.status,
      { timeout: 20_000 },
    )
    .toBe('succeeded');
  await expectContract(await owner.client.get(job.headers().location!), 'getExchangeRateRefreshJob', 404);
  await owner.client.dispose();
  await outsider.client.dispose();
  await admin.dispose();
});
