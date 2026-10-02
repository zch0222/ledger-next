import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { expectContract } from './contract';
import { ledger, test, user } from './helpers';

test('reports, budgets and their cache follow the contract and the money rules', async () => {
  const owner = await user('reports'), book = await ledger(owner.client), base = `/api/v1/ledgers/${book.id}`;
  const post = async (path: string, data: unknown, operationId: string) => (await expectContract(await owner.client.post(`${base}${path}`, { data }), operationId, 201)).data;
  const cash = await post('/accounts', { name: '现金', type: 'cash', currency: 'CNY', openingBalance: '1000' }, 'createAccount');
  const savings = await post('/accounts', { name: '储蓄', type: 'bank', currency: 'CNY' }, 'createAccount');
  const food = await post('/categories', { name: '餐饮', kind: 'expense' }, 'createCategory');
  const record = async (body: Record<string, unknown>) => {
    const preview = await post('/transaction-previews', { timezone: 'Asia/Hong_Kong', ...body }, 'createTransactionPreview');
    return (await expectContract(await owner.client.post(`${base}/transactions`, { data: { previewId: preview.previewId }, headers: { 'Idempotency-Key': randomUUID() } }), 'createTransaction', 201)).data;
  };
  await record({ kind: 'income', accountId: cash.id, settlement: { amount: '500.00', currency: 'CNY' }, occurredAt: '2026-09-02T04:00:00.000Z' });
  const lunch = await record({ kind: 'expense', accountId: cash.id, settlement: { amount: '80.00', currency: 'CNY' }, categoryId: food.id, occurredAt: '2026-09-03T04:00:00.000Z' });
  await record({ kind: 'transfer', sourceAccountId: cash.id, targetAccountId: savings.id, sourceAmount: { amount: '300.00', currency: 'CNY' }, targetAmount: { amount: '300.00', currency: 'CNY' }, occurredAt: '2026-09-04T04:00:00.000Z' });
  const refundPreview = await post('/transaction-previews', { kind: 'refund', originalTransactionId: lunch.id, accountId: cash.id, settlement: { amount: '30.00', currency: 'CNY' }, occurredAt: '2026-09-05T04:00:00.000Z', timezone: 'Asia/Hong_Kong' }, 'createTransactionPreview');
  await expectContract(await owner.client.post(`${base}/transactions/${lunch.id}/refunds`, { data: { previewId: refundPreview.previewId }, headers: { 'Idempotency-Key': randomUUID() } }), 'createRefund', 201);

  const period = 'dateFrom=2026-09-01&dateTo=2026-10-01';
  const summary = await expectContract(await owner.client.get(`${base}/reports/summary?${period}`), 'getReportSummary', 200);
  expect(summary.data).toMatchObject({ income: '500.00', expense: '80.00', refunds: '30.00', net: '450.00', currency: 'CNY', valuationMode: 'historical', partial: false, excludedCount: 0, upcomingBills: { count: 0 } });
  const flow = await expectContract(await owner.client.get(`${base}/reports/cash-flow?${period}&interval=month`), 'getCashFlow', 200);
  expect(flow.data.points).toEqual([{ date: '2026-09-01', income: '500.00', expense: '50.00', net: '450.00' }]);
  const categories = await expectContract(await owner.client.get(`${base}/reports/category-breakdown?${period}`), 'getCategoryBreakdown', 200);
  expect(categories.data.items).toEqual([{ categoryId: food.id, name: '餐饮', amount: '50.00', share: '1', count: 1 }]);
  const balances = await expectContract(await owner.client.get(`${base}/reports/account-balances`), 'getAccountBalances', 200);
  expect(balances.data).toMatchObject({ total: '1450.00', items: [{ name: '现金', balance: '1150.00' }, { name: '储蓄', balance: '300.00' }] });
  await expectContract(await owner.client.get(`${base}/reports/summary?dateFrom=2026-10-01&dateTo=2026-09-01`), 'getReportSummary', 422);
  await expectContract(await owner.client.get(`${base}/reports/cash-flow?dateFrom=2020-01-01&dateTo=2026-01-01&interval=day`), 'getCashFlow', 422);
  await expectContract(await owner.client.get(`${base}/reports/summary?dateFrom=2026-09-01`), 'getReportSummary', 422);

  const budget = await expectContract(await owner.client.post(`${base}/budgets`, { data: { categoryId: food.id, period: 'month', amount: { amount: '60.00', currency: 'CNY' }, startDate: '2026-09-01' } }), 'createBudget', 201);
  const progress = await expectContract(await owner.client.get(`${base}/reports/budget-progress?date=2026-09-20`), 'getBudgetProgress', 200);
  expect(progress.data.items).toEqual([expect.objectContaining({ budgetId: budget.data.id, spent: '50.00', remaining: '10.00', ratio: '0.8333', reachedThresholds: [80] })]);
  await expectContract(await owner.client.patch(`${base}/budgets/${budget.data.id}`, { data: { amount: { amount: '100.00', currency: 'CNY' } } }), 'updateBudget', 428);
  await expectContract(await owner.client.patch(`${base}/budgets/${budget.data.id}`, { data: { amount: { amount: '100.00', currency: 'CNY' } }, headers: { 'If-Match': '"v1"' } }), 'updateBudget', 200);
  await expectContract(await owner.client.post(`${base}/budgets`, { data: { period: 'month', amount: { amount: '1.00', currency: 'USD' }, startDate: '2026-09-01' } }), 'createBudget', 422);
  await expectContract(await owner.client.get(`${base}/budgets`), 'listBudgets', 200);

  // A write after a cached read is visible immediately (data version in the cache key).
  const before = summary.data.dataVersion;
  await record({ kind: 'expense', accountId: cash.id, settlement: { amount: '5.00', currency: 'CNY' }, occurredAt: '2026-09-06T04:00:00.000Z' });
  const after = await expectContract(await owner.client.get(`${base}/reports/summary?${period}`), 'getReportSummary', 200);
  expect(after.data).toMatchObject({ expense: '85.00' });
  expect(after.data.dataVersion).toBeGreaterThan(before);
  const response = await owner.client.get(`${base}/reports/summary?${period}`);
  expect(response.headers()['cache-control']).toBe('private, no-store');

  await expectContract(await owner.client.delete(`${base}/budgets/${budget.data.id}`, { headers: { 'If-Match': '"v2"' } }), 'archiveBudget', 200);
  const viewer = await user('reports-viewer');
  await owner.client.post(`${base}/memberships`, { data: { email: viewer.email, role: 'viewer' } });
  await expectContract(await viewer.client.get(`${base}/reports/summary?${period}`), 'getReportSummary', 200);
  await expectContract(await viewer.client.post(`${base}/budgets`, { data: { period: 'month', amount: { amount: '1.00', currency: 'CNY' }, startDate: '2026-09-01' } }), 'createBudget', 403);
  const outsider = await user('reports-outsider');
  await expectContract(await outsider.client.get(`${base}/reports/summary?${period}`), 'getReportSummary', 404);
  await owner.client.dispose(); await viewer.client.dispose(); await outsider.client.dispose();
});
