import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import {
  AccountBalancesQuery,
  BudgetCreate,
  BudgetProgressQuery,
  BudgetUpdate,
  CashFlowQuery,
  CategoryBreakdownQuery,
  ReportQuery,
  SubscriptionSpendingQuery,
} from '@ledger/contracts/planning';
import { database, type Executor, type Tx } from '@ledger/db/index';
import { cacheGet, cacheSet, redis } from '@ledger/db/redis';
import {
  accountPostings,
  accounts,
  billOccurrences,
  budgets,
  categories,
  ledgerDataVersions,
  subscriptions,
  transactionAmounts,
  transactions,
} from '@ledger/db/schema';
import { ledgerAccess } from './access';
import { audit, emit } from './audit';
import { addDays, localDate, zonedInstant } from './dates';
import { bucketOf, buckets, periodOf } from './report-periods';

export { bucketOf, buckets, periodOf };
import { manualRate, quote, type Freshness } from './fx';
import { canonicalJson } from './idempotency';
import type { AuthContext, Keyset } from './identity';
import { convert, formatAmount, minorUnits, parseAmount, sum, toColumn } from './money';
import { DomainError, requireVersion } from './policy';
import { cyclesPerYear, occurrencesBetween } from './schedule';

type Db = Executor | Tx;
type Ledger = { baseCurrency: string; timezone: string };
type Basis = {
  currency: string;
  valuationMode: 'historical' | 'current';
  partial: boolean;
  excludedCount: number;
  dataVersion: number;
  sourceAt: string | null;
};
const CACHE_TTL_SECONDS = 30;

export async function dataVersion(db: Db, ledgerId: string) {
  const [row] = await db
    .select({ version: ledgerDataVersions.version })
    .from(ledgerDataVersions)
    .where(eq(ledgerDataVersions.ledgerId, ledgerId));
  return Number(row?.version ?? 0);
}
/**
 * Report cache (TECHNICAL_DESIGN §7.2): key = ledger + data version + FX version (current valuation only) + report +
 * every query parameter. Authorization runs before the cache is consulted; a write bumps the data version, so a
 * cached aggregate is never served after the data it summarized changed.
 */
async function cached<T>(
  ledgerId: string,
  report: string,
  query: Record<string, unknown>,
  current: boolean,
  compute: (version: number) => Promise<T>,
): Promise<T> {
  const version = await dataVersion(database(), ledgerId);
  let fxVersion = '';
  if (current) {
    try {
      fxVersion = (await redis()?.get('fx:version')) ?? '';
    } catch {
      fxVersion = String(Date.now());
    }
  }
  const key = `report:v1:${ledgerId}:${version}:${fxVersion}:${report}:${createHash('sha256').update(canonicalJson(query)).digest('base64url').slice(0, 22)}`;
  const hit = await cacheGet(key);
  if (hit) {
    try {
      return JSON.parse(hit) as T;
    } catch {
      /* recompute */
    }
  }
  const value = await compute(version);
  await cacheSet(key, JSON.stringify(value), CACHE_TTL_SECONDS);
  return value;
}

type Row = {
  id: string;
  kind: 'expense' | 'income' | 'refund';
  localDate: string;
  categoryId: string | null;
  accountId: string | null;
  baseAmount: string;
  baseCurrency: string;
  settlementAmount: string;
  settlementCurrency: string;
};
/** Effective business versions only (posted); transfers never enter income / expense. */
async function periodRows(
  db: Db,
  ledgerId: string,
  q: { dateFrom: string; dateTo: string; accountId?: string; categoryIds?: string[] | null },
): Promise<Row[]> {
  const conditions: (SQL | undefined)[] = [
    eq(transactions.ledgerId, ledgerId),
    eq(transactions.status, 'posted'),
    ne(transactions.kind, 'transfer'),
    gte(transactions.localDate, q.dateFrom),
    lt(transactions.localDate, q.dateTo),
    q.accountId ? eq(transactions.accountId, q.accountId) : undefined,
    q.categoryIds ? inArray(transactions.categoryId, q.categoryIds) : undefined,
  ];
  const rows = await db
    .select({
      id: transactions.id,
      kind: transactions.kind,
      localDate: transactions.localDate,
      categoryId: transactions.categoryId,
      accountId: transactions.accountId,
      baseAmount: transactionAmounts.baseAmount,
      baseCurrency: transactionAmounts.baseCurrency,
      settlementAmount: transactionAmounts.settlementAmount,
      settlementCurrency: transactionAmounts.settlementCurrency,
    })
    .from(transactions)
    .innerJoin(
      transactionAmounts,
      and(
        eq(transactionAmounts.ledgerId, transactions.ledgerId),
        eq(transactionAmounts.transactionId, transactions.id),
      ),
    )
    .where(and(...conditions))
    .orderBy(asc(transactions.localDate), asc(transactions.id));
  return rows as Row[];
}

