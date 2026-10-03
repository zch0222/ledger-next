import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, ne, notInArray, or } from 'drizzle-orm';
import { PreviewSubmit } from '@ledger/contracts/finance';
import { ReminderPreviewCreate, ReminderRuleUpdate } from '@ledger/contracts/platform';
import { database, type Executor, type Tx } from '@ledger/db/index';
import {
  billOccurrences,
  budgets,
  notificationChannels,
  notificationDeliveries,
  reminderPreviews,
  reminderRules,
  subscriptions,
} from '@ledger/db/schema';
import { ledgerAccess } from './access';
import { audit } from './audit';
import { addDays, localDate } from './dates';
import { getExchangeRates } from './fx';
import type { AuthContext, Keyset } from './identity';
import { formatAmount, sum } from './money';
import { cancelQueued, insertDelivery, type DeliveryPayload } from './notify-store';
import { DomainError, requireVersion } from './policy';
import {
  afterDue,
  beforeEvent,
  endOfDay,
  fxDecision,
  inQuietHours,
  localTimeOf,
  periodic,
  slot,
  type FxState,
  type QuietHours,
} from './reminder-schedule';
import { budgetProgress } from './reports';

// P07 提醒: rules belong to their owner in one ledger and send to the owner's own channels. Dated reminders are planned
// ahead into the delivery log (48 h horizon, unique dedupe keys); budget and FX thresholds fire on events.
export type RuleRow = typeof reminderRules.$inferSelect;
type Input = ReturnType<typeof ReminderPreviewCreate.parse>;
type Normalized = {
  eventType: RuleRow['eventType'];
  subscriptionId: string | null;
  budgetId: string | null;
  leadDays: number[];
  localTime: string;
  timezone: string;
  quietHours: { start: string; end: string } | null;
  channelIds: string[];
  fx: { base: string; quote: string; above: string | null; below: string | null } | null;
};
type Fire = {
  eventId: string;
  subjectId: string | null;
  scheduledAt: Date;
  expiresAt: Date;
  deferredByQuietHours: boolean;
  payload: DeliveryPayload;
};

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const HORIZON_MS = 48 * 3600 * 1000;
const REPLAN_BEFORE_MS = 24 * 3600 * 1000;
export const TEMPLATE_VERSION = 1;
const DATED = new Set(['bill_due', 'trial_end', 'cancel_deadline']);
const SUBSCRIPTION_EVENTS = new Set(['bill_due', 'trial_end', 'cancel_deadline', 'overdue']);
export const EVENT_DRIVEN = new Set(['budget_threshold', 'fx_threshold', 'delivery_failed']);
const DEFAULT_LEADS: Record<string, number[]> = { bill_due: [3, 0], trial_end: [3, 1], cancel_deadline: [3, 1] };
const invalid = (path: string, message: string) =>
  new DomainError(422, 'VALIDATION_ERROR', '请检查输入字段', {}, [{ path, message }]);
const notFound = () => new DomainError(404, 'NOT_FOUND', '提醒规则不存在或你没有访问权限');
const quietOf = (rule: { quietStart: string | null; quietEnd: string | null }): QuietHours =>
  rule.quietStart && rule.quietEnd ? { start: rule.quietStart, end: rule.quietEnd } : null;
const appUrl = () => (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

function normalize(input: Input): Normalized {
  const fx = input.fx
    ? { base: input.fx.base, quote: input.fx.quote, above: input.fx.above ?? null, below: input.fx.below ?? null }
    : null;
  return {
    eventType: input.eventType,
    subscriptionId: input.subscriptionId ?? null,
    budgetId: input.budgetId ?? null,
    leadDays: DATED.has(input.eventType)
      ? [...new Set(input.leadDays ?? DEFAULT_LEADS[input.eventType])].sort((a, b) => b - a)
      : [],
    localTime: input.localTime,
    timezone: input.timezone,
    quietHours: input.quietHours ?? null,
    channelIds: [...new Set(input.channelIds)],
    fx,
  };
}
async function validate(db: Executor | Tx, ctx: AuthContext, ledgerId: string, n: Normalized) {
  if (n.subscriptionId && !SUBSCRIPTION_EVENTS.has(n.eventType)) {
    throw invalid('subscriptionId', '只有账单、逾期、试用与取消截止提醒可以指定订阅');
  }
  if (n.budgetId && n.eventType !== 'budget_threshold') throw invalid('budgetId', '只有预算阈值提醒可以指定预算');
  if (n.subscriptionId) {
    const [sub] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(and(eq(subscriptions.ledgerId, ledgerId), eq(subscriptions.id, n.subscriptionId)));
    if (!sub) throw invalid('subscriptionId', '订阅不存在');
  }
  if (n.budgetId) {
    const [budget] = await db
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(eq(budgets.ledgerId, ledgerId), eq(budgets.id, n.budgetId), isNull(budgets.archivedAt)));
    if (!budget) throw invalid('budgetId', '预算不存在或已归档');
  }
  if (n.eventType === 'fx_threshold') {
    if (!n.fx || (!n.fx.above && !n.fx.below)) throw invalid('fx', '汇率阈值提醒需要币种对与上限或下限');
    if (n.fx.base === n.fx.quote) throw invalid('fx.quote', '两个币种不能相同');
    if (n.fx.above && n.fx.below && sum([n.fx.below]).greaterThanOrEqualTo(n.fx.above)) {
      throw invalid('fx.below', '下限须低于上限');
    }
  } else if (n.fx) throw invalid('fx', '只有汇率阈值提醒可以设置币种对');
  const channels = await db
    .select()
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.userId, ctx.userId),
        inArray(notificationChannels.id, n.channelIds),
        isNull(notificationChannels.deletedAt),
      ),
    );
  if (channels.length !== n.channelIds.length) throw invalid('channelIds', '只能选择你自己的、未删除的渠道');
  return channels;
}

