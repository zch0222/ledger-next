import { databasePool } from '../../../../../../packages/db/src/index';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    await databasePool().query('SELECT id FROM ledgers LIMIT 1');
    return Response.json({ status: 'ok', database: 'mysql' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
