import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, gte, inArray, lt, lte, ne, or, sql } from 'drizzle-orm';
import {
  BillOccurrenceQuery,
  BillOccurrenceUpdate,
  BillPaymentCreate,
  SubscriptionPreviewCreate,
  SubscriptionQuery,
  SubscriptionUpdate,
} from '@ledger/contracts/planning';
import { PreviewSubmit } from '@ledger/contracts/finance';
import { database, type Executor, type Tx } from '@ledger/db/index';
import {
  accounts,
  billOccurrences,
  categories,
  ledgers,
  subscriptionPreviews,
  subscriptions,
  transactions,
} from '@ledger/db/schema';
import { ledgerAccess } from './access';
import { audit, emit } from './audit';
import { addDays, localDate } from './dates';
import type { AuthContext, Keyset } from './identity';
import { formatAmount, parseAmount, sum, toColumn } from './money';
import { DomainError, requireVersion } from './policy';
import { cyclesPerYear, nextOccurrences, occurrencesBetween, scheduleWarnings, type Cycle } from './schedule';
import { createTransaction, getTransaction } from './transactions';
import { cancelForSubjects } from './notify-store';

const PREVIEW_TTL_MS = 10 * 60 * 1000;
/** Occurrences are materialized this far ahead (and at least the next three). */
export const HORIZON_DAYS = 90;
type SubscriptionRow = typeof subscriptions.$inferSelect;
type OccurrenceRow = typeof billOccurrences.$inferSelect;
const invalid = (code: string, message: string) => new DomainError(422, code, message);
const notFound = (what: string) => new DomainError(404, 'NOT_FOUND', `${what}不存在或你没有访问权限`);
const cycleOf = (row: SubscriptionRow): Cycle => ({ unit: row.cycleUnit, count: row.cycleCount });

/** Forecast only: amount × cycles per year / 12, in the subscription currency. Never mixed into actual spending. */
export function monthlyEquivalent(amount: string, currency: string, cycle: Cycle) {
  const [num, den] = cyclesPerYear(cycle);
  return {
    amount: formatAmount(
      sum([amount])
        .times(num)
        .dividedBy(den)
        .dividedBy(12)
        .toDecimalPlaces(currency === 'JPY' ? 0 : 2),
      currency,
    ),
    currency,
  };
}
/** Stored status may lag the clock; reads derive due / overdue from the business date. */
export function effectiveStatus(
  row: { status: OccurrenceRow['status']; scheduledDate: string },
  today: string,
): OccurrenceRow['status'] {
  if (row.status !== 'scheduled' && row.status !== 'due' && row.status !== 'overdue') return row.status;
  return row.scheduledDate > today ? 'scheduled' : row.scheduledDate === today ? 'due' : 'overdue';
}

async function ledgerToday(db: Executor | Tx, ledgerId: string, now = new Date()) {
  const [ledger] = await db
    .select({ timezone: ledgers.timezone, baseCurrency: ledgers.baseCurrency })
    .from(ledgers)
    .where(eq(ledgers.id, ledgerId));
  return { ...ledger, today: localDate(now, ledger.timezone) };
}
async function nextDue(db: Executor | Tx, row: SubscriptionRow, today: string) {
  if (row.status !== 'active') return null;
  const [next] = await db
    .select({ date: billOccurrences.scheduledDate })
    .from(billOccurrences)
    .where(
      and(eq(billOccurrences.subscriptionId, row.id), inArray(billOccurrences.status, ['scheduled', 'due', 'overdue'])),
    )
    .orderBy(asc(billOccurrences.scheduledDate))
    .limit(1);
  return next?.date ?? nextOccurrences(row.anchorDate, cycleOf(row), today, 1)[0];
}
async function present(db: Executor | Tx, row: SubscriptionRow, today: string) {
  const amount = formatAmount(row.amount, row.currency);
  return {
    id: row.id,
    name: row.name,
    amount: { amount, currency: row.currency },
    accountId: row.accountId,
    categoryId: row.categoryId,
    cycle: cycleOf(row),
    anchorDate: row.anchorDate,
    timezone: row.timezone,
    status: row.status,
    nextDueDate: await nextDue(db, row, today),
    note: row.note,
    scheduleVersion: row.scheduleVersion,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    pausedUntil: row.pausedUntil,
    endsOn: row.endsOn,
    monthlyEquivalent: monthlyEquivalent(amount, row.currency, cycleOf(row)),
    trialEndsOn: row.trialEndsOn,
    cancelBy: row.cancelBy,
  };
}
function presentOccurrence(row: OccurrenceRow, name: string, today: string) {
  return {
    id: row.id,
    subscriptionId: row.subscriptionId,
    name,
    scheduledDate: row.scheduledDate,
    scheduleVersion: row.scheduleVersion,
    status: effectiveStatus(row, today),
    amount: { amount: formatAmount(row.amount, row.currency), currency: row.currency },
    transactionId: row.transactionId,
    paidAt: row.paidAt?.toISOString() ?? null,
    version: row.version,
  };
}

