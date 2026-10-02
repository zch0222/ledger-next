import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { closeRedis } from '../../packages/db/src/redis';
import { authRateLimitStorage, clientAddress, enforce, exhausted, hit, LIMITS, MONEY_WRITES } from '../../packages/domain/src/rate-limit';

// M7-SEC: fixed one-minute windows in Redis, counted per bucket and id, with Retry-After until the window ends.
afterAll(async () => { await closeRedis(); });

describe('rate limits', () => {
  it('count per id within a window, refuse beyond the limit with the seconds left, and reset with the next window', async () => {
    const limit = { name: `test-${randomUUID()}`, limit: 3, windowSeconds: 60 }, id = randomUUID();
    const t0 = Date.UTC(2026, 9, 2, 12, 0, 15);
    expect(await exhausted(limit, id, t0)).toMatchObject({ allowed: true, count: 0 });
    for (let i = 1; i <= 3; i++) expect(await hit(limit, id, t0)).toMatchObject({ allowed: true, count: i, retryAfter: 45 });
    expect(await hit(limit, id, t0 + 30_000)).toMatchObject({ allowed: false, count: 4, retryAfter: 15 });
    expect(await exhausted(limit, id, t0)).toMatchObject({ allowed: false, count: 4 });
    expect(await hit(limit, randomUUID(), t0)).toMatchObject({ allowed: true, count: 1 }); // other ids are independent
    expect(await hit(limit, id, t0 + 60_000)).toMatchObject({ allowed: true, count: 1 }); // next window
    await expect(enforce({ ...limit, limit: 0 }, id, '太快了', t0)).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED', headers: { 'Retry-After': '45' }, message: '太快了，请 45 秒后再试' });
  });
  it('have sane defaults, overridable by environment, and know which operations move money', () => {
    expect(LIMITS.actor().limit).toBe(600);
    expect(LIMITS.agentMoney().limit).toBeLessThan(LIMITS.money().limit);
    process.env.API_RATE_LIMIT = '5'; expect(LIMITS.actor().limit).toBe(5);
    process.env.API_RATE_LIMIT = 'abc'; expect(LIMITS.actor().limit).toBe(600);
    delete process.env.API_RATE_LIMIT;
    expect(MONEY_WRITES.has('createTransaction') && MONEY_WRITES.has('voidTransaction') && !MONEY_WRITES.has('listTransactions')).toBe(true);
  });
  it('take the client address from the reverse proxy header only when it looks like an address', () => {
    expect(clientAddress(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
    expect(clientAddress(new Headers({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
    expect(clientAddress(new Headers({ 'x-forwarded-for': 'evil"key' }))).toBeNull();
    expect(clientAddress(new Headers())).toBeNull();
  });
  it('share the sign-in throttle between web processes through Redis', async () => {
    const one = authRateLimitStorage(), two = authRateLimitStorage(), key = `203.0.113.9|/sign-in/email|${randomUUID()}`, rule = { window: 10, max: 3 };
    expect(await one.consume(key, rule)).toEqual({ allowed: true, retryAfter: null });
    expect(await two.consume(key, rule)).toEqual({ allowed: true, retryAfter: null }); // another process, same budget
    expect(await one.consume(key, rule)).toEqual({ allowed: true, retryAfter: null });
    const refused = await two.consume(key, rule);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfter).toBeGreaterThan(0);
    expect(refused.retryAfter).toBeLessThanOrEqual(10);
    expect(await one.consume(`${key}-other`, rule)).toEqual({ allowed: true, retryAfter: null });
  });
});
