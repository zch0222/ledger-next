import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { database, type Executor, type Tx } from '../../db/src/index';
import { accountPostings, accounts } from '../../db/src/schema';
import { formatAmount, parseAmount, sum, toColumn } from './money';
import { DomainError } from './policy';

/** One ledger line: a signed amount in the account's own currency. `reversesId` marks a correction of an earlier line. */
export type PostingLine = { accountId: string; amount: string; reversesId?: string };

/**
 * Appends posting lines for one transaction and moves the cached balances inside the caller's DB transaction.
 * Accounts are locked one at a time in id order, so concurrent transfers in opposite directions cannot deadlock,
 * and each balance is read under its lock, so concurrent writers never lose an update.
 */
export async function appendPostings(tx: Tx, ledgerId: string, transactionId: string, lines: readonly PostingLine[]) {
  if (!lines.length) throw new Error('Invariant: a transaction needs at least one posting');
  const ids = [...new Set(lines.map(line => line.accountId))].sort();
  const locked = new Map<string, { currency: string; balance: string }>();
  for (const accountId of ids) {
    const [account] = await tx.select({ currency: accounts.currency, balance: accounts.balance, archivedAt: accounts.archivedAt })
      .from(accounts).where(and(eq(accounts.ledgerId, ledgerId), eq(accounts.id, accountId))).for('update');
    if (!account) throw new DomainError(422, 'ACCOUNT_NOT_FOUND', '账户不存在或不属于该账本');
    if (account.archivedAt) throw new DomainError(422, 'ACCOUNT_ARCHIVED', '账户已归档，不能记账');
    locked.set(accountId, account);
  }
  const createdAt = new Date();
  const rows = lines.map(line => {
    const { currency } = locked.get(line.accountId)!;
    const amount = parseAmount(line.amount, currency, { allowNegative: true });
    return { id: randomUUID(), ledgerId, transactionId, accountId: line.accountId, currency, signedAmount: toColumn(amount), reversesId: line.reversesId ?? null, createdAt };
  });
  await tx.insert(accountPostings).values(rows);
  for (const accountId of ids) {
    const next = sum([locked.get(accountId)!.balance, ...rows.filter(row => row.accountId === accountId).map(row => row.signedAmount)]);
    await tx.update(accounts).set({ balance: toColumn(next) }).where(and(eq(accounts.ledgerId, ledgerId), eq(accounts.id, accountId)));
  }
  return rows;
}

/**
 * Rebuilds a balance from facts: opening balance + SUM of every posting, summed by MySQL in exact DECIMAL.
 * The cached column must always equal it; a mismatch means a write path bypassed appendPostings.
 */
export async function verifyBalance(ledgerId: string, accountId: string, db: Executor = database()) {
  const [account] = await db.select({ currency: accounts.currency, opening: accounts.openingBalance, cached: accounts.balance })
    .from(accounts).where(and(eq(accounts.ledgerId, ledgerId), eq(accounts.id, accountId)));
  if (!account) throw new DomainError(404, 'NOT_FOUND', '账户不存在或你没有访问权限');
  // A separate aggregate rather than a correlated subquery: Drizzle renders single-table columns unqualified,
  // which inside a subquery would silently bind to account_postings.
  const [postings] = await db.select({ total: sql<string>`COALESCE(SUM(${accountPostings.signedAmount}), 0)` })
    .from(accountPostings).where(and(eq(accountPostings.ledgerId, ledgerId), eq(accountPostings.accountId, accountId)));
  const cached = formatAmount(account.cached, account.currency), computed = formatAmount(sum([account.opening, postings.total]), account.currency);
  return { cached, computed, consistent: cached === computed };
}