async function validateRefs(tx: Tx, ledgerId: string, data: { accountId?: string | null; categoryId?: string | null }) {
  if (data.accountId) {
    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.ledgerId, ledgerId), eq(accounts.id, data.accountId)));
    if (!account || account.archivedAt) throw invalid('ACCOUNT_NOT_FOUND', '支付账户不存在或已归档');
  }
  if (data.categoryId) {
    const [category] = await tx
      .select()
      .from(categories)
      .where(and(eq(categories.ledgerId, ledgerId), eq(categories.id, data.categoryId)));
    if (!category || category.archivedAt || category.kind !== 'expense') {
      throw invalid('INVALID_CATEGORY', '分类须为未归档的支出分类');
    }
  }
}

/** Validates a schedule and shows the next three dates; stores the normalized input for a single submit. */
export async function createSubscriptionPreview(ctx: AuthContext, ledgerId: string, body: unknown, now = new Date()) {
  const input = SubscriptionPreviewCreate.parse(body);
  const amount = parseAmount(input.amount.amount, input.amount.currency);
  return database().transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'editor');
    await validateRefs(tx, ledgerId, input);
    const today = localDate(now, input.timezone);
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS);
    const normalized = { ...input, amount: { amount, currency: input.amount.currency } };
    await tx
      .insert(subscriptionPreviews)
      .values({ id, ledgerId, actorId: ctx.userId, normalizedInput: normalized, expiresAt, createdAt: now });
    const warnings = [
      ...scheduleWarnings(input.anchorDate, input.cycle),
      ...(input.anchorDate < today
        ? [{ code: 'ANCHOR_IN_PAST', message: '锚点在过去：只生成今天及以后的账单，历史期数不会补记' }]
        : []),
    ];
    return {
      previewId: id,
      expiresAt: expiresAt.toISOString(),
      nextOccurrences: nextOccurrences(input.anchorDate, input.cycle, today, 3),
      monthlyEquivalent: monthlyEquivalent(amount, input.amount.currency, input.cycle),
      warnings,
    };
  });
}