// ---------- planning ----------

const ruleShape = (rule: RuleRow): Normalized => ({
  eventType: rule.eventType,
  subscriptionId: rule.subscriptionId,
  budgetId: rule.budgetId,
  leadDays: rule.leadDays as number[],
  localTime: rule.localTime,
  timezone: rule.timezone,
  quietHours: quietOf(rule),
  channelIds: rule.channelIds as string[],
  fx:
    rule.fxBase && rule.fxQuote
      ? {
          base: rule.fxBase,
          quote: rule.fxQuote,
          above: rule.fxAbove && sum([rule.fxAbove]).toFixed(),
          below: rule.fxBelow && sum([rule.fxBelow]).toFixed(),
        }
      : null,
});

/** Fire times of a dated / periodic rule whose slot lies in [from, to). Event-driven rules have none. */
export async function firesBetween(
  db: Executor | Tx,
  ledgerId: string,
  rule: Normalized,
  from: Date,
  to: Date,
): Promise<Fire[]> {
  const { timezone: tz, localTime: time, quietHours: quiet } = rule;
  const fromDate = addDays(localDate(from, tz), -1);
  const toDate = addDays(localDate(to, tz), 1);
  const out: Fire[] = [];
  const maxLead = Math.max(0, ...rule.leadDays);
  if (rule.eventType === 'bill_due' || rule.eventType === 'overdue') {
    const [lo, hi] =
      rule.eventType === 'bill_due' ? [fromDate, addDays(toDate, maxLead)] : [addDays(fromDate, -1), toDate];
    const rows = await db
      .select({ o: billOccurrences, name: subscriptions.name, subStatus: subscriptions.status })
      .from(billOccurrences)
      .innerJoin(
        subscriptions,
        and(eq(subscriptions.ledgerId, billOccurrences.ledgerId), eq(subscriptions.id, billOccurrences.subscriptionId)),
      )
      .where(
        and(
          eq(billOccurrences.ledgerId, ledgerId),
          rule.subscriptionId ? eq(billOccurrences.subscriptionId, rule.subscriptionId) : undefined,
          inArray(billOccurrences.status, ['scheduled', 'due', 'overdue']),
          gte(billOccurrences.scheduledDate, lo),
          lte(billOccurrences.scheduledDate, hi),
          eq(subscriptions.status, 'active'),
        ),
      );
    for (const { o, name } of rows) {
      const refs = {
        occurrenceId: o.id,
        subscriptionId: o.subscriptionId,
        name,
        date: o.scheduledDate,
        amount: formatAmount(o.amount, o.currency),
        currency: o.currency,
        scheduleVersion: o.scheduleVersion,
      };
      if (rule.eventType === 'bill_due') {
        for (const f of beforeEvent(o.scheduledDate, rule.leadDays, time, tz, quiet)) {
          out.push({
            eventId: `bill_due:${o.id}:${f.lead}`,
            subjectId: o.id,
            scheduledAt: f.scheduledAt,
            expiresAt: f.expiresAt,
            deferredByQuietHours: f.deferredByQuietHours,
            payload: { title: name, kind: 'bill_due', refs: { ...refs, lead: f.lead } },
          });
        }
      } else {
        const f = afterDue(o.scheduledDate, time, tz, quiet);
        out.push({
          eventId: `overdue:${o.id}`,
          subjectId: o.id,
          ...f,
          payload: { title: name, kind: 'overdue', refs },
        });
      }
    }
  } else if (rule.eventType === 'trial_end' || rule.eventType === 'cancel_deadline') {
    const column = rule.eventType === 'trial_end' ? subscriptions.trialEndsOn : subscriptions.cancelBy;
    const rows = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.ledgerId, ledgerId),
          rule.subscriptionId ? eq(subscriptions.id, rule.subscriptionId) : undefined,
          ne(subscriptions.status, 'cancelled'),
          gte(column, fromDate),
          lte(column, addDays(toDate, maxLead)),
        ),
      );
    for (const s of rows) {
      const date = (rule.eventType === 'trial_end' ? s.trialEndsOn : s.cancelBy)!;
      for (const f of beforeEvent(date, rule.leadDays, time, tz, quiet)) {
        out.push({
          eventId: `${rule.eventType}:${s.id}:${date}:${f.lead}`,
          subjectId: s.id,
          scheduledAt: f.scheduledAt,
          expiresAt: f.expiresAt,
          deferredByQuietHours: f.deferredByQuietHours,
          payload: {
            title: s.name,
            kind: rule.eventType,
            refs: { subscriptionId: s.id, name: s.name, date, lead: f.lead },
          },
        });
      }
    }
  } else if (
    rule.eventType === 'daily_entry' ||
    rule.eventType === 'weekly_summary' ||
    rule.eventType === 'monthly_summary'
  ) {
    const kind =
      rule.eventType === 'daily_entry' ? 'daily' : rule.eventType === 'weekly_summary' ? 'weekly' : 'monthly';
    for (const f of periodic(kind, fromDate, kind === 'daily' ? 5 : 2, time, tz, quiet)) {
      out.push({
        eventId: `${rule.eventType}:${ledgerId}:${f.localDate}`,
        subjectId: null,
        ...f,
        payload: { title: rule.eventType, kind: rule.eventType, refs: { date: f.localDate } },
      });
    }
  }
  return out.filter(f => f.scheduledAt >= from && f.scheduledAt < to);
}

