import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CURRENCY_TABLE } from '../../packages/contracts/src/common';
import { database, databasePool } from '../../packages/db/src/index';
import { accountPostings, accounts, categories, currencies, fxSnapshots, ledgers, tags, transactionAmounts, transactionTags, transactions } from '../../packages/db/src/schema';
import { formatAmount, sum, toColumn } from '../../packages/domain/src/money';
import { appendPostings, verifyBalance } from '../../packages/domain/src/postings';
import { accepted, crossRates } from '../fixtures/money';
import { mysqlError, seedAccount, seedLedger, seedTransaction, seedUser, transactionRow } from './db';

const FK = 'ER_NO_REFERENCED_ROW_2', CHECK = 'ER_CHECK_CONSTRAINT_VIOLATED', DUPLICATE = 'ER_DUP_ENTRY';
let owner: string, ledgerA: string, ledgerB: string;
beforeAll(async () => {
  owner = await seedUser();
  [ledgerA, ledgerB] = [await seedLedger(owner), await seedLedger(owner, 'USD')];
});
afterAll(() => databasePool().end());

describe('migration 0003', () => {
  it('seeds currencies exactly as the shared currency table', async () => {
    const rows = await database().select().from(currencies);
    expect(Object.fromEntries(rows.map(r => [r.code, { minorUnits: r.minorUnits, enabled: r.enabled }]))).toEqual(CURRENCY_TABLE);
  });
  it('stores boundary amounts and rates in DECIMAL without loss', async () => {
    for (const [, currency, canonical] of accepted) {
      const id = await seedAccount(ledgerA, currency, canonical);
      const [row] = await database().select({ opening: accounts.openingBalance }).from(accounts).where(eq(accounts.id, id));
      expect(typeof row.opening).toBe('string');
      expect(formatAmount(row.opening, currency), `${canonical} ${currency}`).toBe(canonical);
    }
    for (const [, , rate] of crossRates) {
      const id = randomUUID();
      await database().insert(fxSnapshots).values({ id, ledgerId: ledgerA, baseCurrency: 'CNY', quoteCurrency: 'JPY', rate, source: 'test', freshness: 'fresh', createdBy: owner, createdAt: new Date() });
      const [row] = await database().select({ rate: fxSnapshots.rate }).from(fxSnapshots).where(eq(fxSnapshots.id, id));
      expect(sum([row.rate]).toFixed()).toBe(rate);
    }
  });
});

