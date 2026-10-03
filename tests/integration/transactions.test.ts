import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, databasePool } from '../../packages/db/src/index';
import {
  accountPostings,
  auditLogs,
  memberships,
  outboxEvents,
  transactions,
  writePreviews,
} from '../../packages/db/src/schema';
import { createAccount, updateAccount } from '../../packages/domain/src/accounts';
import { archiveTag, createCategory, createTag } from '../../packages/domain/src/catalog';
import type { AuthContext } from '../../packages/domain/src/identity';
import { formatAmount, sum } from '../../packages/domain/src/money';
import { verifyBalance } from '../../packages/domain/src/postings';
import {
  correctTransaction,
  createPreview,
  createRefund,
  createTransaction,
  getTransaction,
  voidTransaction,
} from '../../packages/domain/src/transactions';
import { seedLedger, seedUser } from './db';

let ctx: AuthContext;
let ledger: string;
let cash: string;
let card: string;
let hkd: string;
let food: string;
let salary: string;
const at = '2026-10-01T18:30:00.000Z'; // 2026-10-02 in Hong Kong
const formatted = (balance: string, delta: string) => formatAmount(sum([balance, delta]), 'CNY');
const balanceOf = async (accountId: string) => {
  const result = await verifyBalance(ledger, accountId);
  expect(result.consistent).toBe(true);
  return result.cached;
};
const submit = async (body: Record<string, unknown>) =>
  createTransaction(ctx, ledger, { previewId: (await createPreview(ctx, ledger, body)).previewId });
const expense = (amount: string, extra: Record<string, unknown> = {}) => ({
  kind: 'expense',
  accountId: cash,
  settlement: { amount, currency: 'CNY' },
  categoryId: food,
  occurredAt: at,
  timezone: 'Asia/Hong_Kong',
  ...extra,
});

beforeAll(async () => {
  const owner = await seedUser();
  ctx = { userId: owner, requestId: randomUUID() };
  ledger = await seedLedger(owner, 'CNY');
  cash = (await createAccount(ctx, ledger, { name: '现金', type: 'cash', currency: 'CNY', openingBalance: '1000' })).id;
  card = (await createAccount(ctx, ledger, { name: '美元卡', type: 'credit_card', currency: 'USD' })).id;
  hkd = (
    await createAccount(ctx, ledger, { name: '港币账户', type: 'bank', currency: 'HKD', openingBalance: '5000.00' })
  ).id;
  food = (await createCategory(ctx, ledger, { name: '餐饮', kind: 'expense' })).id;
  salary = (await createCategory(ctx, ledger, { name: '工资', kind: 'income' })).id;
});
afterAll(() => databasePool().end());

