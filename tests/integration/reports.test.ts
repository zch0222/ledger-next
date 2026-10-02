import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databasePool } from '../../packages/db/src/index';
import { closeRedis, redis } from '../../packages/db/src/redis';
import { createAccount } from '../../packages/domain/src/accounts';
import { createCategory } from '../../packages/domain/src/catalog';
import { createManualRateRecord, ingestBatch } from '../../packages/domain/src/fx';
import { fxConfig } from '../../packages/domain/src/fx-provider';
import type { AuthContext } from '../../packages/domain/src/identity';
import { sum } from '../../packages/domain/src/money';
import { accountBalances, archiveBudget, budgetProgress, cashFlow, categoryBreakdown, createBudget, listBudgets, reportSummary, updateBudget } from '../../packages/domain/src/reports';
import { correctTransaction, createPreview, createRefund, createTransaction, listTransactions, voidTransaction } from '../../packages/domain/src/transactions';
import { seedLedger, seedUser } from './db';

let ctx: AuthContext, ledger: string, cash: string, card: string, hkd: string, food: string, takeout: string, salary: string;
const SEP = { dateFrom: '2026-09-01', dateTo: '2026-10-01' }, OCT = { dateFrom: '2026-10-01', dateTo: '2026-11-01' };
const at = (date: string) => `${date}T04:00:00.000Z`; // noon in Hong Kong
async function book(body: Record<string, unknown>) {
  return createTransaction(ctx, ledger, { previewId: (await createPreview(ctx, ledger, { timezone: 'Asia/Hong_Kong', ...body })).previewId });
}
const RATES = { USD: '1.08', CNY: '7.8', HKD: '8.43', JPY: '161' };

beforeAll(async () => {
  const owner = await seedUser();
  ctx = { userId: owner, requestId: randomUUID() };
  ledger = await seedLedger(owner, 'CNY');
  process.env.FX_PROVIDER = `itest-reports-${randomUUID().slice(0, 8)}`;
  cash = (await createAccount(ctx, ledger, { name: '现金', type: 'cash', currency: 'CNY', openingBalance: '5000' })).id;
  card = (await createAccount(ctx, ledger, { name: '美元卡', type: 'credit_card', currency: 'USD' })).id;
  hkd = (await createAccount(ctx, ledger, { name: '港币', type: 'bank', currency: 'HKD', openingBalance: '0' })).id;
  food = (await createCategory(ctx, ledger, { name: '餐饮', kind: 'expense' })).id;
  takeout = (await createCategory(ctx, ledger, { name: '外卖', kind: 'expense', parentId: food })).id;
  salary = (await createCategory(ctx, ledger, { name: '工资', kind: 'income' })).id;
  // September: income 1000, food 100 (later refunded 20 in October), takeout 50, USD 12 @ 7.2 = 86.40, a voided
  // expense, a corrected expense (30 → 35), and a transfer that must not count.
  await book({ kind: 'income', accountId: cash, settlement: { amount: '1000.00', currency: 'CNY' }, categoryId: salary, occurredAt: at('2026-09-05') });
  const dinner = await book({ kind: 'expense', accountId: cash, settlement: { amount: '100.00', currency: 'CNY' }, categoryId: food, occurredAt: at('2026-09-10') });
  await book({ kind: 'expense', accountId: cash, settlement: { amount: '50.00', currency: 'CNY' }, categoryId: takeout, occurredAt: at('2026-09-11') });
  await book({ kind: 'expense', accountId: card, settlement: { amount: '12.00', currency: 'USD' }, categoryId: food, occurredAt: at('2026-09-12'), fxPolicy: 'manual', manualRate: { value: '7.2', reason: '账单' } });
  const mistake = await book({ kind: 'expense', accountId: cash, settlement: { amount: '999.00', currency: 'CNY' }, occurredAt: at('2026-09-13') });
  await voidTransaction(ctx, ledger, mistake.id, '"v1"');
  const typo = await book({ kind: 'expense', accountId: cash, settlement: { amount: '30.00', currency: 'CNY' }, occurredAt: at('2026-09-14') });
  await correctTransaction(ctx, ledger, typo.id, { previewId: (await createPreview(ctx, ledger, { kind: 'expense', accountId: cash, settlement: { amount: '35.00', currency: 'CNY' }, occurredAt: at('2026-09-14'), timezone: 'Asia/Hong_Kong' })).previewId }, '"v1"');
  await book({ kind: 'transfer', sourceAccountId: cash, targetAccountId: hkd, sourceAmount: { amount: '900.00', currency: 'CNY' }, targetAmount: { amount: '972.00', currency: 'HKD' }, occurredAt: at('2026-09-15') });
  await createRefund(ctx, ledger, dinner.id, { previewId: (await createPreview(ctx, ledger, { kind: 'refund', originalTransactionId: dinner.id, accountId: cash, settlement: { amount: '20.00', currency: 'CNY' }, occurredAt: at('2026-10-03'), timezone: 'Asia/Hong_Kong' })).previewId });
});
afterAll(async () => { await closeRedis(); await databasePool().end(); });

