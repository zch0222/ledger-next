import { readyRedis } from '../../db/src/redis';
import { DomainError } from './policy';

/**
 * Layered API rate limits (TECHNICAL_DESIGN §8): per actor, per client address for failed authentication, and a separate
 * budget for money writes per actor and ledger — tighter for Agent tokens, so a looping Agent cannot fill a ledger.
 * Fixed one-minute windows in Redis. When Redis is unavailable the limits fail open: money stays protected by
 * idempotency and approvals, and availability of the ledger does not depend on the cache.
 */
export type Limit = { name: string; limit: number; windowSeconds: number };
const env = (name: string, fallback: number) => { const value = Number(process.env[name]); return Number.isInteger(value) && value > 0 ? value : fallback; };
export const LIMITS = {
  actor: (): Limit => ({ name: 'actor', limit: env('API_RATE_LIMIT', 600), windowSeconds: 60 }),
  authFailure: (): Limit => ({ name: 'auth-fail', limit: env('API_AUTH_FAILURE_LIMIT', 30), windowSeconds: 60 }),
  money: (): Limit => ({ name: 'money', limit: env('API_WRITE_RATE_LIMIT', 120), windowSeconds: 60 }),
  agentMoney: (): Limit => ({ name: 'agent-money', limit: env('AGENT_WRITE_RATE_LIMIT', 30), windowSeconds: 60 }),
};
/** Operations that move money or bulk-change a ledger. */
export const MONEY_WRITES = new Set(['createTransaction', 'updateTransaction', 'voidTransaction', 'createRefund', 'createBillPayment', 'createImportJob', 'createImportCommit', 'createImportReversal']);

export type Verdict = { allowed: boolean; count: number; retryAfter: number };
const windowOf = (limit: Limit, now: number) => {
  const index = Math.floor(now / 1000 / limit.windowSeconds);
  return { index, retryAfter: Math.max(1, (index + 1) * limit.windowSeconds - Math.floor(now / 1000)) };
};
const keyOf = (limit: Limit, id: string, index: number) => `rl:${limit.name}:${id}:${index}`;

/** Counts one request and says whether it is within the limit. */
export async function hit(limit: Limit, id: string, now = Date.now()): Promise<Verdict> {
  const { index, retryAfter } = windowOf(limit, now), key = keyOf(limit, id, index), client = await readyRedis();
  if (!client) return { allowed: true, count: 0, retryAfter };
  try {
    const result = await client.multi().incr(key).expire(key, limit.windowSeconds + 5).exec();
    const count = Number(result?.[0]?.[1] ?? 0);
    return { allowed: count <= limit.limit, count, retryAfter };
  } catch { return { allowed: true, count: 0, retryAfter }; }
}
/** Whether the limit is already used up, without counting this request. */
export async function exhausted(limit: Limit, id: string, now = Date.now()): Promise<Verdict> {
  const { index, retryAfter } = windowOf(limit, now), client = await readyRedis();
  if (!client) return { allowed: true, count: 0, retryAfter };
  try {
    const count = Number(await client.get(keyOf(limit, id, index)) ?? 0);
    return { allowed: count < limit.limit, count, retryAfter };
  } catch { return { allowed: true, count: 0, retryAfter }; }
}
export const tooMany = (verdict: Verdict, what = '请求过于频繁') =>
  new DomainError(429, 'RATE_LIMITED', `${what}，请 ${verdict.retryAfter} 秒后再试`, { 'Retry-After': String(verdict.retryAfter) });
export async function enforce(limit: Limit, id: string, what?: string, now = Date.now()) {
  const verdict = await hit(limit, id, now);
  if (!verdict.allowed) throw tooMany(verdict, what);
}

/** The client address as the reverse proxy reports it (first X-Forwarded-For entry); null when not behind a proxy. */
export function clientAddress(headers: Headers) {
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first && /^[0-9a-fA-F:.]{2,45}$/.test(first) ? first : null;
}

/**
 * Storage for Better Auth's sign-in / sign-up throttle, shared by every web process through Redis (fixed window per
 * key). Without Redis it falls back to this process's memory, so authentication stays throttled, if less tightly.
 */
export function authRateLimitStorage() {
  const memory = new Map<string, { count: number; until: number }>();
  return {
    async consume(key: string, rule: { window: number; max: number }) {
      const client = await readyRedis();
      if (client) {
        try {
          const redisKey = `rl:auth:${key}`;
          const created = await client.set(redisKey, '1', 'EX', rule.window, 'NX');
          const count = created ? 1 : await client.incr(redisKey);
          if (count <= rule.max) return { allowed: true, retryAfter: null };
          const ttl = await client.ttl(redisKey);
          return { allowed: false, retryAfter: ttl > 0 ? ttl : rule.window };
        } catch { /* fall back to memory below */ }
      }
      const now = Date.now(), entry = memory.get(key);
      if (!entry || entry.until <= now) { memory.set(key, { count: 1, until: now + rule.window * 1000 }); return { allowed: true, retryAfter: null }; }
      if (entry.count < rule.max) { entry.count++; return { allowed: true, retryAfter: null }; }
      return { allowed: false, retryAfter: Math.ceil((entry.until - now) / 1000) };
    },
  };
}
