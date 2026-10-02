import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, lt, or } from 'drizzle-orm';
import { database, type Executor } from '../../db/src/index';
import { auditLogs, ledgers, memberships, user } from '../../db/src/schema';
import { ledgerInput, ledgerPatch, memberInput, memberPatch } from '../../contracts/src/identity';
import { DomainError, protectLastOwner, requireRole, requireVersion, type Role } from './policy';

export type AuthContext = { userId: string; requestId: string };
/** Keyset position: [createdAt ISO, id]. `after` is exclusive; callers fetch limit + 1 to detect another page. */
export type Keyset = { limit: number; after?: [string, string] };
type Tx = Parameters<Parameters<Executor['transaction']>[0]>[0];

const ledgerColumns = { id: ledgers.id, name: ledgers.name, baseCurrency: ledgers.baseCurrency, timezone: ledgers.timezone, version: ledgers.version, role: memberships.role, createdAt: ledgers.createdAt };
const memberColumns = { id: memberships.id, userId: user.id, name: user.name, email: user.email, role: memberships.role, version: memberships.version, createdAt: memberships.createdAt };
const strip = <T extends { createdAt: Date }>({ createdAt, ...rest }: T) => { void createdAt; return rest; };
const afterAsc = (column: typeof ledgers.createdAt | typeof memberships.createdAt, id: typeof ledgers.id | typeof memberships.id, after?: [string, string]) =>
  after ? or(gt(column, new Date(after[0])), and(eq(column, new Date(after[0])), gt(id, after[1]))) : undefined;

export async function listLedgers(ctx: AuthContext, page?: Keyset) {
  const query = database().select(ledgerColumns).from(ledgers).innerJoin(memberships, eq(ledgers.id, memberships.ledgerId))
    .where(and(eq(memberships.userId, ctx.userId), afterAsc(ledgers.createdAt, ledgers.id, page?.after))).orderBy(asc(ledgers.createdAt), asc(ledgers.id));
  return page ? query.limit(page.limit + 1) : query;
}
export async function getLedger(ctx: AuthContext, ledgerId: string, required: Role = 'viewer') {
  const [result] = await database().select(ledgerColumns).from(ledgers).innerJoin(memberships, eq(ledgers.id, memberships.ledgerId))
    .where(and(eq(ledgers.id, ledgerId), eq(memberships.userId, ctx.userId)));
  requireRole(result?.role, required);
  return strip(result);
}
export async function createLedger(ctx: AuthContext, input: unknown, db: Executor = database()) {
  const data = ledgerInput.parse(input);
  const now = new Date(), ledgerId = randomUUID();
  return db.transaction(async tx => {
    await tx.insert(ledgers).values({ id: ledgerId, ...data, createdAt: now, updatedAt: now });
    await tx.insert(memberships).values({ id: randomUUID(), ledgerId, userId: ctx.userId, role: 'owner', createdAt: now });
    await audit(tx, ctx, ledgerId, 'ledger.created', ledgerId);
    return { id: ledgerId, ...data, role: 'owner' as const, version: 1 };
  });
}

