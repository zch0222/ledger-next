import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { database, type Executor, type Tx } from '@ledger/db/index';
import { notificationChannels, notificationDeliveries } from '@ledger/db/schema';
import type { ChannelConfig } from './channels';
import { open } from './secrets';

// Shared pieces of the notification engine: the delivery log is the job store (TECHNICAL_DESIGN §6.3).
export type ChannelRow = typeof notificationChannels.$inferSelect;
export type DeliveryRow = typeof notificationDeliveries.$inferSelect;
export type DeliveryPayload = {
  title: string;
  kind: string;
  refs?: Record<string, string | number | null>;
  message?: string;
  code?: string;
};
export const MAX_ATTEMPTS = 5;
export const channelAad = (row: { id: string; userId: string }) => `channel:${row.id}:${row.userId}`;

/** Decrypted channel configuration; only ever held in memory while sending. */
export function channelConfig(row: ChannelRow): ChannelConfig {
  if (row.type === 'in_app') return { type: 'in_app' };
  if (!row.sealedConfig) throw new Error('channel has no stored configuration');
  return open<ChannelConfig>(row.sealedConfig, channelAad(row));
}

/** Lazily gives every user the in-app channel (the fallback that always works). */
export async function ensureInApp(db: Executor | Tx, userId: string, now = new Date()) {
  const [existing] = await db
    .select()
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.userId, userId),
        eq(notificationChannels.type, 'in_app'),
        isNull(notificationChannels.deletedAt),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const row: ChannelRow = {
    id: randomUUID(),
    userId,
    type: 'in_app',
    name: '站内通知',
    enabled: true,
    status: 'active',
    sealedConfig: null,
    keyId: null,
    configSummary: {},
    verificationHash: null,
    verificationExpiresAt: null,
    verificationAttempts: 0,
    lastVerifiedAt: now,
    lastError: null,
    consecutiveFailures: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await db.insert(notificationChannels).values(row);
  return row;
}

type NewDelivery = Pick<
  DeliveryRow,
  | 'ledgerId'
  | 'userId'
  | 'channelId'
  | 'channelType'
  | 'ruleId'
  | 'ruleVersion'
  | 'eventType'
  | 'eventId'
  | 'subjectId'
  | 'dedupeKey'
  | 'templateVersion'
  | 'scheduledAt'
  | 'expiresAt'
  | 'deferredByQuietHours'
> & { payload: DeliveryPayload; status?: DeliveryRow['status']; reason?: string | null };
/** Inserts a delivery unless its dedupe key exists; returns the row that holds the key. */
export async function insertDelivery(db: Executor | Tx, input: NewDelivery, now = new Date()) {
  const id = randomUUID();
  await db
    .insert(notificationDeliveries)
    .values({
      id,
      ...input,
      status: input.status ?? 'queued',
      reason: input.reason ?? null,
      nextAttemptAt: input.scheduledAt,
      createdAt: now,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  const [row] = await db
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.dedupeKey, input.dedupeKey));
  return { row, created: row.id === id };
}

/** Cancels deliveries that have not started (queued); history of sent ones stays untouched. */
export async function cancelQueued(db: Executor | Tx, where: SQL | undefined, reason: string, now = new Date()) {
  const [result] = await db
    .update(notificationDeliveries)
    .set({ status: 'cancelled', reason, version: sql`${notificationDeliveries.version} + 1`, updatedAt: now })
    .where(and(eq(notificationDeliveries.status, 'queued'), where));
  return (result as { affectedRows: number }).affectedRows;
}
export const cancelForSubjects = (db: Executor | Tx, subjectIds: string[], reason: string) =>
  subjectIds.length
    ? cancelQueued(db, inArray(notificationDeliveries.subjectId, subjectIds), reason)
    : Promise.resolve(0);

export function presentDelivery(row: DeliveryRow) {
  const payload = row.payload as DeliveryPayload;
  return {
    id: row.id,
    channelId: row.channelId,
    channelType: row.channelType,
    eventType: row.eventType,
    eventId: row.eventId,
    status: row.status,
    scheduledAt: row.scheduledAt.toISOString(),
    attempts: row.attempts,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    responseClass: row.responseClass,
    createdAt: row.createdAt.toISOString(),
    title: payload.title,
    ruleId: row.ruleId,
    round: row.round,
    expiresAt: row.expiresAt.toISOString(),
    deferredByQuietHours: row.deferredByQuietHours,
    deadLetter: row.deadLetter,
    reason: row.reason,
    lastError: row.lastError,
  };
}
export const defaultDb = () => database();
