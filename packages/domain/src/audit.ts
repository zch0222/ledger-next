import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/src/index';
import { auditLogs, ledgerDataVersions, outboxEvents } from '../../db/src/schema';
import type { AuthContext } from './identity';

/** Audit row in the caller's transaction: actor, action, resource and request id; never secrets or full notes. */
export function audit(tx: Tx, ctx: AuthContext, ledgerId: string, action: string, resourceId: string) {
  return tx.insert(auditLogs).values({
    id: randomUUID(),
    ledgerId,
    actorId: ctx.userId,
    action,
    resourceId,
    requestId: ctx.requestId,
    createdAt: new Date(),
  });
}

/**
 * Advances the ledger's data version inside the write transaction. Report caches embed it in their keys, so an
 * aggregate computed before this write can never be served after it commits. Taken last in every write (after
 * account locks), so all writers acquire locks in the same order.
 */
export function bumpDataVersion(tx: Tx, ledgerId: string) {
  const now = new Date();
  return tx
    .insert(ledgerDataVersions)
    .values({ ledgerId, version: 1, updatedAt: now })
    .onDuplicateKeyUpdate({ set: { version: sql`${ledgerDataVersions.version} + 1`, updatedAt: now } });
}
const FINANCIAL = /^(transaction|refund|account|budget|subscription|bill)\./;

/** Outbox event committed atomically with the business change; the worker dispatches it later. */
export async function emit(tx: Tx, ledgerId: string, type: string, payload: Record<string, unknown>) {
  const now = new Date();
  if (FINANCIAL.test(type)) await bumpDataVersion(tx, ledgerId);
  return tx
    .insert(outboxEvents)
    .values({ id: randomUUID(), ledgerId, type, payload, availableAt: now, createdAt: now });
}
