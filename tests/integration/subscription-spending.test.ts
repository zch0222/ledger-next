import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, databasePool } from '@ledger/db/index';
import { closeRedis } from '@ledger/db/redis';
import { createAccount } from '@ledger/domain/accounts';
import { createCategory } from '@ledger/domain/catalog';
import { ingestBatch } from '@ledger/domain/fx';
import { fxConfig } from '@ledger/domain/fx-provider';
import type { AuthContext } from '@ledger/domain/identity';
import { subscriptionSpending } from '@ledger/domain/reports';
import {
  createBillPayment,
  createSubscription,
  createSubscriptionPreview,
  listBillOccurrences,
  updateBillOccurrence,
  updateSubscription,
} from '@ledger/domain/subscriptions';
import { createPreview } from '@ledger/domain/transactions';
import { seedLedger, seedUser } from './db';

// P01 / P05 subscription spending. "Now" is pinned: 2026-10-02 10:00 in Hong Kong; USD → CNY is exactly 7.
const NOW = new Date('2026-10-02T02:00:00Z');
let ctx: AuthContext;
let ledger: string;
let cash: string;
let visa: string;
let software: string;
let media: string;
const ids: Record<string, string> = {};
async function subscribe(
  name: string,
  amount: string,
  currency: string,
  cycle: { unit: string; count: number },
  anchorDate: string,
  extra: Record<string, unknown> = {},
) {
  const preview = await createSubscriptionPreview(
    ctx,
    ledger,
    { name, amount: { amount, currency }, cycle, anchorDate, timezone: 'Asia/Hong_Kong', accountId: cash, ...extra },
    NOW,
  );
  const sub = await createSubscription(ctx, ledger, { previewId: preview.previewId }, database(), NOW);
  ids[name] = sub.id;
  return sub;
}
const billOn = async (name: string, date: string) =>
  (
    await listBillOccurrences(
      ctx,
      ledger,
      { dateFrom: date, dateTo: '2027-12-31', subscriptionId: ids[name] },
      { limit: 1 },
      NOW,
    )
  ).find(b => b.scheduledDate === date)!;
const spending = (query: Record<string, unknown> = {}) =>
  subscriptionSpending(ctx, ledger, { month: '2026-10', before: 1, after: 6, ...query }, NOW);

beforeAll(async () => {
  const owner = await seedUser();
  ctx = { userId: owner, requestId: randomUUID() };
  ledger = await seedLedger(owner, 'CNY');
  process.env.FX_PROVIDER = `itest-subspend-${randomUUID().slice(0, 8)}`;
  // JPY is deliberately missing: a subscription in it cannot be valued and is counted as excluded.
  await ingestBatch(
    {
      pivot: 'EUR',
      sourceAt: new Date(NOW.getTime() - 10_000),
      date: '2026-10-02',
      rates: { USD: '1.08', CNY: '7.56' },
    },
    'latest',
    fxConfig(),
    NOW,
  );
  cash = (await createAccount(ctx, ledger, { name: '现金', type: 'cash', currency: 'CNY', openingBalance: '1000' })).id;
  visa = (await createAccount(ctx, ledger, { name: 'Visa', type: 'credit_card', currency: 'USD' })).id;
  software = (await createCategory(ctx, ledger, { name: '软件', kind: 'expense' })).id;
  media = (await createCategory(ctx, ledger, { name: '影音', kind: 'expense' })).id;
  const monthly = { unit: 'month', count: 1 };
  await subscribe('Cloud', '30.00', 'CNY', monthly, '2026-08-15', { categoryId: software });
  await subscribe('Video', '10.00', 'USD', monthly, '2026-10-20', { categoryId: media, accountId: visa });
  await subscribe('Domain', '120.00', 'CNY', { unit: 'year', count: 1 }, '2026-12-01');
  await subscribe('Game', '980', 'JPY', monthly, '2026-10-25');
  const music = await subscribe('Music', '15.00', 'CNY', monthly, '2026-10-10', { categoryId: media });
  const gym = await subscribe('Gym', '200.00', 'CNY', monthly, '2026-10-05');
  await updateSubscription(ctx, ledger, music.id, { status: 'cancelled' }, `"v${music.version}"`, NOW);
  await updateSubscription(
    ctx,
    ledger,
    gym.id,
    { status: 'paused', pausedUntil: '2027-02-01' },
    `"v${gym.version}"`,
    NOW,
  );
  // Cloud's October bill is paid early; Video's November bill is skipped.
  const october = await billOn('Cloud', '2026-10-15');
  await createBillPayment(
    ctx,
    ledger,
    october.id,
    {
      previewId: (
        await createPreview(ctx, ledger, {
          kind: 'expense',
          accountId: cash,
          settlement: { amount: '30.00', currency: 'CNY' },
          categoryId: software,
          occurredAt: NOW.toISOString(),
          timezone: 'Asia/Hong_Kong',
        })
      ).previewId,
    },
    database(),
    NOW,
  );
  const november = await billOn('Video', '2026-11-20');
  await updateBillOccurrence(ctx, ledger, november.id, { status: 'skipped' }, `"v${november.version}"`, NOW);
});
afterAll(async () => {
  await closeRedis();
  await databasePool().end();
});

