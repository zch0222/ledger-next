import { randomUUID } from 'node:crypto';
import type { Tx } from '../../db/src/index';
import { auditLogs, outboxEvents } from '../../db/src/schema';
import type { AuthContext } from './identity';

/** Audit row in the caller's transaction: actor, action, resource and request id; never secrets or full notes. */
export function audit(tx: Tx, ctx: AuthContext, ledgerId: string, action: string, resourceId: string) {
  return tx.insert(auditLogs).values({ id: randomUUID(), ledgerId, actorId: ctx.userId, action, resourceId, requestId: ctx.requestId, createdAt: new Date() });
}

/** Outbox event committed atomically with the business change; the worker dispatches it later. */
export function emit(tx: Tx, ledgerId: string, type: string, payload: Record<string, unknown>) {
  const now = new Date();
  return tx.insert(outboxEvents).values({ id: randomUUID(), ledgerId, type, payload, availableAt: now, createdAt: now });
}