describe('composite foreign keys keep every reference inside one ledger', () => {
  it('rejects cross-ledger accounts, categories, transactions, tags and snapshots', async () => {
    const accountA = await seedAccount(ledgerA, 'CNY'), txA = await seedTransaction(ledgerA, owner);
    const categoryA = randomUUID(), tagA = randomUUID(), snapshotA = randomUUID(), now = new Date();
    await database().insert(categories).values({ id: categoryA, ledgerId: ledgerA, name: '餐饮', kind: 'expense', createdAt: now, updatedAt: now });
    await database().insert(tags).values({ id: tagA, ledgerId: ledgerA, name: `t-${tagA.slice(0, 8)}`, createdAt: now, updatedAt: now });
    await database().insert(fxSnapshots).values({ id: snapshotA, ledgerId: ledgerA, baseCurrency: 'USD', quoteCurrency: 'CNY', rate: '7.2', source: 'test', freshness: 'fresh', createdBy: owner, createdAt: now });
    const txB = await seedTransaction(ledgerB, owner);
    expect(await mysqlError(seedTransaction(ledgerB, owner, { kind: 'expense', accountId: accountA }))).toBe(FK);
    expect(await mysqlError(seedTransaction(ledgerB, owner, { kind: 'expense', accountId: await seedAccount(ledgerB, 'USD'), categoryId: categoryA }))).toBe(FK);
    expect(await mysqlError(seedTransaction(ledgerB, owner, { kind: 'refund', accountId: await seedAccount(ledgerB, 'USD'), refundOf: txA }))).toBe(FK);
    expect(await mysqlError(database().insert(accountPostings).values({ id: randomUUID(), ledgerId: ledgerB, transactionId: txB, accountId: accountA, currency: 'CNY', signedAmount: '1', createdAt: now }))).toBe(FK);
    expect(await mysqlError(database().insert(accountPostings).values({ id: randomUUID(), ledgerId: ledgerA, transactionId: txB, accountId: accountA, currency: 'CNY', signedAmount: '1', createdAt: now }))).toBe(FK);
    expect(await mysqlError(database().insert(categories).values({ id: randomUUID(), ledgerId: ledgerB, parentId: categoryA, name: '子类', kind: 'expense', createdAt: now, updatedAt: now }))).toBe(FK);
    expect(await mysqlError(database().insert(transactionTags).values({ ledgerId: ledgerB, transactionId: txB, tagId: tagA }))).toBe(FK);
    expect(await mysqlError(database().insert(transactionAmounts).values({ ledgerId: ledgerB, transactionId: txB, originalAmount: '1', originalCurrency: 'USD', settlementAmount: '1', settlementCurrency: 'USD', baseAmount: '7.2', baseCurrency: 'CNY', fxSnapshotId: snapshotA }))).toBe(FK);
  });
  it('forces each posting into its account currency', async () => {
    const usd = await seedAccount(ledgerB, 'USD'), tx = await seedTransaction(ledgerB, owner);
    expect(await mysqlError(database().insert(accountPostings).values({ id: randomUUID(), ledgerId: ledgerB, transactionId: tx, accountId: usd, currency: 'CNY', signedAmount: '1', createdAt: new Date() }))).toBe(FK);
  });
  it('refuses to delete a ledger that has financial rows', async () => {
    expect(await mysqlError(database().delete(ledgers).where(eq(ledgers.id, ledgerA)))).toBe('ER_ROW_IS_REFERENCED_2');
  });
});

describe('check constraints guard money invariants', () => {
  it('rejects malformed transactions, amounts, postings and snapshots', async () => {
    const account = await seedAccount(ledgerA, 'CNY'), tx = await seedTransaction(ledgerA, owner), now = new Date();
    const posting = { id: randomUUID(), ledgerId: ledgerA, transactionId: tx, accountId: account, currency: 'CNY', createdAt: now };
    expect(await mysqlError(database().insert(accountPostings).values({ ...posting, signedAmount: '0' }))).toBe(CHECK);
    expect(await mysqlError(seedTransaction(ledgerA, owner, { kind: 'expense' }))).toBe(CHECK);
    expect(await mysqlError(seedTransaction(ledgerA, owner, { kind: 'transfer', accountId: account }))).toBe(CHECK);
    expect(await mysqlError(seedTransaction(ledgerA, owner, { kind: 'refund', accountId: account }))).toBe(CHECK);
    expect(await mysqlError(seedTransaction(ledgerA, owner, { kind: 'expense', accountId: account, refundOf: tx }))).toBe(CHECK);
    expect(await mysqlError(seedTransaction(ledgerA, owner, { status: 'voided' }))).toBe(CHECK);
    const amounts = { ledgerId: ledgerA, originalCurrency: 'CNY', settlementCurrency: 'CNY', baseCurrency: 'CNY', originalAmount: '1', settlementAmount: '1', baseAmount: '1' };
    expect(await mysqlError(database().insert(transactionAmounts).values({ ...amounts, transactionId: await seedTransaction(ledgerA, owner), originalAmount: '-1' }))).toBe(CHECK);
    expect(await mysqlError(database().insert(transactionAmounts).values({ ...amounts, transactionId: await seedTransaction(ledgerA, owner), settlementAmount: '0' }))).toBe(CHECK);
    expect(await mysqlError(database().insert(transactionAmounts).values({ ...amounts, transactionId: await seedTransaction(ledgerA, owner), settlementCurrency: 'USD' }))).toBe(CHECK);
    const snapshot = { ledgerId: ledgerA, baseCurrency: 'USD', quoteCurrency: 'CNY', source: 'test', createdBy: owner, createdAt: now };
    expect(await mysqlError(database().insert(fxSnapshots).values({ ...snapshot, id: randomUUID(), rate: '0', freshness: 'fresh' }))).toBe(CHECK);
    expect(await mysqlError(database().insert(fxSnapshots).values({ ...snapshot, id: randomUUID(), rate: '7.1', freshness: 'manual' }))).toBe(CHECK);
    expect(await mysqlError(database().insert(fxSnapshots).values({ ...snapshot, id: randomUUID(), rate: '1', freshness: 'fresh', quoteCurrency: 'USD' }))).toBe(CHECK);
    expect(await mysqlError(database().insert(accounts).values({ id: randomUUID(), ledgerId: ledgerA, name: 'x', type: 'cash', currency: 'GBP', createdAt: now, updatedAt: now }))).toBe(FK);
  });
  it('allows each posting line to be reversed only once', async () => {
    const account = await seedAccount(ledgerA, 'CNY', '100');
    const tx = await seedTransaction(ledgerA, owner);
    const [line] = await database().transaction(t => appendPostings(t, ledgerA, tx, [{ accountId: account, amount: '-12.50' }]));
    await database().transaction(t => appendPostings(t, ledgerA, tx, [{ accountId: account, amount: '12.50', reversesId: line.id }]));
    expect(await mysqlError(database().transaction(t => appendPostings(t, ledgerA, tx, [{ accountId: account, amount: '12.50', reversesId: line.id }])))).toBe(DUPLICATE);
    expect(await verifyBalance(ledgerA, account)).toEqual({ cached: '100.00', computed: '100.00', consistent: true });
  });
});