describe('summary and reconciliation', () => {
  it('counts effective income and expense, never transfers, and refunds in their own period', async () => {
    const sep = await reportSummary(ctx, ledger, SEP), oct = await reportSummary(ctx, ledger, OCT);
    expect(sep).toMatchObject({ income: '1000.00', expense: '271.40', refunds: '0.00', net: '728.60', currency: 'CNY', valuationMode: 'historical', partial: false, excludedCount: 0, period: { timezone: 'Asia/Hong_Kong' } });
    expect(oct).toMatchObject({ income: '0.00', expense: '0.00', refunds: '20.00', net: '20.00' });
    // The same totals rebuilt from the transaction list (the details the user sees).
    const details = await listTransactions(ctx, ledger, { ...SEP, status: 'posted', sort: '-localDate', limit: 100 });
    const shown = await details.present(details.rows.map(r => r.id));
    const total = (kind: string) => sum(shown.filter(t => t.kind === kind).map(t => t.base.amount)).toFixed(2);
    expect([total('income'), total('expense')]).toEqual([sep.income, sep.expense]);
    expect(shown.some(t => t.kind === 'transfer')).toBe(true);
  });
  it('filters by account and by a parent category including its children', async () => {
    expect((await reportSummary(ctx, ledger, { ...SEP, accountId: card })).expense).toBe('86.40');
    expect((await reportSummary(ctx, ledger, { ...SEP, categoryId: food })).expense).toBe('236.40'); // 100 + 50 + 86.40
    expect((await reportSummary(ctx, ledger, { ...SEP, categoryId: takeout })).expense).toBe('50.00');
  });
  it('converts into another currency per transaction with that day’s rate and reports what it had to exclude', async () => {
    const config = fxConfig();
    for (const day of ['2026-09-05', '2026-09-10', '2026-09-11', '2026-09-12']) await ingestBatch({ pivot: 'EUR', sourceAt: new Date(`${day}T23:59:59Z`), date: day, rates: RATES }, 'historical', config);
    const usd = await reportSummary(ctx, ledger, { ...SEP, currency: 'USD' });
    // 1000 CNY → 138.46 USD; 100 → 13.85, 50 → 6.92, 86.40 → 11.96; 35 CNY on 09-14 has no daily rate (the 09-12 rate is 2 days old).
    expect(usd).toMatchObject({ currency: 'USD', income: '138.46', expense: '32.73', partial: true, excludedCount: 1 });
    await createManualRateRecord(ctx, ledger, { base: 'CNY', quote: 'USD', value: '0.14', effectiveDate: '2026-09-14', reason: '补录' });
    expect(await reportSummary(ctx, ledger, { ...SEP, currency: 'USD' })).toMatchObject({ expense: '37.63', partial: false, excludedCount: 0 }); // + 4.90
  });
  it('values in current mode at the latest rate, separately from historical amounts', async () => {
    await ingestBatch({ pivot: 'EUR', sourceAt: new Date(Date.now() - 10_000), date: new Date().toISOString().slice(0, 10), rates: { ...RATES, CNY: '7.56' } }, 'latest', fxConfig());
    const current = await reportSummary(ctx, ledger, { ...SEP, valuationMode: 'current' });
    // Only the USD card expense changes: 12 USD × (7.56 / 1.08 = 7) = 84.00 instead of the booked 86.40.
    expect(current).toMatchObject({ valuationMode: 'current', expense: '269.00', income: '1000.00' });
    expect(current.sourceAt).not.toBeNull();
    expect((await reportSummary(ctx, ledger, SEP)).expense).toBe('271.40'); // history unchanged
  });
});

