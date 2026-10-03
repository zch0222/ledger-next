import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { database, type Executor, type Tx } from '@ledger/db/index';
import { accountPostings, accounts } from '@ledger/db/schema';
import { formatAmount, parseAmount, sum, toColumn } from './money';
import { DomainError } from './policy';

/** One ledger line: a signed amount in the account's own currency. `reversesId` marks a correction of an earlier line. */
export type PostingLine = { accountId: string; amount: string; reversesId?: string };

/**
 * Appends posting lines for one transaction and moves the cached balances inside the caller's DB transaction.
 * Accounts are locked one at a time in id order, so concurrent transfers in opposite directions cannot deadlock,
 * and each balance is read under its lock, so concurrent writers never lose an update.
 */
export async function appendPostings(
  tx: Tx,
  ledgerId: string,
  transactionId: string,
  lines: readonly PostingLine[],
  options: { allowArchived?: boolean } = {},
) {
  if (!lines.length) throw new Error('Invariant: a transaction needs at least one posting');
  const ids = [...new Set(lines.map(line => line.accountId))].sort();
  const locked = new Map<string, { currency: string; balance: string }>();
  for (const accountId of ids) {
    const [account] = await tx
      .select({ currency: accounts.currency, balance: accounts.balance, archivedAt: accounts.archivedAt })
      .from(accounts)
      .where(and(eq(accounts.ledgerId, ledgerId), eq(accounts.id, accountId)))
      .for('update');
    if (!account) throw new DomainError(422, 'ACCOUNT_NOT_FOUND', '账户不存在或不属于该账本');
    // Reversals may touch archived accounts; new money may not.
    if (account.archivedAt && !options.allowArchived) {
      throw new DomainError(422, 'ACCOUNT_ARCHIVED', '账户已归档，不能记账');
    }
    locked.set(accountId, account);
  }
  const createdAt = new Date();
  const rows = lines.map(line => {
    const { currency } = locked.get(line.accountId)!;
    const amount = parseAmount(line.amount, currency, { allowNegative: true });
    return {
      id: randomUUID(),
      ledgerId,
      transactionId,
      accountId: line.accountId,
      currency,
      signedAmount: toColumn(amount),
      reversesId: line.reversesId ?? null,
      createdAt,
    };
  });
  await tx.insert(accountPostings).values(rows);
  for (const accountId of ids) {
    const next = sum([
      locked.get(accountId)!.balance,
      ...rows.filter(row => row.accountId === accountId).map(row => row.signedAmount),
    ]);
    await tx
      .update(accounts)
      .set({ balance: toColumn(next) })
      .where(and(eq(accounts.ledgerId, ledgerId), eq(accounts.id, accountId)));
  }
  return rows;
}

/**
 * Voids a transaction's effect by appending one reversing line for every original line not yet reversed.
 * Running it twice adds nothing; the unique reverses_id key backs this up in the database.
 */
export async function reversePostings(tx: Tx, ledgerId: string, transactionId: string) {
  const originals = await tx
    .select({ id: accountPostings.id, accountId: accountPostings.accountId, amount: accountPostings.signedAmount })
    .from(accountPostings)
    .where(
      and(
        eq(accountPostings.ledgerId, ledgerId),
        eq(accountPostings.transactionId, transactionId),
        isNull(accountPostings.reversesId),
      ),
    )
    .for('update');
  if (!originals.length) return [];
  const reversed = new Set(
    (
      await tx
        .select({ id: accountPostings.reversesId })
        .from(accountPostings)
        .where(
          and(
            eq(accountPostings.ledgerId, ledgerId),
            inArray(
              accountPostings.reversesId,
              originals.map(o => o.id),
            ),
          ),
        )
        .for('update')
    ).map(r => r.id),
  );
  const lines = originals
    .filter(o => !reversed.has(o.id))
    .map(o => ({ accountId: o.accountId, amount: sum(['0', o.amount]).negated().toFixed(), reversesId: o.id }));
  return lines.length ? appendPostings(tx, ledgerId, transactionId, lines, { allowArchived: true }) : [];
}

/**
 * Rebuilds a balance from facts: opening balance + SUM of every posting, summed by MySQL in exact DECIMAL.
 * The cached column must always equal it; a mismatch means a write path bypassed appendPostings.
 */
export async function verifyBalance(ledgerId: string, accountId: string, db: Executor = database()) {
  const [account] = await db
    .select({ currency: accounts.currency, opening: accounts.openingBalance, cached: accounts.balance })
    .from(accounts)
    .where(and(eq(accounts.ledgerId, ledgerId), eq(accounts.id, accountId)));
  if (!account) throw new DomainError(404, 'NOT_FOUND', '账户不存在或你没有访问权限');
  // A separate aggregate rather than a correlated subquery: Drizzle renders single-table columns unqualified,
  // which inside a subquery would silently bind to account_postings.
  const [postings] = await db
    .select({ total: sql<string>`COALESCE(SUM(${accountPostings.signedAmount}), 0)` })
    .from(accountPostings)
    .where(and(eq(accountPostings.ledgerId, ledgerId), eq(accountPostings.accountId, accountId)));
  const cached = formatAmount(account.cached, account.currency);
  const computed = formatAmount(sum([account.opening, postings.total]), account.currency);
  return { cached, computed, consistent: cached === computed };
}
