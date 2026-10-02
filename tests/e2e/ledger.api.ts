import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { expectContract } from './contract';
import { ledger, test, user } from './helpers';

const at = '2026-10-01T18:30:00.000Z';
async function setup() {
  const owner = await user('money'), book = await ledger(owner.client), base = `/api/v1/ledgers/${book.id}`;
  const post = async (path: string, data: unknown, operationId: string, headers: Record<string, string> = {}) => (await expectContract(await owner.client.post(`${base}${path}`, { data, headers }), operationId, 201)).data;
  const cash = await post('/accounts', { name: '现金', type: 'cash', currency: 'CNY', openingBalance: '500' }, 'createAccount');
  const food = await post('/categories', { name: '餐饮', kind: 'expense' }, 'createCategory');
  return { owner, book, base, post, cash, food };
}
async function record(client: APIRequestContext, base: string, body: Record<string, unknown>, key = randomUUID()) {
  const preview = (await expectContract(await client.post(`${base}/transaction-previews`, { data: body }), 'createTransactionPreview', 201)).data;
  const response = await client.post(`${base}/transactions`, { data: { previewId: preview.previewId }, headers: { 'Idempotency-Key': key } });
  return { preview, response, key };
}

test('accounts, categories and tags follow the contract with ETag concurrency', async () => {
  const { owner, base, post, cash, food } = await setup();
  expect(cash).toMatchObject({ currency: 'CNY', openingBalance: '500.00', balance: '500.00', archivedAt: null, version: 1 });
  const card = await post('/accounts', { name: '信用卡', type: 'credit_card', currency: 'USD', openingBalance: '-120.5' }, 'createAccount');
  expect(card.balance).toBe('-120.50');
  await expectContract(await owner.client.post(`${base}/accounts`, { data: { name: '日元', type: 'cash', currency: 'JPY', openingBalance: '0.5' } }), 'createAccount', 422);
  await expectContract(await owner.client.get(`${base}/accounts/${cash.id}`), 'getAccount', 200);
  await expectContract(await owner.client.patch(`${base}/accounts/${cash.id}`, { data: { name: '钱包' } }), 'updateAccount', 428);
  const renamed = await expectContract(await owner.client.patch(`${base}/accounts/${cash.id}`, { data: { name: '钱包', note: '日常' }, headers: { 'If-Match': '"v1"' } }), 'updateAccount', 200);
  expect(renamed.data).toMatchObject({ name: '钱包', note: '日常', version: 2 });
  await expectContract(await owner.client.patch(`${base}/accounts/${cash.id}`, { data: { currency: 'USD' }, headers: { 'If-Match': '"v2"' } }), 'updateAccount', 422);
  const archived = await expectContract(await owner.client.delete(`${base}/accounts/${card.id}`, { headers: { 'If-Match': '"v1"' } }), 'archiveAccount', 200);
  expect(archived.data.archivedAt).not.toBeNull();
  expect((await expectContract(await owner.client.delete(`${base}/accounts/${card.id}`, { headers: { 'If-Match': '"v1"' } }), 'archiveAccount', 200)).data.version).toBe(2);
  const active = await expectContract(await owner.client.get(`${base}/accounts`), 'listAccounts', 200);
  expect(active.data.map((a: { id: string }) => a.id)).toEqual([cash.id]);
  const all = await expectContract(await owner.client.get(`${base}/accounts?includeArchived=true&limit=1`), 'listAccounts', 200);
  expect(all.page.hasMore).toBe(true);

  const sub = await post('/categories', { name: '外卖', kind: 'expense', parentId: food.id }, 'createCategory');
  expect(sub.parentId).toBe(food.id);
  await expectContract(await owner.client.post(`${base}/categories`, { data: { name: '三级', kind: 'expense', parentId: sub.id } }), 'createCategory', 422);
  await expectContract(await owner.client.patch(`${base}/categories/${sub.id}`, { data: { name: '外卖配送' }, headers: { 'If-Match': '"v1"' } }), 'updateCategory', 200);
  await expectContract(await owner.client.get(`${base}/categories`), 'listCategories', 200);
  await expectContract(await owner.client.delete(`${base}/categories/${sub.id}`, { headers: { 'If-Match': '"v2"' } }), 'archiveCategory', 200);
  const tag = await post('/tags', { name: '出差' }, 'createTag');
  expect((await expectContract(await owner.client.post(`${base}/tags`, { data: { name: '出差' } }), 'createTag', 409)).code).toBe('TAG_EXISTS');
  await expectContract(await owner.client.patch(`${base}/tags/${tag.id}`, { data: { name: '差旅' }, headers: { 'If-Match': '"v1"' } }), 'updateTag', 200);
  await expectContract(await owner.client.get(`${base}/tags`), 'listTags', 200);
  await expectContract(await owner.client.delete(`${base}/tags/${tag.id}`, { headers: { 'If-Match': '"v2"' } }), 'archiveTag', 200);

  const viewer = await user('money-viewer');
  await owner.client.post(`${base}/memberships`, { data: { email: viewer.email, role: 'viewer' } });
  await expectContract(await viewer.client.get(`${base}/accounts`), 'listAccounts', 200);
  await expectContract(await viewer.client.post(`${base}/accounts`, { data: { name: 'x', type: 'cash', currency: 'CNY' } }), 'createAccount', 403);
  await expectContract(await viewer.client.post(`${base}/transaction-previews`, { data: { kind: 'expense', accountId: cash.id, settlement: { amount: '1.00', currency: 'CNY' }, occurredAt: at, timezone: 'UTC' } }), 'createTransactionPreview', 403);
  const outsider = await user('money-outsider');
  await expectContract(await outsider.client.get(`${base}/accounts/${cash.id}`), 'getAccount', 404);
  await owner.client.dispose(); await viewer.client.dispose(); await outsider.client.dispose();
});