describe('trends and categories', () => {
  it('buckets cash flow consistently with the summary', async () => {
    const months = await cashFlow(ctx, ledger, { dateFrom: '2026-09-01', dateTo: '2026-11-01', interval: 'month' });
    expect(months.points).toEqual([{ date: '2026-09-01', income: '1000.00', expense: '271.40', net: '728.60' }, { date: '2026-10-01', income: '0.00', expense: '-20.00', net: '20.00' }]);
    const days = await cashFlow(ctx, ledger, { ...SEP, interval: 'day' });
    expect(days.points).toHaveLength(30);
    expect(sum(days.points.map(p => p.expense)).toFixed(2)).toBe('271.40');
    const weeks = await cashFlow(ctx, ledger, { ...SEP, interval: 'week' });
    expect(weeks.points[0].date).toBe('2026-08-31');
    await expect(cashFlow(ctx, ledger, { dateFrom: '2025-01-01', dateTo: '2026-06-01', interval: 'day' })).rejects.toMatchObject({ code: 'RANGE_TOO_LARGE' });
    await expect(cashFlow(ctx, ledger, { dateFrom: '2026-10-01', dateTo: '2026-10-01' })).rejects.toMatchObject({ code: 'INVALID_RANGE' });
  });
  it('ranks categories with refunds offsetting their own category', async () => {
    const sep = await categoryBreakdown(ctx, ledger, SEP);
    expect(sep.items.map(i => [i.name, i.amount, i.count])).toEqual([['餐饮', '186.40', 2], ['外卖', '50.00', 1], ['未分类', '35.00', 1]]);
    expect(sep.total).toBe('271.40');
    expect(sum(sep.items.map(i => i.share)).toDecimalPlaces(2).toFixed()).toBe('1');
    const oct = await categoryBreakdown(ctx, ledger, OCT);
    expect(oct.items).toEqual([{ categoryId: food, name: '餐饮', amount: '-20.00', share: '1', count: 0 }]);
    expect((await categoryBreakdown(ctx, ledger, { ...SEP, kind: 'income' })).items.map(i => [i.name, i.amount])).toEqual([['工资', '1000.00']]);
  });
});

describe('net worth', () => {
  it('values balances now and at an earlier instant; a missing quote falls back to a manual rate or is excluded', async () => {
    const now = await accountBalances(ctx, ledger, {});
    const byName = Object.fromEntries(now.items.map(i => [i.name, i]));
    expect(byName['现金'].balance).toBe('4935.00'); // 5000 + 1000 − 100 − 50 − 35 − 900 (transfer) + 20 (refund)
    expect(byName['港币']).toMatchObject({ balance: '972.00', valuation: '871.69', freshness: 'fresh' }); // 972 × (7.56 / 8.43)
    expect(byName['美元卡']).toMatchObject({ balance: '-12.00', valuation: '-84.00', freshness: 'fresh' });
    const before = await accountBalances(ctx, ledger, { asOf: '2026-09-11T00:00:00.000Z' });
    expect(Object.fromEntries(before.items.map(i => [i.name, i.balance]))['现金']).toBe('5900.00');
    const hkdOnly = { ...RATES } as Record<string, string>;
    delete hkdOnly.HKD;
    await ingestBatch({ pivot: 'EUR', sourceAt: new Date(Date.now() - 5_000), date: new Date().toISOString().slice(0, 10), rates: hkdOnly }, 'latest', fxConfig());
    expect((await accountBalances(ctx, ledger, {})).items.find(i => i.name === '港币')).toMatchObject({ valuation: null, freshness: 'missing' });
    await expect(accountBalances(ctx, ledger, { asOf: new Date(Date.now() + 3600_000).toISOString() })).rejects.toMatchObject({ code: 'INVALID_AS_OF' });
  });
});

