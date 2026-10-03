import type { RowDataPacket } from 'mysql2';
import { databasePool } from '../../../../../../../packages/db/src/index';
import { readyRedis } from '../../../../../../../packages/db/src/redis';
import { EXPECTED_MIGRATION } from '../../../../../../../packages/db/src/schema-version';

export const dynamic = 'force-dynamic';
const timeout = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

/**
 * Readiness: MySQL answers and carries at least the schema this build expects. Redis is reported but not required —
 * the web process only caches and rate-limits there and falls back without it. Never calls FX or message providers.
 */
export async function GET() {
  const checks: Record<string, unknown> = {};
  let ready = true;
  try {
    const [rows] = await timeout(
      databasePool().query<RowDataPacket[]>('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1'),
      2000,
    );
    const applied = (rows[0]?.name as string | undefined) ?? null;
    checks.database = 'ok';
    checks.migrations = { expected: EXPECTED_MIGRATION, applied };
    if (!applied || applied < EXPECTED_MIGRATION) ready = false;
  } catch {
    checks.database = 'unavailable';
    ready = false;
  }
  try {
    const client = await readyRedis(300);
    checks.redis = client && (await timeout(client.ping(), 500)) === 'PONG' ? 'ok' : 'unavailable';
  } catch {
    checks.redis = 'unavailable';
  }
  return Response.json(
    { status: ready ? 'ready' : 'unavailable', checks },
    { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
