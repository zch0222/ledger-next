import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm';
import { AccountCreate, AccountUpdate } from '../../contracts/src/finance';
import { database, type Executor, type Tx } from '../../db/src/index';
import { accounts } from '../../db/src/schema';
import { ledgerAccess } from './access';
import { audit, emit } from './audit';
import type { AuthContext, Keyset } from './identity';
import { formatAmount, parseAmount, toColumn } from './money';
import { DomainError, requireVersion } from './policy';

type Row = typeof accounts.$inferSelect;
export const presentAccount = (row: Row) => ({
  id: row.id, name: row.name, type: row.type, currency: row.currency,
  openingBalance: formatAmount(row.openingBalance, row.currency), balance: formatAmount(row.balance, row.currency),
  note: row.note, archivedAt: row.archivedAt?.toISOString() ?? null, version: row.version,
});
const notFound = () => new DomainError(404, 'NOT_FOUND', '账户不存在或你没有访问权限');

export async function listAccounts(ctx: AuthContext, ledgerId: string, filter: { includeArchived: boolean } & Keyset) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const after = filter.after && or(gt(accounts.createdAt, new Date(filter.after[0])), and(eq(accounts.createdAt, new Date(filter.after[0])), gt(accounts.id, filter.after[1])));
  return database().select().from(accounts)
    .where(and(eq(accounts.ledgerId, ledgerId), filter.includeArchived ? undefined : isNull(accounts.archivedAt), after))
    .orderBy(asc(accounts.createdAt), asc(accounts.id)).limit(filter.limit + 1);
}
export async function getAccount(ctx: AuthContext, ledgerId: string, accountId: string) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const [row] = await database().select().from(accounts).where(and(eq(accounts.ledgerId, ledgerId), eq(accounts.id, accountId)));
  if (!row) throw notFound();
  return presentAccount(row);
}
/** Opening balance may be zero or negative (credit cards are liabilities); it is never income. */
export async function createAccount(ctx: AuthContext, ledgerId: string, input: unknown, db: Executor = database()) {
  const data = AccountCreate.parse(input);
  const opening = parseAmount(data.openingBalance, data.currency, { allowZero: true, allowNegative: true });
  return db.transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const now = new Date(), id = randomUUID();
    await tx.insert(accounts).values({ id, ledgerId, name: data.name, type: data.type, currency: data.currency, openingBalance: toColumn(opening), balance: toColumn(opening), note: data.note ?? null, createdAt: now, updatedAt: now });
    await audit(tx, ctx, ledgerId, 'account.created', id);
    await emit(tx, ledgerId, 'account.created', { accountId: id });
    return presentAccount((await lockAccount(tx, ledgerId, id))!);
  });
}
async function lockAccount(tx: Tx, ledgerId: string, accountId: string) {
  const [row] = await tx.select().from(accounts).where(and(eq(accounts.ledgerId, ledgerId), eq(accounts.id, accountId))).for('update');
  return row;
}
export async function updateAccount(ctx: AuthContext, ledgerId: string, accountId: string, input: unknown, etag: string | null) {
  const data = AccountUpdate.parse(input);
  return database().transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const row = await lockAccount(tx, ledgerId, accountId);
    if (!row) throw notFound();
    requireVersion(etag, row.version);
    const changes = { ...(data.name !== undefined ? { name: data.name } : {}), ...(data.note !== undefined ? { note: data.note } : {}), version: row.version + 1, updatedAt: new Date() };
    await tx.update(accounts).set(changes).where(and(eq(accounts.ledgerId, ledgerId), eq(accounts.id, accountId)));
    await audit(tx, ctx, ledgerId, 'account.updated', accountId);
    await emit(tx, ledgerId, 'account.updated', { accountId: accountId });
    return presentAccount({ ...row, ...changes });
  });
}
/** Archiving keeps history and balance; archived accounts accept no new postings. Repeating it changes nothing. */
export async function archiveAccount(ctx: AuthContext, ledgerId: string, accountId: string, etag: string | null) {
  return database().transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const row = await lockAccount(tx, ledgerId, accountId);
    if (!row) throw notFound();
    if (!etag) requireVersion(etag, row.version);
    if (row.archivedAt) return presentAccount(row);
    requireVersion(etag, row.version);
    const changes = { archivedAt: new Date(), version: row.version + 1, updatedAt: new Date() };
    await tx.update(accounts).set(changes).where(and(eq(accounts.ledgerId, ledgerId), eq(accounts.id, accountId)));
    await audit(tx, ctx, ledgerId, 'account.archived', accountId);
    await emit(tx, ledgerId, 'account.archived', { accountId: accountId });
    return presentAccount({ ...row, ...changes });
  });
}