const dedupeKey = (
  rule: Pick<RuleRow, 'ledgerId' | 'id' | 'version' | 'ownerId' | 'templateVersion'>,
  eventId: string,
  channelId: string,
) => `${rule.ledgerId}/${eventId}/${rule.id}/v${rule.version}/${channelId}/${rule.ownerId}/t${rule.templateVersion}`;

/**
 * Writes the deliveries of one fire for every channel of the rule. A fire already delivered (or in flight) under an
 * older rule version is not repeated; the unique dedupe key makes concurrent planners harmless.
 */
async function writeFire(
  db: Executor | Tx,
  rule: RuleRow,
  fire: Fire,
  channels: { id: string; type: string }[],
  now: Date,
) {
  let created = 0;
  for (const channel of channels) {
    const [earlier] = await db
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.ruleId, rule.id),
          eq(notificationDeliveries.eventId, fire.eventId),
          eq(notificationDeliveries.channelId, channel.id),
          ne(notificationDeliveries.status, 'cancelled'),
        ),
      )
      .limit(1);
    if (earlier) continue;
    const result = await insertDelivery(
      db,
      {
        ledgerId: rule.ledgerId,
        userId: rule.ownerId,
        channelId: channel.id,
        channelType: channel.type as never,
        ruleId: rule.id,
        ruleVersion: rule.version,
        eventType: rule.eventType,
        eventId: fire.eventId,
        subjectId: fire.subjectId,
        dedupeKey: dedupeKey(rule, fire.eventId, channel.id),
        templateVersion: rule.templateVersion,
        scheduledAt: fire.scheduledAt,
        expiresAt: fire.expiresAt,
        deferredByQuietHours: fire.deferredByQuietHours,
        payload: fire.payload,
      },
      now,
    );
    if (result.created) created++;
  }
  return created;
}
async function ruleChannels(db: Executor | Tx, rule: RuleRow) {
  const ids = rule.channelIds as string[];
  return ids.length
    ? db
        .select({ id: notificationChannels.id, type: notificationChannels.type })
        .from(notificationChannels)
        .where(
          and(
            inArray(notificationChannels.id, ids),
            eq(notificationChannels.userId, rule.ownerId),
            isNull(notificationChannels.deletedAt),
          ),
        )
    : [];
}

/**
 * Plans one rule through the horizon. Slots before the rule existed are never replayed; slots of subjects created
 * later (a bill added today) are still sent while valid. Expired slots are skipped, never sent late.
 */
