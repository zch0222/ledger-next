import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { DeliveryQuery, NotificationQuery, NotificationUpdate } from '@ledger/contracts/platform';
import { database, type Executor, type Tx } from '@ledger/db/index';
import {
  ledgers,
  notificationAttempts,
  notificationChannels,
  notificationDeliveries,
  notifications,
  reminderRules,
} from '@ledger/db/schema';
import { ledgerAccess } from './access';
import { sendMessage, type SendResult } from './channels';
import { addDays, localDate, zonedInstant } from './dates';
import type { AuthContext, Keyset } from './identity';
import { channelConfig, MAX_ATTEMPTS, presentDelivery, type DeliveryRow } from './notify-store';
import { DomainError, requireVersion } from './policy';
import { deliveryFailedAlerts, quietNow, quietOf, render, stillValid } from './reminders';
import { deferQuietHours, localTimeOf } from './reminder-schedule';
import { reportSummary } from './reports';

// Delivery engine (TECHNICAL_DESIGN §6.3). States: queued → sending → accepted / delivered | queued (retry) |
// failed (+ dead letter) | delivery_unknown | expired | cancelled. Delivery is at-least-once with explicit
// "unknown" when the outcome cannot be known; nothing is resent automatically after a possibly accepted request.
const CHANNEL_DEGRADE_AFTER = 3;
// A claim older than this without a finished attempt is recovered by sweepStuck (NOTIFY_STUCK_SECONDS, default 120).
const stuckMs = () => Number(process.env.NOTIFY_STUCK_SECONDS || 120) * 1000;

/**
 * Exponential backoff with jitter (attempt 1 → ~30 s … attempt 4 → ~4 min, capped at 15 min); Retry-After wins.
 * NOTIFY_BACKOFF_BASE_MS shortens the base for the chaos test stack only.
 */
export function backoffMs(attempt: number, retryAfterMs?: number, random = Math.random) {
  if (retryAfterMs) return retryAfterMs;
  const base = Math.min(15 * 60_000, Number(process.env.NOTIFY_BACKOFF_BASE_MS || 30_000) * 2 ** (attempt - 1));
  return Math.round(base * (0.5 + random()));
}

/** Expires overdue queued deliveries and claims due ones (SKIP LOCKED); returns the claimed ids with their attempt. */
export async function claimDue(limit = 50, now = new Date()) {
  return database().transaction(async tx => {
    const rows = await tx
      .select()
      .from(notificationDeliveries)
      .where(and(eq(notificationDeliveries.status, 'queued'), lte(notificationDeliveries.nextAttemptAt, now)))
      .orderBy(asc(notificationDeliveries.nextAttemptAt))
      .limit(limit)
      .for('update', { skipLocked: true });
    const claimed: { id: string; round: number; attempt: number }[] = [];
    for (const row of rows) {
      if (row.expiresAt <= now) {
        await tx
          .update(notificationDeliveries)
          .set({
            status: 'expired',
            reason: row.attempts ? '重试期间超过提醒有效期' : '发送前已超过提醒有效期（调度延迟或停机）',
            version: row.version + 1,
            updatedAt: now,
          })
          .where(eq(notificationDeliveries.id, row.id));
        continue;
      }
      await tx
        .update(notificationDeliveries)
        .set({
          status: 'sending',
          attempts: row.attempts + 1,
          claimedAt: now,
          version: row.version + 1,
          updatedAt: now,
        })
        .where(eq(notificationDeliveries.id, row.id));
      claimed.push({ id: row.id, round: row.round, attempt: row.attempts + 1 });
    }
    return claimed;
  });
}