/** Creates occurrences of the current schedule version from `from` through the horizon; existing rows are kept. */
async function materialize(tx: Tx, row: SubscriptionRow, from: string, now = new Date()) {
  if (row.status !== 'active') return 0;
  const horizon = addDays(from, HORIZON_DAYS);
  const end = row.endsOn && addDays(row.endsOn, 1) < horizon ? addDays(row.endsOn, 1) : horizon;
  const dates = occurrencesBetween(row.anchorDate, cycleOf(row), from, end);
  const ahead = nextOccurrences(row.anchorDate, cycleOf(row), from, 3).filter(d => !row.endsOn || d <= row.endsOn);
  const all = [...new Set([...dates, ...ahead])];
  if (!all.length) return 0;
  const [result] = await tx
    .insert(billOccurrences)
    .values(
      all.map(scheduledDate => ({
        id: randomUUID(),
        ledgerId: row.ledgerId,
        subscriptionId: row.id,
        scheduleVersion: row.scheduleVersion,
        scheduledDate,
        status: 'scheduled' as const,
        amount: row.amount,
        currency: row.currency,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  return result.affectedRows;
}
/** Unpaid occurrences from `from` on stop being payable (pause / cancel / schedule change); paid history stays. */
async function cancelFuture(tx: Tx, subscriptionId: string, from: string) {
  // Their queued reminders are cancelled in the same transaction (TECHNICAL_DESIGN §6.1, AC05).
  const ids = (
    await tx
      .select({ id: billOccurrences.id })
      .from(billOccurrences)
      .where(
        and(
          eq(billOccurrences.subscriptionId, subscriptionId),
          gte(billOccurrences.scheduledDate, from),
          inArray(billOccurrences.status, ['scheduled', 'due', 'overdue']),
        ),
      )
  ).map(r => r.id);
  await cancelForSubjects(tx, ids, '订阅已暂停、取消或改期');
  await tx
    .update(billOccurrences)
    .set({ status: 'cancelled', version: sql`${billOccurrences.version} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(billOccurrences.subscriptionId, subscriptionId),
        gte(billOccurrences.scheduledDate, from),
        inArray(billOccurrences.status, ['scheduled', 'due', 'overdue']),
      ),
    );
}

export async function createSubscription(
  ctx: AuthContext,
  ledgerId: string,
  body: unknown,
  db: Executor = database(),
  now = new Date(),
) {
  const { previewId } = PreviewSubmit.parse(body);
  return db.transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const [preview] = await tx
      .select()
      .from(subscriptionPreviews)
      .where(
        and(
          eq(subscriptionPreviews.id, previewId),
          eq(subscriptionPreviews.ledgerId, ledgerId),
          eq(subscriptionPreviews.actorId, ctx.userId),
        ),
      )
      .for('update');
    if (!preview) throw invalid('PREVIEW_NOT_FOUND', '预览不存在或不属于当前用户');
    if (preview.consumedAt) throw new DomainError(409, 'PREVIEW_CONSUMED', '该预览已提交');
    if (preview.expiresAt <= now) throw invalid('PREVIEW_EXPIRED', '预览已过期，请重新预览');
    const input = SubscriptionPreviewCreate.parse(preview.normalizedInput);
    try {
      await validateRefs(tx, ledgerId, input);
    } catch {
      throw new DomainError(409, 'PREVIEW_STALE', '账户或分类已变化，请重新预览');
    }
    const row: SubscriptionRow = {
      id: randomUUID(),
      ledgerId,
      name: input.name,
      amount: toColumn(input.amount.amount),
      currency: input.amount.currency,
      accountId: input.accountId ?? null,
      categoryId: input.categoryId ?? null,
      cycleUnit: input.cycle.unit,
      cycleCount: input.cycle.count,
      anchorDate: input.anchorDate,
      timezone: input.timezone,
      status: 'active',
      pausedUntil: null,
      endsOn: null,
      note: input.note ?? null,
      scheduleVersion: 1,
      version: 1,
      createdBy: ctx.userId,
      trialEndsOn: input.trialEndsOn ?? null,
      cancelBy: input.cancelBy ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await tx.insert(subscriptions).values(row);
    await materialize(tx, row, localDate(now, row.timezone), now);
    await tx
      .update(subscriptionPreviews)
      .set({ consumedAt: now, consumedBy: row.id })
      .where(eq(subscriptionPreviews.id, previewId));
    await audit(tx, ctx, ledgerId, 'subscription.created', row.id);
    await emit(tx, ledgerId, 'subscription.created', { subscriptionId: row.id, scheduleVersion: 1 });
    return present(tx, row, localDate(now, row.timezone));
  });
}

async function lockSubscription(tx: Tx, ledgerId: string, id: string) {
  const [row] = await tx
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.ledgerId, ledgerId), eq(subscriptions.id, id)))
    .for('update');
  if (!row) throw notFound('订阅');
  return row;
}
/**
 * Edit / pause / resume / cancel. Changing amount, currency, cycle, anchor or account starts a new schedule version:
 * unpaid future bills of the old version are cancelled (their reminders then fail the version check), history stays.
 */
export async function updateSubscription(
  ctx: AuthContext,
  ledgerId: string,
  id: string,
  body: unknown,
  etag: string | null,
  now = new Date(),
) {
  const data = SubscriptionUpdate.parse(body);
  return database().transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const row = await lockSubscription(tx, ledgerId, id);
    requireVersion(etag, row.version);
    if (row.status === 'cancelled') throw new DomainError(409, 'SUBSCRIPTION_CANCELLED', '已取消的订阅不能再修改');
    await validateRefs(tx, ledgerId, data);
    const today = localDate(now, row.timezone);
    const next: SubscriptionRow = { ...row, version: row.version + 1, updatedAt: now };
    if (data.name !== undefined) next.name = data.name;
    if (data.note !== undefined) next.note = data.note;
    if (data.categoryId !== undefined) next.categoryId = data.categoryId;
    if (data.trialEndsOn !== undefined) next.trialEndsOn = data.trialEndsOn;
    if (data.cancelBy !== undefined) next.cancelBy = data.cancelBy;
    if (data.amount) {
      next.amount = toColumn(parseAmount(data.amount.amount, data.amount.currency));
      next.currency = data.amount.currency;
    }
    if (data.cycle) {
      next.cycleUnit = data.cycle.unit;
      next.cycleCount = data.cycle.count;
    }
    if (data.anchorDate) next.anchorDate = data.anchorDate;
    if (data.accountId !== undefined) next.accountId = data.accountId;
    const scheduleChanged = ['amount', 'currency', 'cycleUnit', 'cycleCount', 'anchorDate', 'accountId'].some(
      k => next[k as keyof SubscriptionRow] !== row[k as keyof SubscriptionRow],
    );
    let action = 'subscription.updated';
    if (data.status && data.status !== row.status) {
      next.status = data.status;
      if (data.status === 'paused') {
        next.pausedUntil = data.pausedUntil ?? null;
        action = 'subscription.paused';
      }
      if (data.status === 'active') {
        next.pausedUntil = null;
        action = 'subscription.resumed';
      }
      if (data.status === 'cancelled') {
        next.endsOn = data.endsOn ?? today;
        action = 'subscription.cancelled';
      }
    } else if (data.pausedUntil !== undefined && row.status === 'paused') next.pausedUntil = data.pausedUntil;
    if (next.status === 'paused' && next.pausedUntil && next.pausedUntil <= today) {
      throw invalid('INVALID_PAUSE', '恢复日期须晚于今天');
    }
    const restart = scheduleChanged || next.status !== row.status;
    if (restart) {
      // Pausing, resuming, cancelling and schedule edits all supersede the unpaid future plan.
      next.scheduleVersion = row.scheduleVersion + 1;
      await cancelFuture(tx, id, next.status === 'cancelled' ? addDays(next.endsOn!, 1) : today);
    }
    await tx
      .update(subscriptions)
      .set(next)
      .where(and(eq(subscriptions.ledgerId, ledgerId), eq(subscriptions.id, id)));
    if (restart && next.status === 'active') await materialize(tx, next, today, now);
    await audit(tx, ctx, ledgerId, action, id);
    await emit(tx, ledgerId, action, { subscriptionId: id, scheduleVersion: next.scheduleVersion });
    return present(tx, next, today);
  });
}

export async function getSubscription(ctx: AuthContext, ledgerId: string, id: string, now = new Date()) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const [row] = await database()
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.ledgerId, ledgerId), eq(subscriptions.id, id)));
  if (!row) throw notFound('订阅');
  return present(database(), row, localDate(now, row.timezone));
}
export async function listSubscriptions(
  ctx: AuthContext,
  ledgerId: string,
  query: unknown,
  page: Keyset,
  now = new Date(),
) {
  const q = SubscriptionQuery.partial().parse(query);
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const after =
    page.after &&
    or(
      gt(subscriptions.createdAt, new Date(page.after[0])),
      and(eq(subscriptions.createdAt, new Date(page.after[0])), gt(subscriptions.id, page.after[1])),
    );
  const rows = await database()
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.ledgerId, ledgerId), q.status ? eq(subscriptions.status, q.status) : undefined, after))
    .orderBy(asc(subscriptions.createdAt), asc(subscriptions.id))
    .limit(page.limit + 1);
  return Promise.all(
    rows.map(async row => ({
      ...(await present(database(), row, localDate(now, row.timezone))),
      position: [row.createdAt.toISOString(), row.id] as [string, string],
    })),
  );
}

export async function listBillOccurrences(
  ctx: AuthContext,
  ledgerId: string,
  query: unknown,
  page: { limit: number; after?: [string, string] },
  now = new Date(),
) {
  const q = BillOccurrenceQuery.parse(query);
  if (q.dateFrom >= q.dateTo) throw invalid('INVALID_RANGE', 'dateTo 须晚于 dateFrom（不含当日）');
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const { today } = await ledgerToday(database(), ledgerId, now);
  // Status filters use the derived status: map it back to stored states and dates.
  const statusFilter =
    q.status === undefined
      ? ne(billOccurrences.status, 'cancelled')
      : ['paid', 'skipped', 'cancelled'].includes(q.status)
        ? eq(billOccurrences.status, q.status)
        : and(
            inArray(billOccurrences.status, ['scheduled', 'due', 'overdue']),
            q.status === 'scheduled'
              ? gt(billOccurrences.scheduledDate, today)
              : q.status === 'due'
                ? eq(billOccurrences.scheduledDate, today)
                : lt(billOccurrences.scheduledDate, today),
          );
  const after =
    page.after &&
    or(
      gt(billOccurrences.scheduledDate, page.after[0]),
      and(eq(billOccurrences.scheduledDate, page.after[0]), gt(billOccurrences.id, page.after[1])),
    );
  const rows = await database()
    .select({ o: billOccurrences, name: subscriptions.name })
    .from(billOccurrences)
    .innerJoin(
      subscriptions,
      and(eq(subscriptions.ledgerId, billOccurrences.ledgerId), eq(subscriptions.id, billOccurrences.subscriptionId)),
    )
    .where(
      and(
        eq(billOccurrences.ledgerId, ledgerId),
        gte(billOccurrences.scheduledDate, q.dateFrom),
        lt(billOccurrences.scheduledDate, q.dateTo),
        q.subscriptionId ? eq(billOccurrences.subscriptionId, q.subscriptionId) : undefined,
        statusFilter,
        after,
      ),
    )
    .orderBy(asc(billOccurrences.scheduledDate), asc(billOccurrences.id))
    .limit(page.limit + 1);
  return rows.map(({ o, name }) => ({
    ...presentOccurrence(o, name, today),
    position: [o.scheduledDate, o.id] as [string, string],
  }));
}
async function lockOccurrence(tx: Tx, ledgerId: string, id: string) {
  const [row] = await tx
    .select({ o: billOccurrences, name: subscriptions.name })
    .from(billOccurrences)
    .innerJoin(
      subscriptions,
      and(eq(subscriptions.ledgerId, billOccurrences.ledgerId), eq(subscriptions.id, billOccurrences.subscriptionId)),
    )
    .where(and(eq(billOccurrences.ledgerId, ledgerId), eq(billOccurrences.id, id)))
    .for('update');
  if (!row) throw notFound('账单');
  return row;
}
export async function getBillOccurrence(ctx: AuthContext, ledgerId: string, id: string, now = new Date()) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const { today } = await ledgerToday(database(), ledgerId, now);
  const [row] = await database()
    .select({ o: billOccurrences, name: subscriptions.name })
    .from(billOccurrences)
    .innerJoin(
      subscriptions,
      and(eq(subscriptions.ledgerId, billOccurrences.ledgerId), eq(subscriptions.id, billOccurrences.subscriptionId)),
    )
    .where(and(eq(billOccurrences.ledgerId, ledgerId), eq(billOccurrences.id, id)));
  if (!row) throw notFound('账单');
  return presentOccurrence(row.o, row.name, today);
}
/** Skip (or restore) one bill. Paid bills cannot change; a cancelled plan cannot be restored. */
export async function updateBillOccurrence(
  ctx: AuthContext,
  ledgerId: string,
  id: string,
  body: unknown,
  etag: string | null,
  now = new Date(),
) {
  const data = BillOccurrenceUpdate.parse(body);
  return database().transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const { o, name } = await lockOccurrence(tx, ledgerId, id);
    requireVersion(etag, o.version);
    if (o.status === 'paid') throw new DomainError(409, 'ALREADY_PAID', '已支付的账单不能修改');
    if (o.status === 'cancelled') throw new DomainError(409, 'BILL_CANCELLED', '该账单所属计划已取消');
    if (data.status === 'scheduled' && o.status !== 'skipped') {
      throw new DomainError(409, 'BILL_NOT_SKIPPED', '只有已跳过的账单可以恢复');
    }
    const next = { ...o, status: data.status, version: o.version + 1, updatedAt: now };
    await tx
      .update(billOccurrences)
      .set({ status: data.status, version: next.version, updatedAt: now })
      .where(eq(billOccurrences.id, id));
    if (data.status === 'skipped') await cancelForSubjects(tx, [id], '账单已跳过');
    await audit(tx, ctx, ledgerId, data.status === 'skipped' ? 'bill.skipped' : 'bill.restored', id);
    await emit(tx, ledgerId, data.status === 'skipped' ? 'bill.skipped' : 'bill.restored', {
      occurrenceId: id,
      subscriptionId: o.subscriptionId,
    });
    return presentOccurrence(next, name, (await ledgerToday(tx, ledgerId, now)).today);
  });
}

/**
 * Records that a bill was actually paid: either submits a new expense preview (booked with source "subscription")
 * or links an existing posted expense. One transaction pays at most one bill and a bill is paid at most once.
 */
export async function createBillPayment(
  ctx: AuthContext,
  ledgerId: string,
  id: string,
  body: unknown,
  db: Executor = database(),
  now = new Date(),
) {
  const data = BillPaymentCreate.parse(body);
  return db.transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const { o, name } = await lockOccurrence(tx, ledgerId, id);
    if (o.status === 'paid') throw new DomainError(409, 'ALREADY_PAID', '该账单已登记支付');
    if (o.status === 'skipped' || o.status === 'cancelled') {
      throw new DomainError(409, 'BILL_NOT_PAYABLE', '已跳过或已取消的账单不能登记支付');
    }
    let transactionId: string;
    if ('previewId' in data) {
      transactionId = (
        await createTransaction(ctx, ledgerId, { previewId: data.previewId }, tx, {
          source: 'subscription',
          kinds: ['expense'],
        })
      ).id;
    } else {
      const [existing] = await tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.ledgerId, ledgerId), eq(transactions.id, data.transactionId)))
        .for('update');
      if (!existing || existing.kind !== 'expense' || existing.status !== 'posted') {
        throw invalid('INVALID_PAYMENT', '只能关联有效的支出');
      }
      const [linked] = await tx
        .select({ id: billOccurrences.id })
        .from(billOccurrences)
        .where(and(eq(billOccurrences.ledgerId, ledgerId), eq(billOccurrences.transactionId, existing.id)));
      if (linked) throw new DomainError(409, 'ALREADY_LINKED', '该支出已关联其他账单');
      transactionId = existing.id;
    }
    await tx
      .update(billOccurrences)
      .set({ status: 'paid', transactionId, paidAt: now, version: o.version + 1, updatedAt: now })
      .where(eq(billOccurrences.id, id));
    await cancelForSubjects(tx, [id], '账单已支付');
    await audit(tx, ctx, ledgerId, 'bill.paid', id);
    await emit(tx, ledgerId, 'bill.paid', { occurrenceId: id, subscriptionId: o.subscriptionId, transactionId });
    const today = (await ledgerToday(tx, ledgerId, now)).today;
    return {
      occurrence: presentOccurrence(
        { ...o, status: 'paid', transactionId, paidAt: now, version: o.version + 1 },
        name,
        today,
      ),
      transaction: await getTransaction(ctx, ledgerId, transactionId, tx),
    };
  });
}

// ---------- worker ----------

/**
 * Keeps every active schedule materialized through the horizon, stores due / overdue for reminders, and resumes
 * subscriptions whose pause ended. Safe to run repeatedly and on several workers (unique occurrence key).
 */
export async function maintainSubscriptions(now = new Date()) {
  // Candidates: active schedules, and pauses that end today in the earliest timezone (UTC+14); each row then
  // checks its own timezone.
  const due = await database()
    .select()
    .from(subscriptions)
    .where(
      or(
        eq(subscriptions.status, 'active'),
        and(eq(subscriptions.status, 'paused'), lte(subscriptions.pausedUntil, localDate(now, 'Pacific/Kiritimati'))),
      ),
    );
  let created = 0;
  let resumed = 0;
  for (const row of due) {
    await database().transaction(async tx => {
      const [locked] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, row.id))
        .for('update', { skipLocked: true });
      if (!locked) return;
      const today = localDate(now, locked.timezone);
      if (locked.status === 'paused') {
        if (!locked.pausedUntil || locked.pausedUntil > today) return;
        const next = {
          ...locked,
          status: 'active' as const,
          pausedUntil: null,
          scheduleVersion: locked.scheduleVersion + 1,
          version: locked.version + 1,
          updatedAt: now,
        };
        await tx.update(subscriptions).set(next).where(eq(subscriptions.id, locked.id));
        await emit(tx, locked.ledgerId, 'subscription.resumed', {
          subscriptionId: locked.id,
          scheduleVersion: next.scheduleVersion,
          automatic: true,
        });
        created += await materialize(tx, next, today, now);
        resumed++;
        return;
      }
      created += await materialize(tx, locked, today, now);
      await tx
        .update(billOccurrences)
        .set({ status: sql`IF(${billOccurrences.scheduledDate} = ${today}, 'due', 'overdue')`, updatedAt: now })
        .where(
          and(
            eq(billOccurrences.subscriptionId, locked.id),
            inArray(billOccurrences.status, ['scheduled', 'due']),
            lte(billOccurrences.scheduledDate, today),
            ne(sql`IF(${billOccurrences.scheduledDate} = ${today}, 'due', 'overdue')`, billOccurrences.status),
          ),
        );
    });
  }
  return { subscriptions: due.length, created, resumed };
}