export async function planRule(db: Executor | Tx, rule: RuleRow, now = new Date()) {
  if (!rule.enabled || rule.deletedAt || EVENT_DRIVEN.has(rule.eventType)) return 0;
  const horizon = new Date(now.getTime() + HORIZON_MS);
  const fires = (await firesBetween(db, rule.ledgerId, ruleShape(rule), rule.createdAt, horizon)).filter(
    f => f.expiresAt > now,
  );
  const channels = await ruleChannels(db, rule);
  let created = 0;
  for (const fire of fires) created += await writeFire(db, rule, fire, channels, now);
  await db.update(reminderRules).set({ plannedThrough: horizon }).where(eq(reminderRules.id, rule.id));
  return created;
}
/** Worker tick: rules whose planned horizon is less than a day ahead. */
export async function planDueRules(now = new Date(), limit = 200) {
  const rows = await database()
    .select()
    .from(reminderRules)
    .where(
      and(
        eq(reminderRules.enabled, true),
        isNull(reminderRules.deletedAt),
        notInArray(reminderRules.eventType, [...EVENT_DRIVEN] as RuleRow['eventType'][]),
        or(
          isNull(reminderRules.plannedThrough),
          lt(reminderRules.plannedThrough, new Date(now.getTime() + REPLAN_BEFORE_MS)),
        ),
      ),
    )
    .orderBy(asc(reminderRules.plannedThrough))
    .limit(limit);
  let created = 0;
  for (const rule of rows) created += await planRule(database(), rule, now);
  return { rules: rows.length, created };
}
/** After subscription / bill changes (outbox): re-plan the ledger's dated rules so new bills get their reminders. */
export async function planLedger(ledgerId: string, now = new Date()) {
  const rows = await database()
    .select()
    .from(reminderRules)
    .where(
      and(
        eq(reminderRules.ledgerId, ledgerId),
        eq(reminderRules.enabled, true),
        isNull(reminderRules.deletedAt),
        notInArray(reminderRules.eventType, [...EVENT_DRIVEN] as RuleRow['eventType'][]),
      ),
    );
  let created = 0;
  for (const rule of rows) created += await planRule(database(), rule, now);
  return created;
}

// ---------- previews and rules ----------

export async function createReminderPreview(ctx: AuthContext, ledgerId: string, body: unknown, now = new Date()) {
  const n = normalize(ReminderPreviewCreate.parse(body));
  const db = database();
  await ledgerAccess(db, ctx, ledgerId, 'editor');
  const channels = await validate(db, ctx, ledgerId, n);
  const warnings: { code: string; message: string }[] = [];
  for (const c of channels) {
    if (c.status !== 'active' && c.status !== 'degraded') {
      warnings.push({ code: 'CHANNEL_NOT_READY', message: `渠道「${c.name}」尚未验证或已停用，规则不会通过它发送` });
    }
  }
  let nextFireTimes: { scheduledAt: string; localDate: string; localTime: string; deferredByQuietHours: boolean }[] =
    [];
  if (EVENT_DRIVEN.has(n.eventType)) {
    warnings.push({
      code: 'EVENT_DRIVEN',
      message:
        n.eventType === 'budget_threshold'
          ? '达到预算阈值时立即提醒（免打扰时段顺延）'
          : n.eventType === 'fx_threshold'
            ? '汇率越过阈值时提醒，6 小时内不重复'
            : '投递失败时提醒',
    });
  } else {
    const fires = (await firesBetween(db, ledgerId, n, now, new Date(now.getTime() + 62 * 86400_000)))
      .filter(f => f.expiresAt > now)
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
    nextFireTimes = fires.slice(0, 3).map(f => ({
      scheduledAt: f.scheduledAt.toISOString(),
      localDate: localDate(f.scheduledAt, n.timezone),
      localTime: localTimeOf(f.scheduledAt, n.timezone),
      deferredByQuietHours: f.deferredByQuietHours,
    }));
    if (!fires.length) {
      warnings.push({
        code: 'NOTHING_SCHEDULED',
        message: SUBSCRIPTION_EVENTS.has(n.eventType) ? '未来 60 天没有匹配的账单或日期' : '未来 60 天没有发送时间',
      });
    }
    if (fires.some(f => f.deferredByQuietHours)) {
      warnings.push({ code: 'QUIET_HOURS', message: '部分提醒落在免打扰时段，将在结束时发送' });
    }
  }
  const id = randomUUID();
  const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS);
  await db
    .insert(reminderPreviews)
    .values({ id, ledgerId, actorId: ctx.userId, normalizedInput: n, expiresAt, createdAt: now });
  return { previewId: id, expiresAt: expiresAt.toISOString(), nextFireTimes, warnings };
}