// Serialize permission-changing writes per ledger. The membership check runs AFTER locking,
// so a concurrently revoked owner cannot continue from a stale authorization check.
// Owner-only reads take a shared lock: they wait for in-flight permission changes but not for each other.
async function withOwner<T>(ctx: AuthContext, ledgerId: string, action: (tx: Tx, ledger: typeof ledgers.$inferSelect) => Promise<T>, options: { db?: Executor; lock?: 'update' | 'share' } = {}) {
  return (options.db ?? database()).transaction(async tx => {
    const lock = options.lock ?? 'update';
    const [ledger] = await tx.select().from(ledgers).where(eq(ledgers.id, ledgerId)).for(lock);
    if (!ledger) throw new DomainError(404, 'NOT_FOUND', '账本不存在或你没有访问权限');
    const [membership] = await tx.select().from(memberships).where(and(eq(memberships.ledgerId, ledgerId), eq(memberships.userId, ctx.userId))).for(lock);
    requireRole(membership?.role, 'owner');
    return action(tx, ledger);
  });
}
function audit(tx: Tx, ctx: AuthContext, ledgerId: string, action: string, resourceId: string) {
  return tx.insert(auditLogs).values({ id: randomUUID(), ledgerId, actorId: ctx.userId, action, resourceId, requestId: ctx.requestId, createdAt: new Date() });
}
export async function updateLedger(ctx: AuthContext, ledgerId: string, input: unknown, etag: string | null) {
  const data = ledgerPatch.parse(input);
  return withOwner(ctx, ledgerId, async (tx, ledger) => {
    requireVersion(etag, ledger.version);
    await tx.update(ledgers).set({ ...data, version: ledger.version + 1, updatedAt: new Date() }).where(eq(ledgers.id, ledgerId));
    await audit(tx, ctx, ledgerId, 'ledger.updated', ledgerId);
    return { id: ledgerId, name: data.name, baseCurrency: ledger.baseCurrency, timezone: ledger.timezone, role: 'owner' as const, version: ledger.version + 1 };
  });
}
export async function listMembers(ctx: AuthContext, ledgerId: string, page?: Keyset) {
  // Same transaction/lock as writes prevents a membership revocation racing the sensitive read.
  return withOwner(ctx, ledgerId, async tx => {
    const query = tx.select(memberColumns).from(memberships).innerJoin(user, eq(memberships.userId, user.id))
      .where(and(eq(memberships.ledgerId, ledgerId), afterAsc(memberships.createdAt, memberships.id, page?.after))).orderBy(asc(memberships.createdAt), asc(memberships.id));
    return page ? query.limit(page.limit + 1) : query;
  }, { lock: 'share' });
}
async function member(tx: Tx, ledgerId: string, memberId: string) {
  const [row] = await tx.select(memberColumns).from(memberships).innerJoin(user, eq(memberships.userId, user.id)).where(and(eq(memberships.id, memberId), eq(memberships.ledgerId, ledgerId)));
  return strip(row);
}
export async function addMember(ctx: AuthContext, ledgerId: string, input: unknown, db?: Executor) {
  const data = memberInput.parse(input);
  return withOwner(ctx, ledgerId, async tx => {
    const [target] = await tx.select({ id: user.id }).from(user).where(eq(user.email, data.email));
    if (!target) throw new DomainError(422, 'USER_NOT_REGISTERED', '该邮箱尚未注册，请先让对方创建账号');
    const [existing] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.ledgerId, ledgerId), eq(memberships.userId, target.id)));
    if (existing) throw new DomainError(409, 'MEMBERSHIP_EXISTS', '该用户已经是账本成员');
    const memberId = randomUUID();
    await tx.insert(memberships).values({ id: memberId, ledgerId, userId: target.id, role: data.role, createdAt: new Date() });
    await audit(tx, ctx, ledgerId, 'membership.created', memberId);
    return member(tx, ledgerId, memberId);
  }, { db });
}
export async function changeMember(ctx: AuthContext, ledgerId: string, memberId: string, input: unknown | null, etag: string | null) {
  const nextRole = input === null ? null : memberPatch.parse(input).role;
  return withOwner(ctx, ledgerId, async tx => {
    const all = await tx.select().from(memberships).where(eq(memberships.ledgerId, ledgerId)).for('update');
    const target = all.find(m => m.id === memberId);
    if (!target) throw new DomainError(404, 'NOT_FOUND', '成员不存在');
    requireVersion(etag, target.version);
    protectLastOwner(target.role, nextRole, all.filter(m => m.role === 'owner').length);
    if (nextRole) await tx.update(memberships).set({ role: nextRole, version: target.version + 1 }).where(and(eq(memberships.id, memberId), eq(memberships.ledgerId, ledgerId)));
    else await tx.delete(memberships).where(and(eq(memberships.id, memberId), eq(memberships.ledgerId, ledgerId)));
    await audit(tx, ctx, ledgerId, nextRole ? 'membership.updated' : 'membership.removed', memberId);
    return nextRole ? member(tx, ledgerId, memberId) : null;
  });
}
export async function listAuditEvents(ctx: AuthContext, ledgerId: string, filter: { action?: string } & Keyset) {
  return withOwner(ctx, ledgerId, async tx => {
    const after = filter.after && or(lt(auditLogs.createdAt, new Date(filter.after[0])), and(eq(auditLogs.createdAt, new Date(filter.after[0])), lt(auditLogs.id, filter.after[1])));
    const rows = await tx.select({ id: auditLogs.id, action: auditLogs.action, resourceId: auditLogs.resourceId, actorId: user.id, actorName: user.name, requestId: auditLogs.requestId, createdAt: auditLogs.createdAt })
      .from(auditLogs).innerJoin(user, eq(auditLogs.actorId, user.id))
      .where(and(eq(auditLogs.ledgerId, ledgerId), filter.action ? eq(auditLogs.action, filter.action) : undefined, after))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(filter.limit + 1);
    return rows.map(({ actorId, actorName, ...row }) => ({ ...row, actor: { id: actorId, name: actorName } }));
  }, { lock: 'share' });
}
