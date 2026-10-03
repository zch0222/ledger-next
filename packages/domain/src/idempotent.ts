import { and, eq, lte } from 'drizzle-orm';
import { database, type Executor } from '@ledger/db/index';
import { idempotencyRecords } from '@ledger/db/schema';
import { IDEMPOTENCY_TTL_MS, idempotencyScope, requestFingerprint } from './idempotency';
import { DomainError } from './policy';

export type StoredResponse = { status: number; data?: unknown; headers: Record<string, string> };
const duplicate = (error: unknown) =>
  [error, (error as { cause?: unknown })?.cause].some(e => (e as { code?: string })?.code === 'ER_DUP_ENTRY');

// The key row is inserted first, in the same transaction as the business write. A concurrent request with the
// same key blocks on the primary key until the first commits, then replays its stored response; if the first
// rolls back, the second proceeds. Failed requests leave no record and can be retried with the same key.
export async function withIdempotency(
  request: { actorId: string; method: string; path: string; key: string; body: unknown },
  run: (db: Executor) => Promise<StoredResponse>,
): Promise<StoredResponse & { replayed: boolean }> {
  const scopeHash = idempotencyScope(request.actorId, request.method, request.path, request.key);
  const fingerprint = requestFingerprint(request.body);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await database().transaction(async tx => {
        const now = new Date();
        await tx.insert(idempotencyRecords).values({
          scopeHash,
          actorId: request.actorId,
          method: request.method.toUpperCase(),
          path: request.path,
          idempotencyKey: request.key,
          requestHash: fingerprint,
          responseStatus: 0,
          responseBody: '',
          responseHeaders: '{}',
          createdAt: now,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
        });
        const response = await run(tx);
        await tx
          .update(idempotencyRecords)
          .set({
            responseStatus: response.status,
            responseBody: JSON.stringify(response.data ?? null),
            responseHeaders: JSON.stringify(response.headers),
          })
          .where(eq(idempotencyRecords.scopeHash, scopeHash));
        return response;
      });
      return { ...result, replayed: false };
    } catch (error) {
      if (!duplicate(error)) throw error;
      const [row] = await database()
        .select()
        .from(idempotencyRecords)
        .where(eq(idempotencyRecords.scopeHash, scopeHash));
      if (!row) continue;
      if (row.expiresAt <= new Date()) {
        await database()
          .delete(idempotencyRecords)
          .where(and(eq(idempotencyRecords.scopeHash, scopeHash), lte(idempotencyRecords.expiresAt, new Date())));
        continue;
      }
      if (row.requestHash !== fingerprint) {
        throw new DomainError(409, 'IDEMPOTENCY_KEY_REUSED', '该 Idempotency-Key 已用于不同的请求内容');
      }
      return {
        status: row.responseStatus,
        data: JSON.parse(row.responseBody),
        headers: JSON.parse(row.responseHeaders),
        replayed: true,
      };
    }
  }
  throw new DomainError(409, 'IDEMPOTENCY_KEY_BUSY', '相同请求仍在处理，请稍后用同一 Idempotency-Key 重试');
}

/** Worker housekeeping: drop expired replay records in small batches. */
export async function pruneIdempotencyRecords(now = new Date()) {
  const [result] = await database()
    .delete(idempotencyRecords)
    .where(lte(idempotencyRecords.expiresAt, now))
    .limit(1000);
  return result.affectedRows;
}

/** Whether a completed write exists for this key (an approval is not needed again to replay it). */
export async function hasIdempotencyRecord(request: { actorId: string; method: string; path: string; key: string }) {
  const [row] = await database()
    .select({ status: idempotencyRecords.responseStatus })
    .from(idempotencyRecords)
    .where(
      eq(idempotencyRecords.scopeHash, idempotencyScope(request.actorId, request.method, request.path, request.key)),
    );
  return Boolean(row && row.status > 0);
}