describe('preview and submit', () => {
  it('records an expense once, with audit and outbox in the same transaction', async () => {
    const preview = await createPreview(ctx, ledger, expense('28.50', { merchant: '茶餐厅', tagIds: [] }));
    expect(preview).toMatchObject({
      kind: 'expense',
      settlement: { amount: '28.50', currency: 'CNY' },
      base: { amount: '28.50', currency: 'CNY' },
      exchangeRate: null,
      accountDeltas: [{ accountId: cash, delta: '-28.50', currency: 'CNY' }],
    });
    expect(await balanceOf(cash)).toBe('1000.00'); // a preview moves no money
    const created = await createTransaction(ctx, ledger, { previewId: preview.previewId });
    expect(created).toMatchObject({
      kind: 'expense',
      status: 'posted',
      localDate: '2026-10-02',
      categoryId: food,
      merchant: '茶餐厅',
      version: 1,
    });
    expect(await balanceOf(cash)).toBe('971.50');
    await expect(createTransaction(ctx, ledger, { previewId: preview.previewId })).rejects.toMatchObject({
      status: 409,
      code: 'PREVIEW_CONSUMED',
    });
    expect(await balanceOf(cash)).toBe('971.50');
    const audit = await database()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.ledgerId, ledger), eq(auditLogs.resourceId, created.id)));
    const outbox = await database().select().from(outboxEvents).where(eq(outboxEvents.ledgerId, ledger));
    expect(audit.map(a => a.action)).toEqual(['transaction.created']);
    expect(
      outbox.filter(o => (o.payload as { transactionId: string }).transactionId === created.id).map(o => o.type),
    ).toEqual(['transaction.created']);
  });
  it('leaves nothing behind when the surrounding transaction fails', async () => {
    const preview = await createPreview(ctx, ledger, expense('10.00'));
    const before = await balanceOf(cash);
    let createdId = '';
    await expect(
      database().transaction(async tx => {
        createdId = (await createTransaction(ctx, ledger, { previewId: preview.previewId }, tx)).id;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await balanceOf(cash)).toBe(before);
    expect(await database().select().from(transactions).where(eq(transactions.id, createdId))).toEqual([]);
    expect(await database().select().from(auditLogs).where(eq(auditLogs.resourceId, createdId))).toEqual([]);
    expect(
      (await database().select().from(outboxEvents).where(eq(outboxEvents.ledgerId, ledger))).some(
        o => (o.payload as { transactionId: string }).transactionId === createdId,
      ),
    ).toBe(false);
    expect((await createTransaction(ctx, ledger, { previewId: preview.previewId })).kind).toBe('expense'); // preview still usable
  });
  it('rejects stale, expired, foreign and mismatched previews', async () => {
    const stale = await createPreview(ctx, ledger, expense('1.00'));
    const unrelated = await getTransaction(ctx, ledger, (await submit(expense('2.00'))).id); // balances may move freely
    expect(unrelated.status).toBe('posted');
    expect((await createTransaction(ctx, ledger, { previewId: stale.previewId })).status).toBe('posted');
    const renamed = await createPreview(ctx, ledger, expense('1.00'));
    await updateAccount(ctx, ledger, cash, { name: '现金钱包' }, '"v1"');
    await expect(createTransaction(ctx, ledger, { previewId: renamed.previewId })).rejects.toMatchObject({
      code: 'PREVIEW_STALE',
    });
    const tag = await createTag(ctx, ledger, { name: `出差-${randomUUID().slice(0, 6)}` });
    const tagged = await createPreview(ctx, ledger, expense('3.00', { tagIds: [tag.id] }));
    await archiveTag(ctx, ledger, tag.id, '"v1"');
    await expect(createTransaction(ctx, ledger, { previewId: tagged.previewId })).rejects.toMatchObject({
      code: 'INVALID_TAG',
    });
    const expired = await createPreview(ctx, ledger, expense('1.00'));
    await database()
      .update(writePreviews)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(writePreviews.id, expired.previewId));
    await expect(createTransaction(ctx, ledger, { previewId: expired.previewId })).rejects.toMatchObject({
      code: 'PREVIEW_EXPIRED',
    });
    const other = { userId: await seedUser(), requestId: randomUUID() };
    await database()
      .insert(memberships)
      .values({ id: randomUUID(), ledgerId: ledger, userId: other.userId, role: 'editor', createdAt: new Date() });
    const mine = await createPreview(ctx, ledger, expense('1.00'));
    await expect(createTransaction(other, ledger, { previewId: mine.previewId })).rejects.toMatchObject({
      code: 'PREVIEW_NOT_FOUND',
    });
    const refundPreview = await createPreview(ctx, ledger, {
      kind: 'refund',
      originalTransactionId: unrelated.id,
      accountId: cash,
      settlement: { amount: '1.00', currency: 'CNY' },
      occurredAt: at,
      timezone: 'Asia/Hong_Kong',
    });
    await expect(createTransaction(ctx, ledger, { previewId: refundPreview.previewId })).rejects.toMatchObject({
      code: 'PREVIEW_KIND_MISMATCH',
    });
  });
  it('validates amounts, categories and authorization before writing', async () => {
    const jpy = (await createAccount(ctx, ledger, { name: '日元', type: 'cash', currency: 'JPY' })).id;
    await expect(
      createPreview(ctx, ledger, {
        ...expense('1500.5'),
        accountId: jpy,
        settlement: { amount: '1500.5', currency: 'JPY' },
      }),
    ).rejects.toMatchObject({ code: 'AMOUNT_PRECISION' });
    await expect(
      createPreview(ctx, ledger, expense('5.00', { settlement: { amount: '5.00', currency: 'USD' } })),
    ).rejects.toMatchObject({ code: 'CURRENCY_MISMATCH' });
    await expect(createPreview(ctx, ledger, expense('5.00', { categoryId: salary }))).rejects.toMatchObject({
      code: 'INVALID_CATEGORY',
    });
    await expect(createPreview(ctx, ledger, expense('0'))).rejects.toMatchObject({ code: 'AMOUNT_NOT_POSITIVE' });
    const viewer = { userId: await seedUser(), requestId: randomUUID() };
    await database()
      .insert(memberships)
      .values({ id: randomUUID(), ledgerId: ledger, userId: viewer.userId, role: 'viewer', createdAt: new Date() });
    await expect(createPreview(viewer, ledger, expense('5.00'))).rejects.toMatchObject({ status: 403 });
    await expect(
      createPreview({ userId: await seedUser(), requestId: randomUUID() }, ledger, expense('5.00')),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('multi-currency', () => {
  it('needs a rate for a foreign settlement and locks the manual rate it was given', async () => {
    const usd = {
      kind: 'expense',
      accountId: card,
      settlement: { amount: '12.00', currency: 'USD' },
      categoryId: food,
      occurredAt: at,
      timezone: 'Asia/Hong_Kong',
    };
    await expect(createPreview(ctx, ledger, usd)).rejects.toMatchObject({ code: 'FX_RATE_MISSING' });
    await expect(
      createPreview(ctx, ledger, { ...usd, manualRate: { value: '7.2', reason: '银行账单' } }),
    ).rejects.toMatchObject({ code: 'INVALID_FX_POLICY' });
    const created = await submit({ ...usd, fxPolicy: 'manual', manualRate: { value: '7.2', reason: '银行账单' } });
    expect(created).toMatchObject({
      settlement: { amount: '12.00', currency: 'USD' },
      base: { amount: '86.40', currency: 'CNY', estimated: false },
      exchangeRate: {
        value: '7.2',
        base: 'USD',
        quote: 'CNY',
        freshness: 'manual',
        source: 'manual',
        manualReason: '银行账单',
      },
    });
    expect(await balanceOf(card)).toBe('-12.00'); // credit card liability
  });
  it('records a cross-currency transfer with a linked fee; principal is neither income nor expense', async () => {
    const created = await submit({
      kind: 'transfer',
      sourceAccountId: hkd,
      targetAccountId: cash,
      sourceAmount: { amount: '1000.00', currency: 'HKD' },
      targetAmount: { amount: '920.00', currency: 'CNY' },
      fee: { amount: { amount: '15.00', currency: 'HKD' }, categoryId: food },
      occurredAt: at,
      timezone: 'Asia/Hong_Kong',
    });
    expect(created).toMatchObject({
      kind: 'transfer',
      accountId: null,
      categoryId: null,
      base: { amount: '920.00', currency: 'CNY' },
      exchangeRate: { value: '0.92', base: 'HKD', quote: 'CNY', source: 'transfer' },
      transfer: {
        sourceAccountId: hkd,
        targetAccountId: cash,
        sourceAmount: { amount: '1000.00', currency: 'HKD' },
        targetAmount: { amount: '920.00', currency: 'CNY' },
      },
    });
    const fee = await getTransaction(ctx, ledger, created.transfer!.feeTransactionId!);
    expect(fee).toMatchObject({
      kind: 'expense',
      accountId: hkd,
      settlement: { amount: '15.00', currency: 'HKD' },
      base: { amount: '13.80', currency: 'CNY' },
    });
    expect(await balanceOf(hkd)).toBe('3985.00');
    await expect(
      createPreview(ctx, ledger, {
        kind: 'transfer',
        sourceAccountId: cash,
        targetAccountId: cash,
        sourceAmount: { amount: '1.00', currency: 'CNY' },
        targetAmount: { amount: '1.00', currency: 'CNY' },
        occurredAt: at,
        timezone: 'UTC',
      }),
    ).rejects.toMatchObject({ code: 'SAME_ACCOUNT' });
  });
});

describe('refunds, corrections and voids', () => {
  it('caps refunds at the paid amount, even when two refunds race', async () => {
    const paid = await submit(expense('100.00'));
    const refund = (amount: string) =>
      createPreview(ctx, ledger, {
        kind: 'refund',
        originalTransactionId: paid.id,
        accountId: cash,
        settlement: { amount, currency: 'CNY' },
        occurredAt: at,
        timezone: 'Asia/Hong_Kong',
      }).then(p => createRefund(ctx, ledger, paid.id, { previewId: p.previewId }));
    const first = await refund('30.00');
    expect(first).toMatchObject({ kind: 'refund', refundOf: paid.id, categoryId: food, base: { amount: '30.00' } });
    await expect(refund('80.00')).rejects.toMatchObject({ status: 409, code: 'REFUND_EXCEEDS_PAID' });
    const previews = await Promise.all(
      ['50.00', '50.00'].map(amount =>
        createPreview(ctx, ledger, {
          kind: 'refund',
          originalTransactionId: paid.id,
          accountId: cash,
          settlement: { amount, currency: 'CNY' },
          occurredAt: at,
          timezone: 'Asia/Hong_Kong',
        }),
      ),
    );
    const raced = await Promise.allSettled(
      previews.map(p => createRefund(ctx, ledger, paid.id, { previewId: p.previewId })),
    );
    expect(raced.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((raced.find(r => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({
      code: 'REFUND_EXCEEDS_PAID',
    });
    await expect(voidTransaction(ctx, ledger, paid.id, '"v1"')).rejects.toMatchObject({ code: 'HAS_REFUNDS' });
  });
  it('corrects by reversing the old version and posting a new one', async () => {
    const before = await balanceOf(cash);
    const original = await submit(expense('40.00'));
    const preview = await createPreview(ctx, ledger, expense('45.50', { merchant: '更正后' }));
    await expect(
      correctTransaction(ctx, ledger, original.id, { previewId: preview.previewId }, '"v9"'),
    ).rejects.toMatchObject({ status: 412 });
    const corrected = await correctTransaction(ctx, ledger, original.id, { previewId: preview.previewId }, '"v1"');
    expect(corrected).toMatchObject({
      replacesId: original.id,
      status: 'posted',
      settlement: { amount: '45.50' },
      merchant: '更正后',
    });
    expect(await getTransaction(ctx, ledger, original.id)).toMatchObject({ status: 'voided', version: 2 });
    expect(await balanceOf(cash)).toBe(formatted(before, '-45.50'));
    const lines = await database()
      .select()
      .from(accountPostings)
      .where(inArray(accountPostings.transactionId, [original.id, corrected.id]));
    expect(lines.map(l => l.signedAmount).sort()).toEqual(['-40.000000', '-45.500000', '40.000000']);
  });
  it('voids idempotently and takes a transfer fee with it', async () => {
    const before = [await balanceOf(hkd), await balanceOf(cash)];
    const transfer = await submit({
      kind: 'transfer',
      sourceAccountId: hkd,
      targetAccountId: cash,
      sourceAmount: { amount: '100.00', currency: 'HKD' },
      targetAmount: { amount: '92.00', currency: 'CNY' },
      fee: { amount: { amount: '5.00', currency: 'HKD' } },
      occurredAt: at,
      timezone: 'Asia/Hong_Kong',
    });
    await expect(voidTransaction(ctx, ledger, transfer.id, null)).rejects.toMatchObject({ status: 428 });
    const voided = await voidTransaction(ctx, ledger, transfer.id, '"v1"');
    expect(voided).toMatchObject({ status: 'voided', version: 2 });
    expect(await voidTransaction(ctx, ledger, transfer.id, '"v1"')).toMatchObject({ status: 'voided', version: 2 });
    expect(await getTransaction(ctx, ledger, transfer.transfer!.feeTransactionId!)).toMatchObject({ status: 'voided' });
    expect([await balanceOf(hkd), await balanceOf(cash)]).toEqual(before);
    const audit = await database()
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.ledgerId, ledger), eq(auditLogs.resourceId, transfer.id)));
    expect(audit.map(a => a.action).sort()).toEqual(['transaction.created', 'transaction.voided']);
  });
  it('keeps balances exact under concurrent submissions', async () => {
    const before = await balanceOf(cash);
    const previews = await Promise.all(Array.from({ length: 12 }, () => createPreview(ctx, ledger, expense('0.10'))));
    await Promise.all(previews.map(p => createTransaction(ctx, ledger, { previewId: p.previewId })));
    expect(await balanceOf(cash)).toBe(formatted(before, '-1.20'));
  });
  it('lets income through with its own category kind', async () => {
    const income = await submit({
      kind: 'income',
      accountId: cash,
      settlement: { amount: '8800.00', currency: 'CNY' },
      categoryId: salary,
      occurredAt: at,
      timezone: 'Asia/Hong_Kong',
    });
    expect(income).toMatchObject({ kind: 'income', categoryId: salary, base: { amount: '8800.00' } });
  });
});
