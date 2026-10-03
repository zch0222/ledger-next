import { and, eq } from 'drizzle-orm';
import type { Executor, Tx } from '@ledger/db/index';
import { ledgers, memberships } from '@ledger/db/schema';
import type { AuthContext } from './identity';
import { requireRole, type Role } from './policy';

/**
 * Authorizes the caller on a ledger and returns its base currency / timezone.
 * Inside a write transaction pass `lock`: only the caller's membership row is read FOR SHARE, so a concurrent role
 * change or removal (which locks memberships FOR UPDATE) waits for this write instead of racing a stale authorization.
 * The ledger row is read without a lock: permission changes lock it first, and locking it here too could deadlock.
 */
export async function ledgerAccess(
  db: Executor | Tx,
  ctx: AuthContext,
  ledgerId: string,
  required: Role,
  lock = false,
) {
  const query = db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.ledgerId, ledgerId), eq(memberships.userId, ctx.userId)));
  const [membership] = lock ? await query.for('share') : await query;
  requireRole(membership?.role, required);
  const [ledger] = await db
    .select({ baseCurrency: ledgers.baseCurrency, timezone: ledgers.timezone })
    .from(ledgers)
    .where(eq(ledgers.id, ledgerId));
  return { role: membership.role, ...ledger };
}