/**
 * Converts each row into the report currency, rounding per transaction so totals equal the converted details.
 * historical: the booked base amount; another currency uses that day's cross rate (or the ledger's manual rate).
 * current: the settlement amount at the latest reference rate. Rows without a rate are excluded and counted.
 */
function valuer(
  db: Db,
  ledgerId: string,
  ledger: Ledger,
  currency: string,
  mode: 'historical' | 'current',
  now = new Date(),
) {
  const rates = new Map<string, { value: string; sourceAt: Date | null } | null>();
  let excluded = 0;
  let oldest: Date | null = null;
  async function rate(from: string, at: Date, day: string) {
    const key = `${from}:${mode === 'current' ? 'now' : day}`;
    if (!rates.has(key)) {
      const q = await quote(db, from, currency, at, now);
      const usable = mode === 'current' ? q.freshness !== 'missing' : q.freshness === 'fresh';
      const manual = usable ? null : await manualRate(db, ledgerId, from, currency, day);
      rates.set(
        key,
        usable ? { value: q.value!, sourceAt: q.sourceAt } : manual ? { value: manual.value, sourceAt: null } : null,
      );
    }
    return rates.get(key)!;
  }
  return {
    async value(row: Row): Promise<string | null> {
      const [amount, from] =
        mode === 'historical' ? [row.baseAmount, row.baseCurrency] : [row.settlementAmount, row.settlementCurrency];
      if (from === currency) return formatAmount(sum([amount]), currency);
      const r = await rate(
        from,
        mode === 'current' ? now : zonedInstant(row.localDate, '12:00', ledger.timezone),
        mode === 'current' ? localDate(now, ledger.timezone) : row.localDate,
      );
      if (!r) {
        excluded++;
        return null;
      }
      if (r.sourceAt && (!oldest || r.sourceAt < oldest)) oldest = r.sourceAt;
      return convert(sum([amount]).toFixed(), from, r.value, currency);
    },
    basis(version: number): Basis {
      return {
        currency,
        valuationMode: mode,
        partial: excluded > 0,
        excludedCount: excluded,
        dataVersion: version,
        sourceAt: (oldest as Date | null)?.toISOString() ?? null,
      };
    },
  };
}

function range(q: { dateFrom: string; dateTo: string }) {
  if (q.dateFrom >= q.dateTo) throw new DomainError(422, 'INVALID_RANGE', 'dateTo 须晚于 dateFrom（不含当日）');
}
async function categoryScope(db: Db, ledgerId: string, categoryId?: string) {
  if (!categoryId) return null;
  const children = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.ledgerId, ledgerId), eq(categories.parentId, categoryId)));
  return [categoryId, ...children.map(c => c.id)];
}

export async function reportSummary(ctx: AuthContext, ledgerId: string, query: unknown, now = new Date()) {
  const q = ReportQuery.parse(query);
  range(q);
  const ledger = await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const currency = q.currency ?? ledger.baseCurrency;
  return cached(ledgerId, 'summary', { ...q, currency }, q.valuationMode === 'current', async version => {
    const db = database();
    const v = valuer(db, ledgerId, ledger, currency, q.valuationMode, now);
    const totals = { income: sum([]), expense: sum([]), refund: sum([]) };
    for (const row of await periodRows(db, ledgerId, {
      ...q,
      categoryIds: await categoryScope(db, ledgerId, q.categoryId),
    })) {
      const amount = await v.value(row);
      if (amount !== null) totals[row.kind] = totals[row.kind].plus(amount);
    }
    const f = (value: ReturnType<typeof sum>) => formatAmount(value, currency);
    return {
      period: { dateFrom: q.dateFrom, dateTo: q.dateTo, timezone: ledger.timezone },
      income: f(totals.income),
      expense: f(totals.expense),
      refunds: f(totals.refund),
      net: f(totals.income.minus(totals.expense).plus(totals.refund)),
      upcomingBills: await upcomingBills(db, ledgerId, ledger, currency, now),
      ...v.basis(version),
    };
  });
}