async function nextTimes(db: Executor | Tx, rule: RuleRow) {
  const rows = await db
    .selectDistinct({ at: notificationDeliveries.scheduledAt })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.ruleId, rule.id),
        eq(notificationDeliveries.ruleVersion, rule.version),
        eq(notificationDeliveries.status, 'queued'),
      ),
    )
    .orderBy(asc(notificationDeliveries.scheduledAt))
    .limit(3);
  return rows.map(r => r.at.toISOString());
}
export async function presentRule(db: Executor | Tx, rule: RuleRow) {
  const shape = ruleShape(rule);
  return {
    id: rule.id,
    eventType: rule.eventType,
    subscriptionId: rule.subscriptionId,
    budgetId: rule.budgetId,
    leadDays: shape.leadDays,
    localTime: rule.localTime,
    timezone: rule.timezone,
    quietHours: shape.quietHours,
    channelIds: shape.channelIds,
    enabled: rule.enabled,
    templateVersion: rule.templateVersion,
    version: rule.version,
    fx: shape.fx,
    nextFireTimes: await nextTimes(db, rule),
    createdAt: rule.createdAt.toISOString(),
  };
}

export async function createReminderRule(
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
      .from(reminderPreviews)
      .where(
        and(
          eq(reminderPreviews.id, previewId),
          eq(reminderPreviews.ledgerId, ledgerId),
          eq(reminderPreviews.actorId, ctx.userId),
        ),
      )
      .for('update');
    if (!preview) throw new DomainError(422, 'PREVIEW_NOT_FOUND', '预览不存在或不属于当前用户');
    if (preview.consumedAt) throw new DomainError(409, 'PREVIEW_CONSUMED', '该预览已提交');
    if (preview.expiresAt <= now) throw new DomainError(422, 'PREVIEW_EXPIRED', '预览已过期，请重新预览');
    const n = preview.normalizedInput as Normalized;
    try {
      await validate(tx, ctx, ledgerId, n);
    } catch {
      throw new DomainError(409, 'PREVIEW_STALE', '订阅、预算或渠道已变化，请重新预览');
    }
    const rule: RuleRow = {
      id: randomUUID(),
      ledgerId,
      ownerId: ctx.userId,
      eventType: n.eventType,
      subscriptionId: n.subscriptionId,
      budgetId: n.budgetId,
      leadDays: n.leadDays,
      localTime: n.localTime,
      timezone: n.timezone,
      quietStart: n.quietHours?.start ?? null,
      quietEnd: n.quietHours?.end ?? null,
      channelIds: n.channelIds,
      enabled: true,
      templateVersion: TEMPLATE_VERSION,
      includeDetails: false,
      fxBase: n.fx?.base ?? null,
      fxQuote: n.fx?.quote ?? null,
      fxAbove: n.fx?.above ?? null,
      fxBelow: n.fx?.below ?? null,
      fxState: n.fx ? { above: 'armed', below: 'armed', lastFiredAt: null } : null,
      plannedThrough: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await tx.insert(reminderRules).values(rule);
    await tx
      .update(reminderPreviews)
      .set({ consumedAt: now, consumedBy: rule.id })
      .where(eq(reminderPreviews.id, previewId));
    await audit(tx, ctx, ledgerId, 'reminder_rule.created', rule.id);
    await planRule(tx, rule, now);
    return presentRule(tx, rule);
  });
}

async function ownRule(db: Executor | Tx, ctx: AuthContext, ledgerId: string, id: string, lock = false) {
  const query = db
    .select()
    .from(reminderRules)
    .where(
      and(
        eq(reminderRules.ledgerId, ledgerId),
        eq(reminderRules.id, id),
        eq(reminderRules.ownerId, ctx.userId),
        isNull(reminderRules.deletedAt),
      ),
    );
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw notFound();
  return row;
}
export async function listReminderRules(ctx: AuthContext, ledgerId: string, page: Keyset) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const after =
    page.after &&
    or(
      gt(reminderRules.createdAt, new Date(page.after[0])),
      and(eq(reminderRules.createdAt, new Date(page.after[0])), gt(reminderRules.id, page.after[1])),
    );
  return database()
    .select()
    .from(reminderRules)
    .where(
      and(
        eq(reminderRules.ledgerId, ledgerId),
        eq(reminderRules.ownerId, ctx.userId),
        isNull(reminderRules.deletedAt),
        after,
      ),
    )
    .orderBy(asc(reminderRules.createdAt), asc(reminderRules.id))
    .limit(page.limit + 1);
}
export async function getReminderRule(ctx: AuthContext, ledgerId: string, id: string) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  return presentRule(database(), await ownRule(database(), ctx, ledgerId, id));
}