test('a duplicated submission moves money once; previews are single-use', async () => {
  const { owner, base, cash, food } = await setup();
  const body = { kind: 'expense', accountId: cash.id, settlement: { amount: '28.50', currency: 'CNY' }, categoryId: food.id, merchant: '茶餐厅', occurredAt: at, timezone: 'Asia/Hong_Kong' };
  const { preview, response, key } = await record(owner.client, base, body);
  expect(preview).toMatchObject({ accountDeltas: [{ accountId: cash.id, delta: '-28.50', currency: 'CNY' }], exchangeRate: null });
  const created = (await expectContract(response, 'createTransaction', 201)).data;
  expect(response.headers().location).toBe(`${base}/transactions/${created.id}`);
  const replay = await owner.client.post(`${base}/transactions`, { data: { previewId: preview.previewId }, headers: { 'Idempotency-Key': key } });
  expect((await expectContract(replay, 'createTransaction', 201)).data.id).toBe(created.id);
  expect(replay.headers()['idempotent-replayed']).toBe('true');
  expect((await expectContract(await owner.client.post(`${base}/transactions`, { data: { previewId: preview.previewId }, headers: { 'Idempotency-Key': randomUUID() } }), 'createTransaction', 409)).code).toBe('PREVIEW_CONSUMED');
  expect((await expectContract(await owner.client.post(`${base}/transactions`, { data: { previewId: preview.previewId } }), 'createTransaction', 400)).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  // Six concurrent retries of one intent: one transaction.
  const again = await record(owner.client, base, { ...body, settlement: { amount: '10.00', currency: 'CNY' } });
  const racing = await Promise.all(Array.from({ length: 6 }, () => owner.client.post(`${base}/transactions`, { data: { previewId: again.preview.previewId }, headers: { 'Idempotency-Key': again.key } })));
  expect(racing.map(r => r.status())).toEqual(Array(6).fill(201));
  expect((await expectContract(await owner.client.get(`${base}/accounts/${cash.id}`), 'getAccount', 200)).data.balance).toBe('461.50');
  expect((await expectContract(await owner.client.get(`${base}/transactions/${created.id}`), 'getTransaction', 200)).data).toMatchObject({ merchant: '茶餐厅', localDate: '2026-10-02', status: 'posted' });
  await owner.client.dispose();
});

test('transfers, refunds, corrections and voids keep balances and history right', async () => {
  const { owner, base, post, cash, food } = await setup();
  const hkd = await post('/accounts', { name: '港币', type: 'bank', currency: 'HKD', openingBalance: '2000' }, 'createAccount');
  const transfer = (await expectContract((await record(owner.client, base, { kind: 'transfer', sourceAccountId: hkd.id, targetAccountId: cash.id, sourceAmount: { amount: '1000.00', currency: 'HKD' }, targetAmount: { amount: '920.00', currency: 'CNY' }, fee: { amount: { amount: '15.00', currency: 'HKD' }, categoryId: food.id }, occurredAt: at, timezone: 'Asia/Hong_Kong' })).response, 'createTransaction', 201)).data;
  expect(transfer).toMatchObject({ kind: 'transfer', categoryId: null, transfer: { sourceAccountId: hkd.id, targetAccountId: cash.id }, exchangeRate: { value: '0.92', source: 'transfer' } });
  const balances = async () => Object.fromEntries((await (await owner.client.get(`${base}/accounts`)).json()).data.map((a: { id: string; balance: string }) => [a.id, a.balance]));
  expect(await balances()).toEqual({ [cash.id]: '1420.00', [hkd.id]: '985.00' });

  const usd = { kind: 'expense', accountId: cash.id, settlement: { amount: '12.00', currency: 'USD' }, occurredAt: at, timezone: 'UTC' };
  expect((await expectContract(await owner.client.post(`${base}/transaction-previews`, { data: usd }), 'createTransactionPreview', 422)).code).toBe('CURRENCY_MISMATCH');
  const paid = (await expectContract((await record(owner.client, base, { kind: 'expense', accountId: cash.id, settlement: { amount: '200.00', currency: 'CNY' }, categoryId: food.id, occurredAt: at, timezone: 'UTC' })).response, 'createTransaction', 201)).data;
  const refundPreview = (await expectContract(await owner.client.post(`${base}/transaction-previews`, { data: { kind: 'refund', originalTransactionId: paid.id, accountId: cash.id, settlement: { amount: '50.00', currency: 'CNY' }, occurredAt: at, timezone: 'UTC' } }), 'createTransactionPreview', 201)).data;
  const refund = (await expectContract(await owner.client.post(`${base}/transactions/${paid.id}/refunds`, { data: { previewId: refundPreview.previewId }, headers: { 'Idempotency-Key': randomUUID() } }), 'createRefund', 201)).data;
  expect(refund).toMatchObject({ kind: 'refund', refundOf: paid.id, categoryId: food.id });
  expect((await expectContract(await owner.client.post(`${base}/transaction-previews`, { data: { kind: 'refund', originalTransactionId: paid.id, accountId: cash.id, settlement: { amount: '150.01', currency: 'CNY' }, occurredAt: at, timezone: 'UTC' } }), 'createTransactionPreview', 409)).code).toBe('REFUND_EXCEEDS_PAID');
  expect((await expectContract(await owner.client.delete(`${base}/transactions/${paid.id}`, { headers: { 'If-Match': '"v1"' } }), 'voidTransaction', 409)).code).toBe('HAS_REFUNDS');
  await expectContract(await owner.client.delete(`${base}/transactions/${refund.id}`, { headers: { 'If-Match': '"v1"' } }), 'voidTransaction', 200);

  const fix = (await expectContract(await owner.client.post(`${base}/transaction-previews`, { data: { kind: 'expense', accountId: cash.id, settlement: { amount: '180.00', currency: 'CNY' }, categoryId: food.id, occurredAt: at, timezone: 'UTC' } }), 'createTransactionPreview', 201)).data;
  await expectContract(await owner.client.patch(`${base}/transactions/${paid.id}`, { data: { previewId: fix.previewId }, headers: { 'If-Match': '"v9"' } }), 'updateTransaction', 412);
  const corrected = (await expectContract(await owner.client.patch(`${base}/transactions/${paid.id}`, { data: { previewId: fix.previewId }, headers: { 'If-Match': '"v1"' } }), 'updateTransaction', 200)).data;
  expect(corrected).toMatchObject({ replacesId: paid.id, settlement: { amount: '180.00' } });
  expect((await balances())[cash.id]).toBe('1240.00'); // 1420 − 200 + 50 − 50 + 200 − 180

  const voided = (await expectContract(await owner.client.delete(`${base}/transactions/${transfer.id}`, { headers: { 'If-Match': '"v1"' } }), 'voidTransaction', 200)).data;
  expect(voided.status).toBe('voided');
  expect(await balances()).toEqual({ [cash.id]: '320.00', [hkd.id]: '2000.00' });

  const posted = await expectContract(await owner.client.get(`${base}/transactions`), 'listTransactions', 200);
  expect(posted.data.map((t: { id: string }) => t.id)).toEqual([corrected.id]); // voided and replaced versions are hidden by default
  const history = await expectContract(await owner.client.get(`${base}/transactions?status=all&sort=-amount&limit=100`), 'listTransactions', 200);
  const amounts = history.data.map((t: { base: { amount: string } }) => Number(t.base.amount)); // ordering check only
  expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
  const byAccount = await expectContract(await owner.client.get(`${base}/transactions?accountId=${hkd.id}&status=all`), 'listTransactions', 200);
  expect(byAccount.data.map((t: { kind: string }) => t.kind).sort()).toEqual(['expense', 'transfer']); // the transfer and its fee
  const search = await expectContract(await owner.client.get(`${base}/transactions?q=${encodeURIComponent('100%_')}`), 'listTransactions', 200);
  expect(search.data).toEqual([]);
  const first = await expectContract(await owner.client.get(`${base}/transactions?status=all&limit=2`), 'listTransactions', 200);
  const ids = first.data.map((t: { id: string }) => t.id);
  let cursor = first.page.nextCursor as string | null;
  while (cursor) { const next = await expectContract(await owner.client.get(`${base}/transactions?status=all&limit=2&cursor=${encodeURIComponent(cursor)}`), 'listTransactions', 200); ids.push(...next.data.map((t: { id: string }) => t.id)); cursor = next.page.nextCursor; }
  expect(new Set(ids)).toEqual(new Set(history.data.map((t: { id: string }) => t.id)));
  expect(ids).toHaveLength(5); // transfer, fee, expense, refund, correction
  expect((await expectContract(await owner.client.get(`${base}/transactions?sort=-amount&cursor=${encodeURIComponent(first.page.nextCursor)}`), 'listTransactions', 400)).code).toBe('INVALID_CURSOR');
  await owner.client.dispose();
});