/** Unpaid bills of the next 7 days from the ledger's today, valued at current reference rates (forecast, not spending). */
async function upcomingBills(db: Db, ledgerId: string, ledger: Ledger, currency: string, now: Date) {
  const today = localDate(now, ledger.timezone);
  const until = addDays(today, 7);
  const rows = await db
    .select({ amount: billOccurrences.amount, currency: billOccurrences.currency })
    .from(billOccurrences)
    .where(
      and(
        eq(billOccurrences.ledgerId, ledgerId),
        inArray(billOccurrences.status, ['scheduled', 'due', 'overdue']),
        gte(billOccurrences.scheduledDate, today),
        lt(billOccurrences.scheduledDate, until),
      ),
    );
  let total = sum([]);
  for (const row of rows) {
    if (row.currency === currency) {
      total = total.plus(row.amount);
      continue;
    }
    const q = await quote(db, row.currency, currency, now, now);
    if (q.value) total = total.plus(convert(sum([row.amount]).toFixed(), row.currency, q.value, currency));
  }
  return { count: rows.length, amount: formatAmount(total, currency) };
}

export async function cashFlow(ctx: AuthContext, ledgerId: string, query: unknown, now = new Date()) {
  const q = CashFlowQuery.parse(query);
  range(q);
  const points = buckets(q.dateFrom, q.dateTo, q.interval);
  const ledger = await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const currency = q.currency ?? ledger.baseCurrency;
  return cached(ledgerId, 'cash-flow', { ...q, currency }, q.valuationMode === 'current', async version => {
    const db = database();
    const v = valuer(db, ledgerId, ledger, currency, q.valuationMode, now);
    const byBucket = new Map(points.map(p => [p, { income: sum([]), expense: sum([]) }]));
    for (const row of await periodRows(db, ledgerId, {
      ...q,
      categoryIds: await categoryScope(db, ledgerId, q.categoryId),
    })) {
      const amount = await v.value(row);
      const bucket = byBucket.get(bucketOf(row.localDate, q.interval));
      if (amount === null || !bucket) continue;
      if (row.kind === 'income') bucket.income = bucket.income.plus(amount);
      else bucket.expense = row.kind === 'expense' ? bucket.expense.plus(amount) : bucket.expense.minus(amount);
    }
    const f = (value: ReturnType<typeof sum>) => formatAmount(value, currency);
    return {
      interval: q.interval,
      points: points.map(date => {
        const b = byBucket.get(date)!;
        return { date, income: f(b.income), expense: f(b.expense), net: f(b.income.minus(b.expense)) };
      }),
      ...v.basis(version),
    };
  });
}