/** Any change is a new rule version: queued deliveries of the old version are cancelled, then the rule is re-planned. */
export async function updateReminderRule(
  ctx: AuthContext,
  ledgerId: string,
  id: string,
  body: unknown,
  etag: string | null,
  now = new Date(),
) {
  const data = ReminderRuleUpdate.parse(body);
  return database().transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const row = await ownRule(tx, ctx, ledgerId, id, true);
    requireVersion(etag, row.version);
    const shape = ruleShape(row);
    const n: Normalized = {
      ...shape,
      leadDays:
        data.leadDays && DATED.has(row.eventType) ? [...new Set(data.leadDays)].sort((a, b) => b - a) : shape.leadDays,
      localTime: data.localTime ?? shape.localTime,
      quietHours: data.quietHours === undefined ? shape.quietHours : data.quietHours,
      channelIds: data.channelIds ? [...new Set(data.channelIds)] : shape.channelIds,
      fx: data.fx
        ? { base: data.fx.base, quote: data.fx.quote, above: data.fx.above ?? null, below: data.fx.below ?? null }
        : shape.fx,
    };
    await validate(tx, ctx, ledgerId, n);
    const next: RuleRow = {
      ...row,
      leadDays: n.leadDays,
      localTime: n.localTime,
      quietStart: n.quietHours?.start ?? null,
      quietEnd: n.quietHours?.end ?? null,
      channelIds: n.channelIds,
      fxBase: n.fx?.base ?? null,
      fxQuote: n.fx?.quote ?? null,
      fxAbove: n.fx?.above ?? null,
      fxBelow: n.fx?.below ?? null,
      fxState: data.fx ? { above: 'armed', below: 'armed', lastFiredAt: null } : row.fxState,
      enabled: data.enabled ?? row.enabled,
      version: row.version + 1,
      plannedThrough: null,
      updatedAt: now,
    };
    await cancelQueued(tx, eq(notificationDeliveries.ruleId, id), next.enabled ? '规则已修改' : '规则已暂停', now);
    await tx.update(reminderRules).set(next).where(eq(reminderRules.id, id));
    await audit(tx, ctx, ledgerId, 'reminder_rule.updated', id);
    await planRule(tx, next, now);
    return presentRule(tx, next);
  });
}
export async function deleteReminderRule(
  ctx: AuthContext,
  ledgerId: string,
  id: string,
  etag: string | null,
  now = new Date(),
) {
  await database().transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const row = await ownRule(tx, ctx, ledgerId, id, true);
    requireVersion(etag, row.version);
    await cancelQueued(tx, eq(notificationDeliveries.ruleId, id), '规则已删除', now);
    await tx
      .update(reminderRules)
      .set({ deletedAt: now, enabled: false, version: row.version + 1, updatedAt: now })
      .where(eq(reminderRules.id, id));
    await audit(tx, ctx, ledgerId, 'reminder_rule.deleted', id);
  });
}

/** Whether a planned delivery still makes sense right before sending (rule version, bill and subscription state). */
export async function stillValid(
  db: Executor | Tx,
  delivery: {
    ruleId: string | null;
    ruleVersion: number | null;
    eventType: string;
    subjectId: string | null;
    payload: unknown;
  },
): Promise<string | null> {
  if (!delivery.ruleId) return null;
  const [rule] = await db.select().from(reminderRules).where(eq(reminderRules.id, delivery.ruleId));
  if (!rule || rule.deletedAt) return '规则已删除';
  if (!rule.enabled) return '规则已暂停';
  if (rule.version !== delivery.ruleVersion) return '规则已修改';
  const refs = (delivery.payload as DeliveryPayload).refs ?? {};
  if ((delivery.eventType === 'bill_due' || delivery.eventType === 'overdue') && delivery.subjectId) {
    const [o] = await db
      .select({ status: billOccurrences.status, subStatus: subscriptions.status })
      .from(billOccurrences)
      .innerJoin(subscriptions, eq(subscriptions.id, billOccurrences.subscriptionId))
      .where(eq(billOccurrences.id, delivery.subjectId));
    if (!o) return '账单不存在';
    if (o.status === 'paid') return '账单已支付';
    if (o.status === 'skipped') return '账单已跳过';
    if (o.status === 'cancelled') return '账单已取消（订阅暂停、取消或改期）';
    if (o.subStatus !== 'active') return '订阅已暂停或取消';
  }
  if ((delivery.eventType === 'trial_end' || delivery.eventType === 'cancel_deadline') && delivery.subjectId) {
    const [s] = await db.select().from(subscriptions).where(eq(subscriptions.id, delivery.subjectId));
    if (!s || s.status === 'cancelled') return '订阅已取消';
    if ((delivery.eventType === 'trial_end' ? s.trialEndsOn : s.cancelBy) !== refs.date) return '日期已修改';
  }
  return null;
}

// ---------- event-driven reminders ----------