describe('appendPostings', () => {
  it('enforces account currency precision and ledger ownership', async () => {
    const jpy = await seedAccount(ledgerA, 'JPY'), kwd = await seedAccount(ledgerA, 'KWD'), foreign = await seedAccount(ledgerB, 'USD');
    const archived = await seedAccount(ledgerA, 'CNY', '0', { archivedAt: new Date() });
    const tx = await seedTransaction(ledgerA, owner);
    const attempt = (accountId: string, amount: string) => database().transaction(t => appendPostings(t, ledgerA, tx, [{ accountId, amount }]));
    await expect(attempt(jpy, '1500.5')).rejects.toMatchObject({ code: 'AMOUNT_PRECISION' });
    await expect(attempt(kwd, '-0.0005')).rejects.toMatchObject({ code: 'AMOUNT_PRECISION' });
    await expect(attempt(jpy, '0')).rejects.toMatchObject({ code: 'AMOUNT_NOT_POSITIVE' });
    await expect(attempt(foreign, '1.00')).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
    await expect(attempt(archived, '1.00')).rejects.toMatchObject({ code: 'ACCOUNT_ARCHIVED' });
    await attempt(jpy, '1500'); await attempt(kwd, '-1.235');
    expect(await verifyBalance(ledgerA, jpy)).toMatchObject({ cached: '1500', consistent: true });
    expect(await verifyBalance(ledgerA, kwd)).toMatchObject({ cached: '-1.235', consistent: true });
    const rows = await database().select().from(accountPostings).where(and(eq(accountPostings.ledgerId, ledgerA), eq(accountPostings.transactionId, tx)));
    expect(rows.map(r => r.signedAmount).sort()).toEqual(['-1.235000', '1500.000000']);
  });
  it('keeps 0.1 + 0.2 exact in storage and in the SQL rebuild', async () => {
    const account = await seedAccount(ledgerA, 'USD');
    await database().transaction(async t => { const tx = await seedTransaction(ledgerA, owner, {}, t); await appendPostings(t, ledgerA, tx, [{ accountId: account, amount: '0.10' }, { accountId: account, amount: '0.20' }]); });
    expect(await verifyBalance(ledgerA, account)).toEqual({ cached: '0.30', computed: '0.30', consistent: true });
  });
  it('loses no update when many writers post to one account at once', async () => {
    const account = await seedAccount(ledgerA, 'CNY', '1000.00');
    await Promise.all(Array.from({ length: 25 }, () => database().transaction(async t => {
      const tx = await seedTransaction(ledgerA, owner, {}, t);
      await appendPostings(t, ledgerA, tx, [{ accountId: account, amount: '0.10' }]);
    })));
    expect(await verifyBalance(ledgerA, account)).toEqual({ cached: '1002.50', computed: '1002.50', consistent: true });
  });
  it('runs opposite transfers concurrently without deadlock and conserves the total', async () => {
    const a = await seedAccount(ledgerA, 'HKD', '500.00'), b = await seedAccount(ledgerA, 'HKD', '500.00');
    const transfer = (from: string, to: string, amount: string) => database().transaction(async t => {
      const tx = await seedTransaction(ledgerA, owner, {}, t);
      await appendPostings(t, ledgerA, tx, [{ accountId: from, amount: `-${amount}` }, { accountId: to, amount }]);
    });
    const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => (i % 2 ? transfer(a, b, '1.25') : transfer(b, a, '0.75'))));
    expect(results.filter(r => r.status === 'rejected')).toEqual([]);
    const [ra, rb] = [await verifyBalance(ledgerA, a), await verifyBalance(ledgerA, b)];
    expect([ra.consistent, rb.consistent]).toEqual([true, true]);
    expect(ra.cached).toBe('492.50'); // 500 − 15 × 1.25 + 15 × 0.75
    expect(formatAmount(sum([ra.cached, rb.cached]), 'HKD')).toBe('1000.00');
  });
  it('detects a balance that was changed outside appendPostings', async () => {
    const account = await seedAccount(ledgerA, 'EUR', '10.00');
    await database().update(accounts).set({ balance: toColumn('10.01') }).where(eq(accounts.id, account));
    expect(await verifyBalance(ledgerA, account)).toEqual({ cached: '10.01', computed: '10.00', consistent: false });
    await expect(verifyBalance(ledgerB, account)).rejects.toMatchObject({ status: 404 });
  });
});