describe('cache and permissions', () => {
  it('serves cached aggregates until a write bumps the data version', async () => {
    const first = await reportSummary(ctx, ledger, OCT);
    const keys = await redis()?.keys(`report:v1:${ledger}:${first.dataVersion}:*`);
    if (redis()) expect(keys?.length).toBeGreaterThan(0);
    expect(await reportSummary(ctx, ledger, OCT)).toEqual(first);
    await book({ kind: 'expense', accountId: cash, settlement: { amount: '8.00', currency: 'CNY' }, occurredAt: at('2026-10-04') });
    const second = await reportSummary(ctx, ledger, OCT);
    expect(second.dataVersion).toBeGreaterThan(first.dataVersion);
    expect(second.expense).toBe('8.00');
  });
  it('hides reports from non-members', async () => {
    const outsider = { userId: await seedUser(), requestId: randomUUID() };
    await expect(reportSummary(outsider, ledger, SEP)).rejects.toMatchObject({ status: 404 });
    await expect(budgetProgress(outsider, ledger, {})).rejects.toMatchObject({ status: 404 });
  });
  it('aggregates a period through an index, never a full scan (plan recorded for the evidence)', async () => {
    const [plan] = await databasePool().query(`EXPLAIN SELECT t.id FROM transactions t JOIN transaction_amounts a ON a.ledger_id = t.ledger_id AND a.transaction_id = t.id
      WHERE t.ledger_id = ? AND t.status = 'posted' AND t.kind <> 'transfer' AND t.local_date >= '2026-09-01' AND t.local_date < '2026-10-01'`, [ledger]);
    const rows = plan as { table: string; key: string | null; type: string }[];
    console.log('EXPLAIN period aggregation:', JSON.stringify(rows.map(r => ({ table: r.table, type: r.type, key: r.key }))));
    // On small test tables MySQL may prefer (ledger_id, id); M7-PERF re-checks the plan at the target data size.
    expect(['transaction_ledger_status_date_idx', 'transaction_ledger_uq']).toContain(rows.find(r => r.table === 't')?.key);
    expect(rows.every(r => r.type !== 'ALL')).toBe(true);
    expect(rows.find(r => r.table === 'a')?.key).toBe('PRIMARY');
  });
});

describe('budgets', () => {
  it('tracks spending per calendar period, including child categories and refunds', async () => {
    const total = await createBudget(ctx, ledger, { period: 'month', amount: { amount: '300.00', currency: 'CNY' }, startDate: '2026-09-01' });
    const dining = await createBudget(ctx, ledger, { name: '吃饭', categoryId: food, period: 'month', amount: { amount: '200.00', currency: 'CNY' }, startDate: '2026-01-01', alertThresholds: [100, 80, 80] });
    expect(dining).toMatchObject({ alertThresholds: [80, 100], amount: { amount: '200.00', currency: 'CNY' }, version: 1 });
    const sep = await budgetProgress(ctx, ledger, { date: '2026-09-20' });
    expect(sep.items.map(i => [i.name, i.spent, i.ratio, i.reachedThresholds])).toEqual([[null, '271.40', '0.9047', [80]], ['吃饭', '236.40', '1.182', [80, 100]]]);
    const oct = await budgetProgress(ctx, ledger, { date: '2026-10-15' });
    expect(oct.items.find(i => i.name === '吃饭')).toMatchObject({ spent: '-20.00', remaining: '220.00', periodStart: '2026-10-01', periodEnd: '2026-11-01' });
    await expect(createBudget(ctx, ledger, { period: 'month', amount: { amount: '1.00', currency: 'USD' }, startDate: '2026-09-01' })).rejects.toMatchObject({ code: 'BUDGET_CURRENCY' });
    await expect(createBudget(ctx, ledger, { categoryId: salary, period: 'month', amount: { amount: '1.00', currency: 'CNY' }, startDate: '2026-09-01' })).rejects.toMatchObject({ code: 'INVALID_CATEGORY' });
    await expect(updateBudget(ctx, ledger, total.id, { amount: { amount: '400.00', currency: 'CNY' } }, '"v9"')).rejects.toMatchObject({ status: 412 });
    expect(await updateBudget(ctx, ledger, total.id, { amount: { amount: '400.00', currency: 'CNY' } }, '"v1"')).toMatchObject({ amount: { amount: '400.00' }, version: 2 });
    await archiveBudget(ctx, ledger, total.id, '"v2"');
    expect((await listBudgets(ctx, ledger, { limit: 10 })).map(b => b.id)).toEqual([dining.id]);
  });
});