async function finish(db: Executor | Tx, row: DeliveryRow, set: Partial<DeliveryRow>, now: Date) {
  await db
    .update(notificationDeliveries)
    .set({ ...set, version: sql`${notificationDeliveries.version} + 1`, updatedAt: now })
    .where(eq(notificationDeliveries.id, row.id));
}
async function summaryBody(row: DeliveryRow, today: string) {
  if (!row.ledgerId) return '';
  const owner = { userId: row.userId, requestId: 'worker' };
  if (row.eventType === 'daily_entry') {
    const s = await reportSummary(owner, row.ledgerId, { dateFrom: today, dateTo: addDays(today, 1) });
    return `今天已记录支出 ${s.currency} ${s.expense}、收入 ${s.income}。还有没记的吗？`;
  }
  const monthly = row.eventType === 'monthly_summary';
  const end = monthly
    ? `${today.slice(0, 7)}-01`
    : addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const start = monthly ? `${addDays(end, -1).slice(0, 7)}-01` : addDays(end, -7);
  const s = await reportSummary(owner, row.ledgerId, { dateFrom: start, dateTo: end });
  return `${start} 至 ${addDays(end, -1)}：支出 ${s.currency} ${s.expense}（退款 ${s.refunds}）、收入 ${s.income}、结余 ${s.net}。`;
}
/** In-app inbox: a notification row per delivery (dedupe key shared with the delivery). */
async function writeInbox(
  db: Executor | Tx,
  row: DeliveryRow,
  message: { title: string; body: string; link: string | null },
  now: Date,
) {
  if (!row.ledgerId) return;
  await db
    .insert(notifications)
    .values({
      id: randomUUID(),
      ledgerId: row.ledgerId,
      userId: row.userId,
      eventType: row.eventType,
      title: message.title.slice(0, 200),
      body: message.body.slice(0, 1000),
      link: message.link,
      deliveryId: row.id,
      dedupeKey: row.dedupeKey,
      createdAt: now,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
}
/** Final failure: tell the user in-app (unless that was the failing channel) and through delivery_failed rules. */
async function reportFailure(row: DeliveryRow, reason: string, now: Date) {
  if (!row.ledgerId || row.eventType === 'delivery_failed' || row.eventType === 'test') return;
  const title = (row.payload as { title: string }).title;
  if (row.channelType !== 'in_app') {
    await writeInbox(
      database(),
      { ...row, dedupeKey: `failed/${row.id}/${row.round}`, eventType: 'delivery_failed' },
      {
        title: `提醒未能送达（${row.channelType}）：${title}`,
        body: `原因：${reason}。可在提醒中心重试。`,
        link: null,
      },
      now,
    );
  }
  await deliveryFailedAlerts(
    {
      id: row.id,
      ledgerId: row.ledgerId,
      userId: row.userId,
      channelId: row.channelId,
      round: row.round,
      title,
      reason,
    },
    now,
  );
}

/**
 * Sends one claimed delivery. Re-checks everything that may have changed since planning, records the attempt before
 * the request leaves (the unique attempt key stops a second worker), then applies the classified outcome.
 */
export async function deliver(id: string, now = () => new Date()) {
  const db = database();
  const [row] = await db.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, id));
  if (!row || row.status !== 'sending') return 'skipped';
  const at = now();
  const [channel] = await db.select().from(notificationChannels).where(eq(notificationChannels.id, row.channelId));
  const stop = (status: 'cancelled' | 'expired', reason: string) =>
    finish(db, row, { status, reason, attempts: Math.max(0, row.attempts - 1) }, at).then(() => status);
  if (!channel || channel.deletedAt) return stop('cancelled', '渠道已删除');
  if (!channel.enabled || channel.status === 'disabled') return stop('cancelled', '渠道已停用');
  if (channel.status === 'verifying' && row.eventType !== 'test') return stop('cancelled', '渠道尚未验证');
  const invalid = await stillValid(db, row);
  if (invalid) return stop('cancelled', invalid);
  if (row.expiresAt <= at) return stop('expired', '发送前已超过提醒有效期');
  if (row.ruleId) {
    // A retry may land inside quiet hours: wait for the window to end, unless that is past the expiry.
    const [rule] = await db.select().from(reminderRules).where(eq(reminderRules.id, row.ruleId));
    if (rule && quietNow(rule, at)) {
      const moved = deferQuietHours(localDate(at, rule.timezone), localTimeOf(at, rule.timezone), quietOf(rule));
      const until = zonedInstant(moved.date, moved.time, rule.timezone);
      if (until >= row.expiresAt) return stop('expired', '免打扰结束时已超过提醒有效期');
      await finish(
        db,
        row,
        { status: 'queued', nextAttemptAt: until, deferredByQuietHours: true, attempts: Math.max(0, row.attempts - 1) },
        at,
      );
      return 'deferred';
    }
  }
  const [ledger] = row.ledgerId
    ? await db.select({ timezone: ledgers.timezone }).from(ledgers).where(eq(ledgers.id, row.ledgerId))
    : [{ timezone: 'UTC' }];
  const today = localDate(at, ledger?.timezone ?? 'UTC');
  const message = render(
    row,
    today,
    row.eventType.endsWith('_summary') || row.eventType === 'daily_entry'
      ? { body: await summaryBody(row, today) }
      : {},
  );
  const attemptId = randomUUID();
  try {
    await db
      .insert(notificationAttempts)
      .values({ id: attemptId, deliveryId: row.id, round: row.round, attemptNo: row.attempts, startedAt: at });
  } catch {
    return 'skipped';
  } // another worker already holds this attempt

  let result: SendResult;
  if (row.channelType === 'in_app') {
    await writeInbox(db, row, message, at);
    result = { outcome: 'delivered', responseClass: 'ok' };
  } else {
    let config;
    try {
      config = channelConfig(channel);
    } catch {
      config = null;
    }
    result =
      config && config.type !== 'in_app'
        ? await sendMessage(
            config,
            {
              eventId: row.eventId,
              eventType: row.eventType,
              title: message.title,
              body: message.body,
              link: message.link,
              createdAt: row.createdAt.toISOString(),
            },
            Number(process.env.CHANNEL_TIMEOUT_MS || 10_000),
          )
        : { outcome: 'failed', responseClass: 'credential_error', error: '渠道配置无法解密（加密密钥缺失或已轮换）' };
  }
  const done = now();
  await db
    .update(notificationAttempts)
    .set({
      finishedAt: done,
      outcome: result.outcome,
      responseClass: result.responseClass,
      httpStatus: result.httpStatus ?? null,
      providerMessageId: result.providerMessageId ?? null,
      error: result.error ?? null,
    })
    .where(eq(notificationAttempts.id, attemptId));
  return apply(row, channel, result, done);
}