describe('subscription spending', () => {
  it('values running plans at the current rate; inactive plans are what they would still cost', async () => {
    const r = await spending();
    expect(r).toMatchObject({
      month: '2026-10',
      today: '2026-10-02',
      currency: 'CNY',
      valuationMode: 'current',
      counts: { active: 4, paused: 1, cancelled: 1 },
      monthly: '110.00', // 30 + 10 USD × 7 + 120 / 12; the JPY plan has no rate
      yearly: '1320.00',
      averageMonthly: '36.67',
      top: { subscriptionId: ids.Video, name: 'Video', monthly: '70.00' },
      inactive: { count: 2, monthly: '215.00', yearly: '2580.00' },
      partial: true,
      excludedCount: 1,
    });
    expect(r.items.map(i => [i.name, i.status, i.monthly])).toEqual([
      ['Video', 'active', '70.00'],
      ['Cloud', 'active', '30.00'],
      ['Domain', 'active', '10.00'],
      ['Game', 'active', null],
      ['Gym', 'paused', '200.00'],
      ['Music', 'cancelled', '15.00'],
    ]);
    expect(r.byCategory).toEqual([
      { id: media, name: '影音', monthly: '70.00', share: '0.6364', count: 1 },
      { id: software, name: '软件', monthly: '30.00', share: '0.2727', count: 1 },
      { id: null, name: '未分类', monthly: '10.00', share: '0.0909', count: 1 },
    ]);
    expect(r.byAccount.map(a => [a.name, a.monthly, a.count])).toEqual([
      ['Visa', '70.00', 1],
      ['现金', '40.00', 2],
    ]);
  });

  it('sums bills per month: paid, open and projected past the horizon; skipped and cancelled drop out', async () => {
    const r = await spending();
    expect(r.timeline.map(t => [t.month, t.paid, t.pending, t.count])).toEqual([
      ['2026-09', '0.00', '0.00', 0], // bills start the day a plan is added; history is not invented
      ['2026-10', '30.00', '70.00', 2], // Music's Oct 10 was cancelled, Gym's Oct 5 paused
      ['2026-11', '0.00', '30.00', 1], // Video skipped
      ['2026-12', '0.00', '220.00', 3], // Domain's yearly bill lands whole: 30 + 70 + 120
      ['2027-01', '0.00', '100.00', 2], // beyond the 90-day horizon: projected from the schedule
      ['2027-02', '0.00', '300.00', 3], // Gym resumes on Feb 1
      ['2027-03', '0.00', '300.00', 3],
      ['2027-04', '0.00', '300.00', 3],
    ]);
    expect(r.bills).toEqual({
      month: '2026-10',
      paid: '30.00',
      pending: '70.00',
      total: '100.00',
      count: 2,
      paidCount: 1,
    });
  });

  it('converts each plan before summing, so totals equal their rows in any display currency', async () => {
    const r = await spending({ currency: 'USD', before: 0, after: 0 });
    // Cloud 30 CNY → 4.29, Domain 10 CNY → 1.43, Video 10.00: rounded per plan, then added.
    expect(r).toMatchObject({ currency: 'USD', monthly: '15.72', timeline: [{ month: '2026-10', paid: '4.29' }] });
    expect(r.items.filter(i => i.status === 'active').map(i => i.monthly)).toEqual(['10.00', '4.29', '1.43', null]);
  });
});