export async function categoryBreakdown(ctx: AuthContext, ledgerId: string, query: unknown, now = new Date()) {
  const q = CategoryBreakdownQuery.parse(query);
  range(q);
  const ledger = await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const currency = q.currency ?? ledger.baseCurrency;
  return cached(ledgerId, 'category-breakdown', { ...q, currency }, q.valuationMode === 'current', async version => {
    const db = database();
    const v = valuer(db, ledgerId, ledger, currency, q.valuationMode, now);
    const names = new Map(
      (
        await db
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(eq(categories.ledgerId, ledgerId))
      ).map(c => [c.id, c.name]),
    );
    const groups = new Map<string | null, { amount: ReturnType<typeof sum>; count: number }>();
    for (const row of await periodRows(db, ledgerId, {
      ...q,
      categoryIds: await categoryScope(db, ledgerId, q.categoryId),
    })) {
      if (q.kind === 'income' ? row.kind !== 'income' : row.kind === 'income') continue;
      const amount = await v.value(row);
      if (amount === null) continue;
      const group = groups.get(row.categoryId) ?? { amount: sum([]), count: 0 };
      group.amount = row.kind === 'refund' ? group.amount.minus(amount) : group.amount.plus(amount); // refunds offset their category
      if (row.kind !== 'refund') group.count++;
      groups.set(row.categoryId, group);
    }
    const total = sum([...groups.values()].map(g => g.amount));
    const items = [...groups.entries()]
      .map(([categoryId, g]) => ({
        categoryId,
        name: categoryId ? (names.get(categoryId) ?? '已删除分类') : '未分类',
        amount: formatAmount(g.amount, currency),
        share: total.isZero() ? '0' : g.amount.dividedBy(total).toDecimalPlaces(4).toFixed(),
        count: g.count,
      }))
      .sort((a, b) => sum([b.amount]).comparedTo(a.amount) || a.name.localeCompare(b.name));
    return { kind: q.kind, total: formatAmount(total, currency), items, ...v.basis(version) };
  });
}

/**
 * Net worth at an instant: each account's balance from its postings (by transaction time) valued at the reference
 * rate for that instant; credit cards stay negative. Accounts without a usable rate are excluded and counted.
 */
export async function accountBalances(ctx: AuthContext, ledgerId: string, query: unknown, now = new Date()) {
  const q = AccountBalancesQuery.parse(query);
  const asOf = q.asOf ? new Date(q.asOf) : now;
  if (asOf.getTime() > now.getTime() + 60_000) throw new DomainError(422, 'INVALID_AS_OF', 'asOf 不能晚于当前时间');
  const ledger = await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const currency = q.currency ?? ledger.baseCurrency;
  return cached(ledgerId, 'account-balances', { asOf: q.asOf ?? 'now', currency }, true, async version => {
    const db = database();
    // Entries may be backdated, so an account counts at any instant before it was archived (with its opening balance).
    const rows = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.ledgerId, ledgerId), or(isNull(accounts.archivedAt), gt(accounts.archivedAt, asOf))))
      .orderBy(asc(accounts.createdAt), asc(accounts.id));
    const historic = q.asOf !== undefined;
    const sums =
      historic && rows.length
        ? new Map(
            (
              await db
                .select({
                  accountId: accountPostings.accountId,
                  total: sql<string>`COALESCE(SUM(${accountPostings.signedAmount}), 0)`,
                })
                .from(accountPostings)
                .innerJoin(
                  transactions,
                  and(
                    eq(transactions.ledgerId, accountPostings.ledgerId),
                    eq(transactions.id, accountPostings.transactionId),
                  ),
                )
                .where(and(eq(accountPostings.ledgerId, ledgerId), lte(transactions.occurredAt, asOf)))
                .groupBy(accountPostings.accountId)
            ).map(r => [r.accountId, r.total]),
          )
        : null;
    let total = sum([]);
    let excluded = 0;
    let oldest: Date | null = null;
    const items = [];
    for (const account of rows) {
      const balance = formatAmount(
        sums ? sum([account.openingBalance, sums.get(account.id) ?? '0']) : sum([account.balance]),
        account.currency,
      );
      let valuation: string | null = balance;
      let freshness: Freshness = 'fresh';
      if (account.currency !== currency) {
        const r = await quote(db, account.currency, currency, asOf, now);
        if (r.freshness !== 'missing') {
          valuation = convert(balance, account.currency, r.value!, currency);
          freshness = r.freshness;
          if (r.sourceAt && (!oldest || r.sourceAt < oldest)) oldest = r.sourceAt;
        } else {
          const manual = await manualRate(db, ledgerId, account.currency, currency, localDate(asOf, ledger.timezone));
          if (manual) {
            valuation = convert(balance, account.currency, manual.value, currency);
            freshness = 'manual';
          } else {
            valuation = null;
            freshness = 'missing';
            excluded++;
          }
        }
      } else valuation = formatAmount(balance, currency);
      if (valuation !== null) total = total.plus(valuation);
      items.push({
        accountId: account.id,
        name: account.name,
        currency: account.currency,
        balance,
        valuation,
        freshness,
      });
    }
    return {
      asOf: asOf.toISOString(),
      total: formatAmount(total, currency),
      items,
      currency,
      valuationMode: 'current' as const,
      partial: excluded > 0,
      excludedCount: excluded,
      dataVersion: version,
      sourceAt: (oldest as Date | null)?.toISOString() ?? null,
    };
  });
}