async function apply(
  row: DeliveryRow,
  channel: typeof notificationChannels.$inferSelect,
  result: SendResult,
  at: Date,
) {
  const db = database();
  const common = {
    lastAttemptAt: at,
    responseClass: result.responseClass,
    lastError: result.error ?? null,
    providerMessageId: result.providerMessageId ?? null,
    claimedAt: null,
  };
  if (result.outcome === 'accepted' || result.outcome === 'delivered') {
    await finish(db, row, { ...common, status: result.outcome, lastError: null }, at);
    await db
      .update(notificationChannels)
      .set({
        consecutiveFailures: 0,
        lastError: null,
        ...(channel.status !== 'active' &&
        ((row.eventType === 'test' && channel.type !== 'email') || channel.status === 'degraded')
          ? { status: 'active' as const, lastVerifiedAt: at }
          : {}),
        updatedAt: at,
      })
      .where(eq(notificationChannels.id, channel.id));
    return result.outcome;
  }
  if (result.outcome === 'retry') {
    if (row.attempts >= MAX_ATTEMPTS) {
      await finish(
        db,
        row,
        { ...common, status: 'failed', deadLetter: true, reason: `自动重试 ${MAX_ATTEMPTS} 次仍失败` },
        at,
      );
      await degrade(channel, result, at);
      await reportFailure(row, result.error ?? '多次重试失败', at);
      return 'dead_letter';
    }
    const next = new Date(at.getTime() + backoffMs(row.attempts, result.retryAfterMs));
    if (next >= row.expiresAt) {
      await finish(db, row, { ...common, status: 'expired', reason: '下次重试已超过提醒有效期' }, at);
      await reportFailure(row, result.error ?? '重试超时', at);
      return 'expired';
    }
    await finish(db, row, { ...common, status: 'queued', nextAttemptAt: next }, at);
    await degrade(channel, result, at);
    return 'retry';
  }
  if (result.outcome === 'unknown') {
    await finish(
      db,
      row,
      {
        ...common,
        status: 'delivery_unknown',
        reason: '请求已发出但没有收到应答：平台可能已受理。为避免重复不自动重发，可在提醒中心人工重放。',
      },
      at,
    );
    return 'unknown';
  }
  await finish(
    db,
    row,
    {
      ...common,
      status: 'failed',
      deadLetter: true,
      reason: result.responseClass === 'credential_error' ? '凭据无效或接收方拒绝，渠道已暂停' : '平台拒绝了这条消息',
    },
    at,
  );
  if (result.responseClass === 'credential_error') {
    await db
      .update(notificationChannels)
      .set({
        status: 'disabled',
        lastError: result.error ?? '凭据无效',
        updatedAt: at,
        version: sql`${notificationChannels.version} + 1`,
      })
      .where(eq(notificationChannels.id, channel.id));
    await db
      .update(notificationDeliveries)
      .set({ status: 'cancelled', reason: '渠道凭据失效，已暂停', updatedAt: at })
      .where(and(eq(notificationDeliveries.channelId, channel.id), eq(notificationDeliveries.status, 'queued')));
  }
  await reportFailure(row, result.error ?? '发送失败', at);
  return 'failed';
}
async function degrade(channel: typeof notificationChannels.$inferSelect, result: SendResult, at: Date) {
  const failures = channel.consecutiveFailures + 1;
  await database()
    .update(notificationChannels)
    .set({
      consecutiveFailures: failures,
      lastError: result.error ?? null,
      ...(failures >= CHANNEL_DEGRADE_AFTER && channel.status === 'active' ? { status: 'degraded' as const } : {}),
      updatedAt: at,
    })
    .where(eq(notificationChannels.id, channel.id));
}

