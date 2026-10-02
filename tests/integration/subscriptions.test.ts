import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, databasePool } from '../../packages/db/src/index';
import { closeRedis } from '../../packages/db/src/redis';
import { billOccurrences, memberships, transactions } from '../../packages/db/src/schema';
import { createAccount } from '../../packages/domain/src/accounts';
import { createCategory } from '../../packages/domain/src/catalog';
import type { AuthContext } from '../../packages/domain/src/identity';
import { reportSummary } from '../../packages/domain/src/reports';
import { createBillPayment, createSubscription, createSubscriptionPreview, effectiveStatus, getSubscription, listBillOccurrences, listSubscriptions, maintainSubscriptions, monthlyEquivalent, updateBillOccurrence, updateSubscription } from '../../packages/domain/src/subscriptions';
import { correctTransaction, createPreview, createTransaction, voidTransaction } from '../../packages/domain/src/transactions';
import { seedLedger, seedUser } from './db';

// "Now" is pinned so schedules are predictable: 2026-10-02 10:00 in Hong Kong.
const NOW = new Date('2026-10-02T02:00:00Z');
const later = (days: number) => new Date(NOW.getTime() + days * 86400_000);
let ctx: AuthContext, viewer: AuthContext, ledger: string, cash: string, software: string;
const base = { name: 'Cloud Pro', amount: { amount: '20.00', currency: 'CNY' }, cycle: { unit: 'month', count: 1 }, anchorDate: '2026-01-31', timezone: 'Asia/Hong_Kong' };
async function subscribe(body: Record<string, unknown> = {}) {
  const preview = await createSubscriptionPreview(ctx, ledger, { ...base, accountId: cash, categoryId: software, ...body }, NOW);
  return createSubscription(ctx, ledger, { previewId: preview.previewId }, database(), NOW);
}
const bills = async (subscriptionId: string, now = NOW, extra: Record<string, unknown> = {}) => listBillOccurrences(ctx, ledger, { dateFrom: '2026-01-01', dateTo: '2027-12-31', subscriptionId, ...extra }, { limit: 100 }, now);
const pay = async (occurrenceId: string, amount = '20.00') => createBillPayment(ctx, ledger, occurrenceId, { previewId: (await createPreview(ctx, ledger, { kind: 'expense', accountId: cash, settlement: { amount, currency: 'CNY' }, categoryId: software, occurredAt: NOW.toISOString(), timezone: 'Asia/Hong_Kong' })).previewId }, database(), NOW);

beforeAll(async () => {
  const owner = await seedUser(), viewerId = await seedUser();
  ctx = { userId: owner, requestId: randomUUID() }; viewer = { userId: viewerId, requestId: randomUUID() };
  ledger = await seedLedger(owner, 'CNY');
  await database().insert(memberships).values({ id: randomUUID(), ledgerId: ledger, userId: viewerId, role: 'viewer', createdAt: new Date() });
  cash = (await createAccount(ctx, ledger, { name: '现金', type: 'cash', currency: 'CNY', openingBalance: '1000' })).id;
  software = (await createCategory(ctx, ledger, { name: '订阅服务', kind: 'expense' })).id;
});
afterAll(async () => { await closeRedis(); await databasePool().end(); });