it('accepts a well-formed transaction graph', async () => {
  const usd = await seedAccount(ledgerA, 'USD', '0'), now = new Date(), snapshot = randomUUID();
  await database().insert(fxSnapshots).values({ id: snapshot, ledgerId: ledgerA, baseCurrency: 'USD', quoteCurrency: 'CNY', rate: '7.2', source: 'manual', freshness: 'manual', manualReason: '银行账单汇率', createdBy: owner, createdAt: now });
  const row = transactionRow(ledgerA, owner, { kind: 'expense', accountId: usd, merchant: '示例软件' });
  await database().transaction(async t => {
    await t.insert(transactions).values(row);
    await t.insert(transactionAmounts).values({ ledgerId: ledgerA, transactionId: row.id, originalAmount: '12', originalCurrency: 'USD', settlementAmount: '12', settlementCurrency: 'USD', baseAmount: '86.4', baseCurrency: 'CNY', fxSnapshotId: snapshot });
    await appendPostings(t, ledgerA, row.id, [{ accountId: usd, amount: '-12.00' }]);
  });
  const refund = transactionRow(ledgerA, owner, { kind: 'refund', accountId: usd, refundOf: row.id });
  await database().transaction(async t => { await t.insert(transactions).values(refund); await appendPostings(t, ledgerA, refund.id, [{ accountId: usd, amount: '2.00' }]); });
  expect(await verifyBalance(ledgerA, usd)).toEqual({ cached: '-10.00', computed: '-10.00', consistent: true });
});