/**
 * Recovery after a crash or a lost queue job: a delivery stuck in "sending" whose attempt never started goes back to
 * the queue (nothing was sent); one whose attempt started but never finished becomes delivery_unknown.
 */
export async function sweepStuck(now = new Date()) {
  const db = database();
  const cutoff = new Date(now.getTime() - stuckMs());
  const rows = await db
    .select()
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.status, 'sending'),
        or(isNull(notificationDeliveries.claimedAt), lt(notificationDeliveries.claimedAt, cutoff)),
      ),
    )
    .limit(200);
  let requeued = 0;
  let unknown = 0;
  for (const row of rows) {
    const [attempt] = await db
      .select()
      .from(notificationAttempts)
      .where(
        and(
          eq(notificationAttempts.deliveryId, row.id),
          eq(notificationAttempts.round, row.round),
          eq(notificationAttempts.attemptNo, row.attempts),
        ),
      );
    if (!attempt) {
      await finish(
        db,
        row,
        { status: 'queued', attempts: Math.max(0, row.attempts - 1), claimedAt: null, nextAttemptAt: now },
        now,
      );
      requeued++;
    } else if (!attempt.finishedAt) {
      await db
        .update(notificationAttempts)
        .set({
          finishedAt: now,
          outcome: 'unknown',
          responseClass: 'timeout',
          error: 'worker stopped during the request',
        })
        .where(eq(notificationAttempts.id, attempt.id));
      await finish(
        db,
        row,
        {
          status: 'delivery_unknown',
          claimedAt: null,
          responseClass: 'timeout',
          reason: 'Worker 在发送过程中停止：平台可能已受理，未自动重发。',
        },
        now,
      );
      unknown++;
    }
  }
  return { requeued, unknown };
}

// ---------- API ----------