describe('schedules', () => {
  it('previews the next three bills with month-end handling and a monthly forecast', async () => {
    const preview = await createSubscriptionPreview(ctx, ledger, base, NOW);
    expect(preview).toMatchObject({ nextOccurrences: ['2026-10-31', '2026-11-30', '2026-12-31'], monthlyEquivalent: { amount: '20.00', currency: 'CNY' } });
    expect(preview.warnings.map(w => w.code)).toEqual(['MONTH_END', 'ANCHOR_IN_PAST']);
    expect(monthlyEquivalent('120.00', 'USD', { unit: 'year', count: 1 })).toEqual({ amount: '10.00', currency: 'USD' });
    expect(monthlyEquivalent('7.00', 'CNY', { unit: 'week', count: 1 })).toEqual({ amount: '30.44', currency: 'CNY' });
    expect(monthlyEquivalent('1000', 'JPY', { unit: 'month', count: 3 })).toEqual({ amount: '333', currency: 'JPY' });
    await expect(createSubscriptionPreview(ctx, ledger, { ...base, amount: { amount: '1.001', currency: 'CNY' } }, NOW)).rejects.toMatchObject({ code: 'AMOUNT_PRECISION' });
    await expect(createSubscriptionPreview(ctx, ledger, { ...base, categoryId: randomUUID() }, NOW)).rejects.toMatchObject({ code: 'INVALID_CATEGORY' });
    await expect(createSubscriptionPreview(viewer, ledger, base, NOW)).rejects.toMatchObject({ status: 403 });
  });
  it('materializes unique bills through the horizon; due is not paid (AC04, D14)', async () => {
    const sub = await subscribe();
    expect(sub).toMatchObject({ status: 'active', nextDueDate: '2026-10-31', scheduleVersion: 1, monthlyEquivalent: { amount: '20.00' } });
    const list = await bills(sub.id);
    expect(list.map(b => b.scheduledDate)).toEqual(['2026-10-31', '2026-11-30', '2026-12-31']);
    expect(list.every(b => b.status === 'scheduled' && b.name === 'Cloud Pro')).toBe(true);
    await maintainSubscriptions(NOW); await maintainSubscriptions(NOW);
    expect(await bills(sub.id)).toHaveLength(3); // no duplicates
    // The day of a bill it is due, afterwards overdue, never paid by itself.
    expect((await bills(sub.id, later(29)))[0].status).toBe('due');
    expect((await bills(sub.id, later(30)))[0].status).toBe('overdue');
    await maintainSubscriptions(later(30));
    const [stored] = await database().select().from(billOccurrences).where(and(eq(billOccurrences.subscriptionId, sub.id), eq(billOccurrences.scheduledDate, '2026-10-31')));
    expect(stored).toMatchObject({ status: 'overdue', transactionId: null });
    expect(effectiveStatus({ status: 'paid', scheduledDate: '2026-01-01' }, '2026-10-02')).toBe('paid');
    expect((await bills(sub.id, later(30), { status: 'overdue' })).map(b => b.scheduledDate)).toEqual(['2026-10-31']);
    expect((await listSubscriptions(viewer, ledger, {}, { limit: 10 }, NOW)).map(s => s.id)).toContain(sub.id);
  });
});

describe('payments', () => {
  it('records each bill once, links existing expenses once, and follows voids and corrections', async () => {
    const sub = await subscribe({ name: '家庭宽带', anchorDate: '2026-10-05', amount: { amount: '99.00', currency: 'CNY' } });
    const [first, second, third] = await bills(sub.id);
    const paid = await pay(first.id, '99.00');
    expect(paid.occurrence).toMatchObject({ status: 'paid', transactionId: paid.transaction.id });
    expect(paid.transaction).toMatchObject({ kind: 'expense', source: 'subscription', settlement: { amount: '99.00' } });
    await expect(pay(first.id, '99.00')).rejects.toMatchObject({ status: 409, code: 'ALREADY_PAID' });
    // Linking an expense that already pays another bill is refused; a free expense can be linked.
    await expect(createBillPayment(ctx, ledger, second.id, { transactionId: paid.transaction.id }, database(), NOW)).rejects.toMatchObject({ code: 'ALREADY_LINKED' });
    const manual = await createTransaction(ctx, ledger, { previewId: (await createPreview(ctx, ledger, { kind: 'expense', accountId: cash, settlement: { amount: '99.00', currency: 'CNY' }, occurredAt: NOW.toISOString(), timezone: 'UTC' })).previewId });
    expect((await createBillPayment(ctx, ledger, second.id, { transactionId: manual.id }, database(), NOW)).occurrence.status).toBe('paid');
    // Skip and restore; paid bills cannot be skipped.
    const skipped = await updateBillOccurrence(ctx, ledger, third.id, { status: 'skipped' }, `"v${third.version}"`, NOW);
    expect(skipped.status).toBe('skipped');
    await expect(pay(third.id, '99.00')).rejects.toMatchObject({ code: 'BILL_NOT_PAYABLE' });
    expect((await updateBillOccurrence(ctx, ledger, third.id, { status: 'scheduled' }, `"v${skipped.version}"`, NOW)).status).toBe('scheduled');
    await expect(updateBillOccurrence(ctx, ledger, first.id, { status: 'skipped' }, '"v2"', NOW)).rejects.toMatchObject({ code: 'ALREADY_PAID' });
    // Voiding the payment makes the bill payable again; correcting it keeps the bill paid by the new version.
    await voidTransaction(ctx, ledger, manual.id, `"v${manual.version}"`);
    expect((await bills(sub.id)).find(b => b.id === second.id)).toMatchObject({ status: 'scheduled', transactionId: null });
    const corrected = await correctTransaction(ctx, ledger, paid.transaction.id, { previewId: (await createPreview(ctx, ledger, { kind: 'expense', accountId: cash, settlement: { amount: '98.00', currency: 'CNY' }, categoryId: software, occurredAt: NOW.toISOString(), timezone: 'Asia/Hong_Kong' })).previewId }, `"v${paid.transaction.version}"`);
    expect((await bills(sub.id)).find(b => b.id === first.id)).toMatchObject({ status: 'paid', transactionId: corrected.id });
    const [voidedOld] = await database().select().from(transactions).where(eq(transactions.id, paid.transaction.id));
    expect(voidedOld.status).toBe('voided');
  });
  it('counts unpaid bills of the next 7 days in the report summary', async () => {
    const summary = await reportSummary(ctx, ledger, { dateFrom: '2026-10-01', dateTo: '2026-11-01' }, NOW);
    expect(summary.upcomingBills).toEqual({ count: 0, amount: '0.00' }); // 10-05 bill is paid
    await subscribe({ name: '音乐', anchorDate: '2026-10-06', amount: { amount: '12.00', currency: 'CNY' } });
    expect((await reportSummary(ctx, ledger, { dateFrom: '2026-10-01', dateTo: '2026-11-01' }, NOW)).upcomingBills).toEqual({ count: 1, amount: '12.00' });
  });
});