// ---------- subscriptions ----------

type Value = ReturnType<typeof sum>;
const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + m - 1 + n;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
};
const STATUS_ORDER = { active: 0, paused: 1, cancelled: 2 } as const;

/**
 * Subscription spending (P01 / P05): a forecast, never mixed into booked spending. Every amount is valued at the
 * current reference rate (or the ledger's manual rate) in the report currency and rounded per subscription or bill, so
 * totals equal their rows. Monthly / yearly = amount × cycles per year (÷ 12); "inactive" is what the paused and
 * cancelled plans would cost if they still ran. The timeline sums each month's bills — paid, still open, and dates past
 * the materialized horizon projected from the schedule (a paused plan from its resume date); skipped bills drop out.
 * Subscriptions in a currency without any rate are left out and counted.
 */
export async function subscriptionSpending(ctx: AuthContext, ledgerId: string, query: unknown, now = new Date()) {
  const q = SubscriptionSpendingQuery.parse(query);
  const ledger = await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const currency = q.currency ?? ledger.baseCurrency;
  const today = localDate(now, ledger.timezone);
  const month = q.month ?? today.slice(0, 7);
  return cached(ledgerId, 'subscription-spending', { ...q, month, currency, today }, true, async version => {
    const db = database();
    const units = minorUnits(currency);
    const f = (value: Value) => formatAmount(value.toDecimalPlaces(units), currency);
    const plans = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.ledgerId, ledgerId))
      .orderBy(asc(subscriptions.createdAt), asc(subscriptions.id));
    const categoryNames = new Map(
      (
        await db
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(eq(categories.ledgerId, ledgerId))
      ).map(c => [c.id, c.name]),
    );
    const accountNames = new Map(
      (
        await db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.ledgerId, ledgerId))
      ).map(a => [a.id, a.name]),
    );
    const rates = new Map<string, string | null>();
    let oldest: Date | null = null;
    async function rate(from: string) {
      if (!rates.has(from)) {
        const quoted = await quote(db, from, currency, now, now);
        if (quoted.freshness !== 'missing') {
          rates.set(from, quoted.value!);
          if (quoted.sourceAt && (!oldest || quoted.sourceAt < oldest)) oldest = quoted.sourceAt;
        } else rates.set(from, (await manualRate(db, ledgerId, from, currency, today))?.value ?? null);
      }
      return rates.get(from)!;
    }
    const excluded = new Set<string>();

    for (const code of new Set(plans.map(p => p.currency))) await rate(code);
    const items = plans.map(plan => {
      const r = rates.get(plan.currency)!;
      if (r === null) excluded.add(plan.id);
      const [num, den] = cyclesPerYear({ unit: plan.cycleUnit, count: plan.cycleCount });
      const yearly = sum([plan.amount]).times(num).dividedBy(den);
      return {
        subscriptionId: plan.id,
        name: plan.name,
        status: plan.status,
        amount: { amount: formatAmount(plan.amount, plan.currency), currency: plan.currency },
        cycle: { unit: plan.cycleUnit, count: plan.cycleCount },
        categoryId: plan.categoryId,
        accountId: plan.accountId,
        monthly: r === null ? null : f(yearly.times(r).dividedBy(12)),
        yearly: r === null ? null : f(yearly.times(r)),
      };
    });
    items.sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        sum([b.monthly ?? '-1']).comparedTo(a.monthly ?? '-1') ||
        a.name.localeCompare(b.name),
    );
    const active = items.filter(i => i.status === 'active');
    const inactive = items.filter(i => i.status !== 'active');
    const valued = active.filter(i => i.monthly !== null);
    const total = (rows: typeof items, key: 'monthly' | 'yearly') => sum(rows.map(i => i[key] ?? '0'));
    const monthly = total(active, 'monthly');
    const group = (key: 'categoryId' | 'accountId', names: Map<string, string>, none: string) => {
      const groups = new Map<string | null, { amount: Value; count: number }>();
      for (const item of valued) {
        const g = groups.get(item[key]) ?? { amount: sum([]), count: 0 };
        g.amount = g.amount.plus(item.monthly!);
        g.count++;
        groups.set(item[key], g);
      }
      return [...groups]
        .map(([id, g]) => ({
          id,
          name: id ? (names.get(id) ?? '已删除') : none,
          monthly: f(g.amount),
          share: monthly.isZero() ? '0' : g.amount.dividedBy(monthly).toDecimalPlaces(4).toFixed(),
          count: g.count,
        }))
        .sort((a, b) => sum([b.monthly]).comparedTo(a.monthly) || a.name.localeCompare(b.name));
    };

    // Timeline: stored bills in the window, plus schedule dates no bill row covers yet.
    const first = shiftMonth(month, -q.before);
    const months = Array.from({ length: q.before + q.after + 1 }, (_, i) => shiftMonth(first, i));
    const from = `${first}-01`;
    const to = `${shiftMonth(month, q.after + 1)}-01`;
    const stored = await db
      .select({
        subscriptionId: billOccurrences.subscriptionId,
        date: billOccurrences.scheduledDate,
        status: billOccurrences.status,
        amount: billOccurrences.amount,
        currency: billOccurrences.currency,
      })
      .from(billOccurrences)
      .where(
        and(
          eq(billOccurrences.ledgerId, ledgerId),
          gte(billOccurrences.scheduledDate, from),
          lt(billOccurrences.scheduledDate, to),
          ne(billOccurrences.status, 'cancelled'),
        ),
      );
    const seen = new Set(stored.map(b => `${b.subscriptionId}:${b.date}`));
    const bills = stored.filter(b => b.status !== 'skipped').map(b => ({ ...b, paid: b.status === 'paid' }));
    for (const plan of plans) {
      const start =
        plan.status === 'active'
          ? today
          : plan.status === 'paused' && plan.pausedUntil
            ? plan.pausedUntil > today
              ? plan.pausedUntil
              : today
            : null;
      if (!start) continue;
      const cycle = { unit: plan.cycleUnit, count: plan.cycleCount };
      for (const date of occurrencesBetween(plan.anchorDate, cycle, start > from ? start : from, to)) {
        if (plan.endsOn && date > plan.endsOn) break;
        if (seen.has(`${plan.id}:${date}`)) continue;
        bills.push({
          subscriptionId: plan.id,
          date,
          status: 'scheduled',
          amount: plan.amount,
          currency: plan.currency,
          paid: false,
        });
      }
    }
    const byMonth = new Map(months.map(m => [m, { paid: sum([]), pending: sum([]), count: 0, paidCount: 0 }]));
    for (const bill of bills) {
      const r = await rate(bill.currency);
      const bucket = byMonth.get(bill.date.slice(0, 7));
      if (r === null) excluded.add(bill.subscriptionId);
      if (r === null || !bucket) continue;
      const value = convert(sum([bill.amount]).toFixed(), bill.currency, r, currency);
      if (bill.paid) {
        bucket.paid = bucket.paid.plus(value);
        bucket.paidCount++;
      } else bucket.pending = bucket.pending.plus(value);
      bucket.count++;
    }
    const timeline = months.map(m => {
      const b = byMonth.get(m)!;
      return {
        month: m,
        paid: f(b.paid),
        pending: f(b.pending),
        total: f(b.paid.plus(b.pending)),
        count: b.count,
        paidCount: b.paidCount,
      };
    });
    const top = valued[0] ?? null;
    return {
      month,
      today,
      counts: {
        active: active.length,
        paused: items.filter(i => i.status === 'paused').length,
        cancelled: items.filter(i => i.status === 'cancelled').length,
      },
      monthly: f(monthly),
      yearly: f(total(active, 'yearly')),
      averageMonthly: f(valued.length ? monthly.dividedBy(valued.length) : sum([])),
      top: top && { subscriptionId: top.subscriptionId, name: top.name, monthly: top.monthly! },
      inactive: {
        count: inactive.length,
        monthly: f(total(inactive, 'monthly')),
        yearly: f(total(inactive, 'yearly')),
      },
      bills: timeline.find(t => t.month === month)!,
      timeline,
      items,
      byCategory: group('categoryId', categoryNames, '未分类'),
      byAccount: group('accountId', accountNames, '未指定账户'),
      currency,
      valuationMode: 'current' as const,
      partial: excluded.size > 0,
      excludedCount: excluded.size,
      dataVersion: version,
      sourceAt: (oldest as Date | null)?.toISOString() ?? null,
    };
  });
}
export type SubscriptionSpending = Awaited<ReturnType<typeof subscriptionSpending>>;

