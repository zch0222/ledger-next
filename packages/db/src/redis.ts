import { Redis } from 'ioredis';

// Redis holds caches and queue state only, never financial facts. Every reader must fall back to MySQL when Redis is
// unavailable, so commands fail fast instead of queueing while disconnected.
let client: Redis | null | undefined;
let connectedOnce = false;
export function redis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.REDIS_URL;
  client = url ? new Redis(url, { lazyConnect: false, enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 2000 }) : null;
  client?.on('error', () => { /* reported by the callers' fallbacks; avoid unhandled error events */ });
  client?.once('ready', () => { connectedOnce = true; });
  return client;
}

/**
 * The client when connected; null otherwise. Only the very first connection after start is waited for (at most
 * `timeoutMs`), so a later Redis outage costs callers nothing: they fall back immediately.
 */
export async function readyRedis(timeoutMs = 500): Promise<Redis | null> {
  const current = redis();
  if (!current || current.status === 'ready') return current;
  if (connectedOnce || current.status === 'end') return null;
  return new Promise(resolve => {
    const done = (value: Redis | null) => { clearTimeout(timer); current.off('ready', onReady); resolve(value); };
    const onReady = () => done(current);
    const timer = setTimeout(() => done(null), timeoutMs);
    current.once('ready', onReady);
  });
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
  connectedOnce = false;
  if (current) await current.quit().catch(() => current.disconnect());
}
