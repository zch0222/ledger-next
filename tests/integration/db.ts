import { randomUUID } from 'node:crypto';
import { database, type Tx } from '../../packages/db/src/index';
import { accounts, ledgers, memberships, transactions, user } from '../../packages/db/src/schema';
import { toColumn } from '../../packages/domain/src/money';

// Direct inserts for schema-level tests; business code paths are covered through the domain functions.
const now = () => new Date();
export async function seedUser() {
  const id = randomUUID();
  await database()
    .insert(user)
    .values({
      id,
      name: 'integration',
      email: `int-${id}@example.test`,
      emailVerified: false,
      createdAt: now(),
      updatedAt: now(),
    });
  return id;
}
export async function seedLedger(userId: string, baseCurrency = 'CNY') {
  const id = randomUUID();
  await database()
    .insert(ledgers)
    .values({ id, name: '集成测试', baseCurrency, timezone: 'Asia/Hong_Kong', createdAt: now(), updatedAt: now() });
  await database()
    .insert(memberships)
    .values({ id: randomUUID(), ledgerId: id, userId, role: 'owner', createdAt: now() });
  return id;
}
export async function seedAccount(
  ledgerId: string,
  currency: string,
  opening = '0',
  extra: Partial<typeof accounts.$inferInsert> = {},
) {
  const id = randomUUID();
  await database()
    .insert(accounts)
    .values({
      id,
      ledgerId,
      name: `${currency} 账户`,
      type: 'bank',
      currency,
      openingBalance: toColumn(opening),
      balance: toColumn(opening),
      createdAt: now(),
      updatedAt: now(),
      ...extra,
    });
  return id;
}
export function transactionRow(
  ledgerId: string,
  createdBy: string,
  extra: Partial<typeof transactions.$inferInsert> = {},
) {
  return {
    id: randomUUID(),
    ledgerId,
    kind: 'transfer' as const,
    occurredAt: now(),
    localDate: '2026-10-02',
    timezone: 'Asia/Hong_Kong',
    source: 'api' as const,
    createdBy,
    createdAt: now(),
    updatedAt: now(),
    ...extra,
  };
}
export async function seedTransaction(
  ledgerId: string,
  createdBy: string,
  extra: Partial<typeof transactions.$inferInsert> = {},
  db: Tx | ReturnType<typeof database> = database(),
) {
  const row = transactionRow(ledgerId, createdBy, extra);
  await db.insert(transactions).values(row);
  return row.id;
}
/** Resolves to the MySQL error code a statement failed with (mysql2 errors may be wrapped by Drizzle). */
export async function mysqlError(work: Promise<unknown>) {
  try {
    await work;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code ?? String(error);
  }
  throw new Error('Expected the statement to fail');
}