/** After money moves (outbox): budget thresholds reached in the current period alert once per threshold and period. */
export async function budgetAlerts(ledgerId: string, now = new Date()) {
  const rules = await database()
    .select()
    .from(reminderRules)
    .where(
      and(
        eq(reminderRules.ledgerId, ledgerId),
        eq(reminderRules.eventType, 'budget_threshold'),
        eq(reminderRules.enabled, true),
        isNull(reminderRules.deletedAt),
      ),
    );
  let created = 0;
  for (const rule of rules) {
    let progress;
    try {
      progress = await budgetProgress({ userId: rule.ownerId, requestId: 'worker' }, ledgerId, {}, now);
    } catch {
      continue;
    } // owner no longer a member
    const channels = await ruleChannels(database(), rule);
    for (const item of progress.items) {
      if (rule.budgetId && item.budgetId !== rule.budgetId) continue;
      for (const threshold of item.reachedThresholds) {
        const moved = slot(
          localDate(now, rule.timezone),
          localTimeOf(now, rule.timezone),
          rule.timezone,
          quietOf(rule),
          endOfDay(addDays(item.periodEnd, -1), rule.timezone),
        );
        const fire: Fire = {
          eventId: `budget_threshold:${item.budgetId}:${item.periodStart}:${threshold}`,
          subjectId: item.budgetId,
          scheduledAt: moved.deferredByQuietHours ? moved.scheduledAt : now,
          expiresAt: moved.expiresAt,
          deferredByQuietHours: moved.deferredByQuietHours,
          payload: {
            title: item.name ?? '预算',
            kind: 'budget_threshold',
            refs: {
              budgetId: item.budgetId,
              name: item.name ?? '总预算',
              threshold,
              spent: item.spent,
              amount: item.amount.amount,
              currency: item.amount.currency,
              periodStart: item.periodStart,
            },
          },
        };
        if (fire.expiresAt > now) created += await writeFire(database(), rule, fire, channels, now);
      }
    }
  }
  return created;
}

/** After each FX batch: threshold crossings alert once, with hysteresis and a cooldown (see fxDecision). */
export async function fxAlerts(now = new Date()) {
  const rules = await database()
    .select()
    .from(reminderRules)
    .where(
      and(
        eq(reminderRules.eventType, 'fx_threshold'),
        eq(reminderRules.enabled, true),
        isNull(reminderRules.deletedAt),
      ),
    );
  let created = 0;
  for (const rule of rules) {
    if (!rule.fxBase || !rule.fxQuote) continue;
    const quote = (await getExchangeRates({ base: rule.fxBase, quotes: rule.fxQuote }, now)).rates[0];
    if (!quote?.value || (quote.freshness !== 'fresh' && quote.freshness !== 'delayed')) continue; // never alert on stale or missing quotes
    const above = rule.fxAbove && sum([rule.fxAbove]).toFixed();
    const below = rule.fxBelow && sum([rule.fxBelow]).toFixed();
    const decision = fxDecision(rule.fxState as Partial<FxState> | null, quote.value, above, below, now);
    if (decision.fire) {
      const rate = sum([quote.value]).toDecimalPlaces(6).toFixed();
      const threshold = decision.fire === 'above' ? above! : below!;
      const moved = slot(
        localDate(now, rule.timezone),
        localTimeOf(now, rule.timezone),
        rule.timezone,
        quietOf(rule),
        new Date(now.getTime() + 3600_000),
      );
      const fire: Fire = {
        eventId: `fx_threshold:${rule.id}:${decision.fire}:${now.toISOString().slice(0, 16)}`,
        subjectId: null,
        scheduledAt: moved.deferredByQuietHours ? moved.scheduledAt : now,
        expiresAt: moved.expiresAt,
        deferredByQuietHours: moved.deferredByQuietHours,
        payload: {
          title: `${rule.fxBase}/${rule.fxQuote}`,
          kind: 'fx_threshold',
          refs: {
            base: rule.fxBase,
            quote: rule.fxQuote,
            direction: decision.fire,
            threshold,
            rate,
            sourceAt: quote.sourceAt,
          },
        },
      };
      if (fire.expiresAt > now) {
        created += await writeFire(database(), rule, fire, await ruleChannels(database(), rule), now);
      }
    }
    if (decision.changed) {
      await database().update(reminderRules).set({ fxState: decision.next }).where(eq(reminderRules.id, rule.id));
    }
  }
  return created;
}