// ---------- budgets ----------

type BudgetRow = typeof budgets.$inferSelect;
export const presentBudget = (row: BudgetRow) => ({
  id: row.id,
  name: row.name,
  categoryId: row.categoryId,
  period: row.period,
  amount: { amount: formatAmount(row.amount, row.currency), currency: row.currency },
  startDate: row.startDate,
  alertThresholds: row.alertThresholds as number[],
  archivedAt: row.archivedAt?.toISOString() ?? null,
  version: row.version,
});
const budgetNotFound = () => new DomainError(404, 'NOT_FOUND', '预算不存在或你没有访问权限');
async function expenseCategory(tx: Tx, ledgerId: string, categoryId: string) {
  const [row] = await tx
    .select()
    .from(categories)
    .where(and(eq(categories.ledgerId, ledgerId), eq(categories.id, categoryId)));
  if (!row || row.archivedAt || row.kind !== 'expense') {
    throw new DomainError(422, 'INVALID_CATEGORY', '预算只能针对未归档的支出分类');
  }
}
export async function listBudgets(ctx: AuthContext, ledgerId: string, page: Keyset) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const after =
    page.after &&
    or(
      gt(budgets.createdAt, new Date(page.after[0])),
      and(eq(budgets.createdAt, new Date(page.after[0])), gt(budgets.id, page.after[1])),
    );
  return database()
    .select()
    .from(budgets)
    .where(and(eq(budgets.ledgerId, ledgerId), isNull(budgets.archivedAt), after))
    .orderBy(asc(budgets.createdAt), asc(budgets.id))
    .limit(page.limit + 1);
}
/** Budgets are in the ledger's base currency and use booked (historical) amounts. */
export async function createBudget(ctx: AuthContext, ledgerId: string, input: unknown, db: Executor = database()) {
  const data = BudgetCreate.parse(input);
  return db.transaction(async tx => {
    const ledger = await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    if (data.amount.currency !== ledger.baseCurrency) {
      throw new DomainError(422, 'BUDGET_CURRENCY', `预算须使用账本基准币 ${ledger.baseCurrency}`);
    }
    const amount = parseAmount(data.amount.amount, data.amount.currency);
    if (data.categoryId) await expenseCategory(tx, ledgerId, data.categoryId);
    const now = new Date();
    const row: BudgetRow = {
      id: randomUUID(),
      ledgerId,
      name: data.name ?? null,
      categoryId: data.categoryId ?? null,
      period: data.period,
      amount: toColumn(amount),
      currency: data.amount.currency,
      startDate: data.startDate,
      alertThresholds: [...new Set(data.alertThresholds)].sort((a, b) => a - b),
      archivedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await tx.insert(budgets).values(row);
    await audit(tx, ctx, ledgerId, 'budget.created', row.id);
    await emit(tx, ledgerId, 'budget.created', { budgetId: row.id });
    return presentBudget(row);
  });
}
async function lockBudget(tx: Tx, ledgerId: string, id: string) {
  const [row] = await tx
    .select()
    .from(budgets)
    .where(and(eq(budgets.ledgerId, ledgerId), eq(budgets.id, id)))
    .for('update');
  if (!row) throw budgetNotFound();
  return row;
}
export async function updateBudget(
  ctx: AuthContext,
  ledgerId: string,
  id: string,
  input: unknown,
  etag: string | null,
) {
  const data = BudgetUpdate.parse(input);
  return database().transaction(async tx => {
    const ledger = await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const row = await lockBudget(tx, ledgerId, id);
    requireVersion(etag, row.version);
    if (row.archivedAt) throw new DomainError(409, 'BUDGET_ARCHIVED', '预算已归档');
    if (data.amount && data.amount.currency !== ledger.baseCurrency) {
      throw new DomainError(422, 'BUDGET_CURRENCY', `预算须使用账本基准币 ${ledger.baseCurrency}`);
    }
    const changes = {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.amount ? { amount: toColumn(parseAmount(data.amount.amount, data.amount.currency)) } : {}),
      ...(data.alertThresholds ? { alertThresholds: [...new Set(data.alertThresholds)].sort((a, b) => a - b) } : {}),
      version: row.version + 1,
      updatedAt: new Date(),
    };
    await tx
      .update(budgets)
      .set(changes)
      .where(and(eq(budgets.ledgerId, ledgerId), eq(budgets.id, id)));
    await audit(tx, ctx, ledgerId, 'budget.updated', id);
    await emit(tx, ledgerId, 'budget.updated', { budgetId: id });
    return presentBudget({ ...row, ...changes });
  });
}
export async function archiveBudget(ctx: AuthContext, ledgerId: string, id: string, etag: string | null) {
  return database().transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const row = await lockBudget(tx, ledgerId, id);
    if (!etag) requireVersion(etag, row.version);
    if (row.archivedAt) return presentBudget(row);
    requireVersion(etag, row.version);
    const changes = { archivedAt: new Date(), version: row.version + 1, updatedAt: new Date() };
    await tx
      .update(budgets)
      .set(changes)
      .where(and(eq(budgets.ledgerId, ledgerId), eq(budgets.id, id)));
    await audit(tx, ctx, ledgerId, 'budget.archived', id);
    await emit(tx, ledgerId, 'budget.archived', { budgetId: id });
    return presentBudget({ ...row, ...changes });
  });
}