async function ownDelivery(ctx: AuthContext, ledgerId: string, id: string) {
  const [row] = await database()
    .select()
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.id, id),
        eq(notificationDeliveries.ledgerId, ledgerId),
        eq(notificationDeliveries.userId, ctx.userId),
      ),
    );
  if (!row) throw new DomainError(404, 'NOT_FOUND', '投递不存在或你没有访问权限');
  return row;
}
export async function listDeliveries(ctx: AuthContext, ledgerId: string, query: unknown, page: Keyset) {
  const q = DeliveryQuery.partial().parse(query);
  const ledger = await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const after =
    page.after &&
    or(
      lt(notificationDeliveries.createdAt, new Date(page.after[0])),
      and(eq(notificationDeliveries.createdAt, new Date(page.after[0])), lt(notificationDeliveries.id, page.after[1])),
    );
  return database()
    .select()
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.ledgerId, ledgerId),
        eq(notificationDeliveries.userId, ctx.userId),
        q.status ? eq(notificationDeliveries.status, q.status) : undefined,
        q.channelId ? eq(notificationDeliveries.channelId, q.channelId) : undefined,
        q.dateFrom
          ? gte(notificationDeliveries.scheduledAt, zonedInstant(q.dateFrom, '00:00', ledger.timezone))
          : undefined,
        q.dateTo ? lt(notificationDeliveries.scheduledAt, zonedInstant(q.dateTo, '00:00', ledger.timezone)) : undefined,
        after,
      ),
    )
    .orderBy(desc(notificationDeliveries.createdAt), desc(notificationDeliveries.id))
    .limit(page.limit + 1);
}
export async function getDelivery(ctx: AuthContext, ledgerId: string, id: string) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  return presentDelivery(await ownDelivery(ctx, ledgerId, id));
}
/** Manual replay of a failed / unknown / expired delivery: a new round with fresh attempts and a one-hour window. */
export async function retryDelivery(ctx: AuthContext, ledgerId: string, id: string, now = new Date()) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const row = await ownDelivery(ctx, ledgerId, id);
  if (!['failed', 'delivery_unknown', 'expired'].includes(row.status)) {
    throw new DomainError(409, 'DELIVERY_NOT_RETRYABLE', '只有失败、未知或过期的投递可以重放');
  }
  const invalid = await stillValid(database(), row);
  if (invalid) throw new DomainError(409, 'DELIVERY_NOT_RETRYABLE', `提醒已不再适用：${invalid}`);
  const expiresAt = new Date(Math.max(row.expiresAt.getTime(), now.getTime() + 3600_000));
  const [result] = await database()
    .update(notificationDeliveries)
    .set({
      status: 'queued',
      round: row.round + 1,
      attempts: 0,
      nextAttemptAt: now,
      expiresAt,
      deadLetter: false,
      reason: `人工重放（第 ${row.round + 1} 轮）`,
      version: row.version + 1,
      updatedAt: now,
    })
    .where(and(eq(notificationDeliveries.id, id), eq(notificationDeliveries.version, row.version)));
  if (!(result as { affectedRows: number }).affectedRows) {
    throw new DomainError(409, 'DELIVERY_NOT_RETRYABLE', '投递状态已变化，请刷新');
  }
  return presentDelivery({
    ...row,
    status: 'queued',
    round: row.round + 1,
    attempts: 0,
    nextAttemptAt: now,
    expiresAt,
    deadLetter: false,
    reason: `人工重放（第 ${row.round + 1} 轮）`,
    version: row.version + 1,
    updatedAt: now,
  });
}
const percentile = (values: number[], p: number) =>
  values.length ? values[Math.min(values.length - 1, Math.ceil((p / 100) * values.length) - 1)] : null;