/** delivery_failed rules: tell the owner through their other channels (never through the failing one). */
export async function deliveryFailedAlerts(
  failed: {
    id: string;
    ledgerId: string | null;
    userId: string;
    channelId: string;
    round: number;
    title: string;
    reason: string;
  },
  now = new Date(),
) {
  if (!failed.ledgerId) return 0;
  const rules = await database()
    .select()
    .from(reminderRules)
    .where(
      and(
        eq(reminderRules.ledgerId, failed.ledgerId),
        eq(reminderRules.ownerId, failed.userId),
        eq(reminderRules.eventType, 'delivery_failed'),
        eq(reminderRules.enabled, true),
        isNull(reminderRules.deletedAt),
      ),
    );
  let created = 0;
  for (const rule of rules) {
    const channels = (await ruleChannels(database(), rule)).filter(c => c.id !== failed.channelId);
    const fire: Fire = {
      eventId: `delivery_failed:${failed.id}:${failed.round}`,
      subjectId: failed.id,
      scheduledAt: now,
      expiresAt: new Date(now.getTime() + 24 * 3600_000),
      deferredByQuietHours: false,
      payload: {
        title: failed.title,
        kind: 'delivery_failed',
        refs: { deliveryId: failed.id, title: failed.title, reason: failed.reason },
      },
    };
    created += await writeFire(database(), rule, fire, channels, now);
  }
  return created;
}

// ---------- message templates (template version 1) ----------

const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000);
const LABELS: Record<string, string> = {
  daily_entry: '记账提醒',
  weekly_summary: '上周收支小结',
  monthly_summary: '上月收支小结',
};
/**
 * Renders a delivery at send time (so "in N days" matches the day it is sent). Summaries are filled in by the
 * caller with fresh figures through `extra`.
 */
export function render(
  delivery: { ledgerId: string | null; eventType: string; payload: unknown },
  today: string,
  extra: Record<string, string> = {},
) {
  const p = delivery.payload as DeliveryPayload;
  const r = (p.refs ?? {}) as Record<string, string | number | null>;
  const link = (path: string) => (delivery.ledgerId ? `${appUrl()}/ledgers/${delivery.ledgerId}${path}` : appUrl());
  switch (delivery.eventType) {
    case 'bill_due': {
      const n = days(today, String(r.date));
      return {
        title: `订阅「${r.name}」${n <= 0 ? '今天到期' : `${n} 天后到期`}`,
        body: `${r.date} · ${r.currency} ${r.amount}。到期后请在账本里确认支付，系统不会自动记为已支付。`,
        link: link('/subscriptions?view=list'),
      };
    }
    case 'overdue':
      return {
        title: `订阅「${r.name}」已逾期未确认`,
        body: `应付日 ${r.date} · ${r.currency} ${r.amount}。如已付款，请在账本里确认支付。`,
        link: link('/subscriptions?view=list'),
      };
    case 'trial_end': {
      const n = days(today, String(r.date));
      return {
        title: `「${r.name}」试用${n <= 0 ? '今天结束' : `${n} 天后结束`}`,
        body: `试用结束日 ${r.date}，之后可能开始扣费。`,
        link: link('/subscriptions'),
      };
    }
    case 'cancel_deadline': {
      const n = days(today, String(r.date));
      return {
        title: `「${r.name}」取消截止${n <= 0 ? '就在今天' : `还有 ${n} 天`}`,
        body: `取消截止日 ${r.date}。`,
        link: link('/subscriptions'),
      };
    }
    case 'budget_threshold':
      return {
        title: `预算「${r.name}」已用到 ${r.threshold}%`,
        body: `本期已用 ${r.currency} ${r.spent} / ${r.amount}（自 ${r.periodStart}）。`,
        link: link('/analytics'),
      };
    case 'fx_threshold':
      return {
        title: `${r.base}/${r.quote} ${r.direction === 'above' ? '高于' : '低于'} ${r.threshold}`,
        body: `参考汇率 1 ${r.base} = ${r.rate} ${r.quote}${r.sourceAt ? `（报价 ${r.sourceAt}）` : ''}。参考汇率不是成交价。`,
        link: link('/settings/currencies'),
      };
    case 'delivery_failed':
      return {
        title: `提醒未能送达：${r.title}`,
        body: `原因：${r.reason}。可在提醒中心查看并重试。`,
        link: link('/reminders'),
      };
    case 'daily_entry':
    case 'weekly_summary':
    case 'monthly_summary':
      return {
        title: LABELS[delivery.eventType],
        body: extra.body ?? '',
        link: link(delivery.eventType === 'daily_entry' ? '/transactions' : '/analytics'),
      };
    case 'test':
      return {
        title: p.title,
        body: [
          p.message ?? '这是一条测试消息：收到即表示渠道配置可用。',
          p.code ? `邮箱验证码：${p.code}（30 分钟内有效）` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        link: appUrl(),
      };
    default:
      return { title: p.title, body: '', link: link('') };
  }
}
export const quietNow = (rule: { quietStart: string | null; quietEnd: string | null; timezone: string }, now: Date) =>
  inQuietHours(localTimeOf(now, rule.timezone), quietOf(rule));
export { quietOf };