describe('changes', () => {
  it('a schedule edit cancels unpaid future bills of the old version and keeps paid history', async () => {
    const sub = await subscribe({ name: '视频', anchorDate: '2026-10-03' });
    const [first] = await bills(sub.id);
    await pay(first.id);
    const edited = await updateSubscription(ctx, ledger, sub.id, { amount: { amount: '25.00', currency: 'CNY' }, anchorDate: '2026-10-10' }, '"v1"', NOW);
    expect(edited).toMatchObject({ scheduleVersion: 2, version: 2, amount: { amount: '25.00' }, nextDueDate: '2026-10-10' });
    const all = await database().select().from(billOccurrences).where(eq(billOccurrences.subscriptionId, sub.id));
    expect(all.filter(b => b.scheduleVersion === 1).map(b => b.status).sort()).toEqual(['cancelled', 'cancelled', 'paid']);
    expect(all.filter(b => b.scheduleVersion === 2).every(b => b.status === 'scheduled' && b.amount.startsWith('25'))).toBe(true);
    await expect(updateSubscription(ctx, ledger, sub.id, { name: 'x' }, '"v1"', NOW)).rejects.toMatchObject({ status: 412 });
    expect((await updateSubscription(ctx, ledger, sub.id, { name: '视频会员' }, '"v2"', NOW)).scheduleVersion).toBe(2); // renaming is not a schedule change
  });
  it('pauses until a date, resumes automatically on the same anchor, and cancels only the future', async () => {
    const sub = await subscribe({ name: '健身', anchorDate: '2026-10-15' });
    const paused = await updateSubscription(ctx, ledger, sub.id, { status: 'paused', pausedUntil: '2026-11-20' }, '"v1"', NOW);
    expect(paused).toMatchObject({ status: 'paused', pausedUntil: '2026-11-20', nextDueDate: null });
    expect(await bills(sub.id)).toEqual([]);
    await expect(updateSubscription(ctx, ledger, sub.id, { status: 'paused', pausedUntil: '2026-10-01' }, '"v2"', NOW)).rejects.toMatchObject({ code: 'INVALID_PAUSE' });
    expect(await maintainSubscriptions(later(10))).toMatchObject({ resumed: 0 });
    expect((await maintainSubscriptions(new Date('2026-11-20T01:00:00Z'))).resumed).toBeGreaterThanOrEqual(1);
    const resumed = await getSubscription(ctx, ledger, sub.id, new Date('2026-11-20T01:00:00Z'));
    expect(resumed).toMatchObject({ status: 'active', pausedUntil: null, scheduleVersion: 3, nextDueDate: '2026-12-15' });
    const cancelled = await updateSubscription(ctx, ledger, sub.id, { status: 'cancelled', endsOn: '2027-01-31' }, `"v${resumed.version}"`, new Date('2026-11-20T01:00:00Z'));
    expect(cancelled).toMatchObject({ status: 'cancelled', endsOn: '2027-01-31', nextDueDate: null });
    expect((await bills(sub.id, new Date('2026-11-20T01:00:00Z'))).map(b => b.scheduledDate)).toEqual(['2026-12-15', '2027-01-15']);
    await expect(updateSubscription(ctx, ledger, sub.id, { name: '再改' }, `"v${cancelled.version}"`, NOW)).rejects.toMatchObject({ code: 'SUBSCRIPTION_CANCELLED' });
  });
});
