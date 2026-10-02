export const dynamic = 'force-dynamic';
/** Liveness: the process answers. No database, Redis or provider calls (TECHNICAL_DESIGN §8). */
export function GET() {
  return Response.json({ status: 'live' }, { headers: { 'Cache-Control': 'no-store' } });
}