/** Spending against each active budget in the period containing `date` (historical amounts; refunds offset). */
export async function budgetProgress(ctx: AuthContext, ledgerId: string, query: unknown, now = new Date()) {
  const q = BudgetProgressQuery.parse(query);
  const ledger = await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const date = q.date ?? localDate(now, ledger.timezone);
  return cached(ledgerId, 'budget-progress', { date }, false, async version => {
    const db = database();
    const rows = await db
      .select()
      .from(budgets)
      .where(and(eq(budgets.ledgerId, ledgerId), isNull(budgets.archivedAt), lte(budgets.startDate, date)))
      .orderBy(asc(budgets.createdAt), asc(budgets.id));
    const items = [];
    for (const budget of rows) {
      const { start, end } = periodOf(date, budget.period);
      const spentRows = await periodRows(db, ledgerId, {
        dateFrom: start > budget.startDate ? start : budget.startDate,
        dateTo: end,
        categoryIds: await categoryScope(db, ledgerId, budget.categoryId ?? undefined),
      });
      let spent = sum([]);
      for (const row of spentRows) {
        if (row.kind !== 'income' && row.baseCurrency === budget.currency) {
          spent = row.kind === 'expense' ? spent.plus(row.baseAmount) : spent.minus(row.baseAmount);
        }
      }
      const amount = sum([budget.amount]);
      const ratio = spent.dividedBy(amount);
      items.push({
        budgetId: budget.id,
        name: budget.name,
        categoryId: budget.categoryId,
        period: budget.period,
        periodStart: start,
        periodEnd: end,
        amount: { amount: formatAmount(amount, budget.currency), currency: budget.currency },
        spent: formatAmount(spent, budget.currency),
        remaining: formatAmount(amount.minus(spent), budget.currency),
        ratio: ratio.toDecimalPlaces(4).toFixed(),
        reachedThresholds: (budget.alertThresholds as number[]).filter(t => ratio.times(100).greaterThanOrEqualTo(t)),
      });
    }
    return {
      date,
      items,
      currency: ledger.baseCurrency,
      valuationMode: 'historical' as const,
      partial: false,
      excludedCount: 0,
      dataVersion: version,
      sourceAt: null,
    };
  });
}
export type BudgetProgressItem = Awaited<ReturnType<typeof budgetProgress>>['items'][number];
export type ReportQueryInput = z.input<typeof ReportQuery>;
