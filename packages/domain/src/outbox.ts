import { randomUUID } from 'node:crypto';
import { and, asc, eq, lte } from 'drizzle-orm';
import { database } from '@ledger/db/index';
import { outboxEvents } from '@ledger/db/schema';

export type OutboxEvent = { id: string; ledgerId: string | null; type: string; payload: Record<string, unknown> };

/**
 * Moves committed outbox events to the queue. Rows are claimed with SKIP LOCKED and marked dispatched in the same DB
 * transaction that published them: if publishing fails the rows stay pending; if the commit fails after publishing,
 * the next run publishes them again with the same job id. Consumers are idempotent (at-least-once).
 */
export async function dispatchOutbox(publish: (events: OutboxEvent[]) => Promise<void>, limit = 100, now = new Date()) {
  return database().transaction(async tx => {
    const rows = await tx
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.dispatchStatus, 'pending'), lte(outboxEvents.availableAt, now)))
      .orderBy(asc(outboxEvents.availableAt), asc(outboxEvents.id))
      .limit(limit)
      .for('update', { skipLocked: true });
    if (!rows.length) return 0;
    await publish(
      rows.map(r => ({ id: r.id, ledgerId: r.ledgerId, type: r.type, payload: r.payload as Record<string, unknown> })),
    );
    for (const row of rows) {
      await tx
        .update(outboxEvents)
        .set({ dispatchStatus: 'dispatched', dispatchedAt: new Date(), attempts: row.attempts + 1 })
        .where(eq(outboxEvents.id, row.id));
    }
    return rows.length;
  });
}

/** A standalone event (not part of a business transaction), e.g. the sweeper re-queueing stalled work. */
export async function enqueueEvent(
  ledgerId: string | null,
  type: string,
  payload: Record<string, unknown>,
  availableAt = new Date(),
) {
  const now = new Date();
  await database()
    .insert(outboxEvents)
    .values({ id: randomUUID(), ledgerId, type, payload, availableAt, createdAt: now });
}
