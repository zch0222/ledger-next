import { Redis } from 'ioredis';

// Redis holds caches and queue state only, never financial facts. Every reader must fall back to MySQL when Redis is
// unavailable, so commands fail fast instead of queueing while disconnected.
let client: Redis | null | undefined;
export function redis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.REDIS_URL;
  client = url ? new Redis(url, { lazyConnect: false, enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 2000 }) : null;
  client?.on('error', () => { /* reported by the callers' fallbacks; avoid unhandled error events */ });
  return client;
}

/** Best-effort cache read: null on a miss or when Redis is unavailable. */
export async function cacheGet(key: string) {
  try { return (await redis()?.get(key)) ?? null; } catch { return null; }
}
/** Best-effort cache write with a TTL in seconds. */
export async function cacheSet(key: string, value: string, ttlSeconds: number) {
  try { await redis()?.set(key, value, 'EX', ttlSeconds); return true; } catch { return false; }
}
export async function cacheDelete(...keys: string[]) {
  try { if (keys.length) await redis()?.del(...keys); } catch { /* entries expire on their own */ }
}
export async function closeRedis() {
  const current = client;
  client = undefined;
  if (current) await current.quit().catch(() => current.disconnect());
}