/** Last 7 days of the caller's deliveries in this ledger: states, dead letters, unknown, and dispatch delay. */
export async function deliveryStats(ctx: AuthContext, ledgerId: string, now = new Date()) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const since = new Date(now.getTime() - 7 * 86400_000);
  const db = database();
  const scope = and(
    eq(notificationDeliveries.ledgerId, ledgerId),
    eq(notificationDeliveries.userId, ctx.userId),
    gte(notificationDeliveries.createdAt, since),
  );
  const counts = await db
    .select({ status: notificationDeliveries.status, n: sql<number>`COUNT(*)` })
    .from(notificationDeliveries)
    .where(scope)
    .groupBy(notificationDeliveries.status);
  const [dead] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(notificationDeliveries)
    .where(and(scope, eq(notificationDeliveries.deadLetter, true)));
  // Delay of the first attempt of each round: scheduled (or retry) time to the moment the worker started sending.
  const delays = (
    await db
      .select({
        ms: sql<number>`TIMESTAMPDIFF(MICROSECOND, ${notificationDeliveries.scheduledAt}, ${notificationAttempts.startedAt}) / 1000`,
      })
      .from(notificationAttempts)
      .innerJoin(notificationDeliveries, eq(notificationDeliveries.id, notificationAttempts.deliveryId))
      .where(
        and(
          scope,
          eq(notificationAttempts.attemptNo, 1),
          eq(notificationAttempts.round, 1),
          isNotNull(notificationAttempts.startedAt),
        ),
      )
  )
    .map(r => Math.max(0, Number(r.ms)))
    .sort((a, b) => a - b);
  return {
    since: since.toISOString(),
    byStatus: Object.fromEntries(counts.map(c => [c.status, Number(c.n)])),
    deadLetters: Number(dead?.n ?? 0),
    unknown: Number(counts.find(c => c.status === 'delivery_unknown')?.n ?? 0),
    dispatchDelayMs: { p50: percentile(delays, 50), p95: percentile(delays, 95), samples: delays.length },
  };
}

// In-app notifications (the fallback channel).
type NotificationRow = typeof notifications.$inferSelect;
export const presentNotification = (row: NotificationRow) => ({
  id: row.id,
  eventType: row.eventType as never,
  title: row.title,
  body: row.body,
  link: row.link,
  readAt: row.readAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  version: row.version,
});
export async function listNotifications(ctx: AuthContext, ledgerId: string, query: unknown, page: Keyset) {
  // The router has already parsed the query (unreadOnly is a boolean then); direct callers may pass the raw string.
  const raw = (query ?? {}) as { unreadOnly?: unknown };
  const q = {
    unreadOnly:
      typeof raw.unreadOnly === 'boolean'
        ? raw.unreadOnly
        : NotificationQuery.partial().parse({ unreadOnly: raw.unreadOnly }).unreadOnly,
  };
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const after =
    page.after &&
    or(
      lt(notifications.createdAt, new Date(page.after[0])),
      and(eq(notifications.createdAt, new Date(page.after[0])), lt(notifications.id, page.after[1])),
    );
  return database()
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.ledgerId, ledgerId),
        eq(notifications.userId, ctx.userId),
        q.unreadOnly ? isNull(notifications.readAt) : undefined,
        after,
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(page.limit + 1);
}
export async function unreadCount(ctx: AuthContext, ledgerId: string) {
  const [row] = await database()
    .select({ n: sql<number>`COUNT(*)` })
    .from(notifications)
    .where(
      and(eq(notifications.ledgerId, ledgerId), eq(notifications.userId, ctx.userId), isNull(notifications.readAt)),
    );
  return Number(row?.n ?? 0);
}
async function ownNotification(ctx: AuthContext, ledgerId: string, id: string) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const [row] = await database()
    .select()
    .from(notifications)
    .where(and(eq(notifications.ledgerId, ledgerId), eq(notifications.id, id), eq(notifications.userId, ctx.userId)));
  if (!row) throw new DomainError(404, 'NOT_FOUND', '通知不存在或你没有访问权限');
  return row;
}
export const getNotification = (ctx: AuthContext, ledgerId: string, id: string) => ownNotification(ctx, ledgerId, id);
export async function updateNotification(
  ctx: AuthContext,
  ledgerId: string,
  id: string,
  body: unknown,
  etag: string | null,
  now = new Date(),
) {
  const { read } = NotificationUpdate.parse(body);
  const row = await ownNotification(ctx, ledgerId, id);
  requireVersion(etag, row.version);
  const next = { readAt: read ? (row.readAt ?? now) : null, version: row.version + 1 };
  await database().update(notifications).set(next).where(eq(notifications.id, id));
  return { ...row, ...next };
}
export async function markAllRead(ctx: AuthContext, ledgerId: string, now = new Date()) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  await database()
    .update(notifications)
    .set({ readAt: now, version: sql`${notifications.version} + 1` })
    .where(
      and(eq(notifications.ledgerId, ledgerId), eq(notifications.userId, ctx.userId), isNull(notifications.readAt)),
    );
}
