import { randomUUID } from 'node:crypto';

// Shared helpers for the M7 performance harness (run inside the Docker tests container by scripts/perf-test.mjs).
export const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
export const OUT = process.env.PERF_OUT ?? 'test-results/perf';
export const PASSWORD = 'Ledger-perf-only-2026!';
export type Session = { cookie: string; xff: string };
export type Result = { status: number; ms: number; total: number; data: unknown; headers: Headers };

/** One HTTP call; `ms` is time to response headers (TTFB) for pages and full body time for JSON; `total` is always the full body time. */
export async function call(session: Session | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Result> {
  const started = performance.now();
  const response = await fetch(`${BASE}${path}`, {
    method, redirect: 'manual',
    headers: { Origin: BASE, ...(session ? { Cookie: session.cookie, 'X-Forwarded-For': session.xff } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ttfb = performance.now() - started;
  const type = response.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await response.json().catch(() => null) : await response.text();
  const total = performance.now() - started;
  return { status: response.status, ms: type.includes('json') ? total : ttfb, total, data, headers: response.headers };
}
export const data = <T>(result: Result) => (result.data as { data: T }).data;
export function ok(result: Result, what: string) {
  if (result.status >= 300) throw new Error(`${what}: HTTP ${result.status} ${JSON.stringify(result.data).slice(0, 300)}`);
  return result;
}

export async function signUp(index: number, prefix: string): Promise<Session> {
  const xff = `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`;
  const response = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, 'X-Forwarded-For': xff },
    body: JSON.stringify({ name: `${prefix}${index}`, email: `${prefix}-${index}-${randomUUID().slice(0, 8)}@perf.test`, password: PASSWORD }),
  });
  if (response.status !== 200) throw new Error(`sign-up ${index}: HTTP ${response.status} ${await response.text()}`);
  const cookie = response.headers.getSetCookie().map(c => c.split(';')[0]).filter(c => c.includes('session_token')).join('; ');
  return { cookie, xff };
}

/** Runs `work` over `items` with at most `limit` in flight. */
export async function pool<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await work(items[i], i); }
  }));
  return results;
}

export function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : NaN);
  const round = (v: number) => Math.round(v * 10) / 10;
  return { n: sorted.length, p50: round(at(50)), p75: round(at(75)), p95: round(at(95)), p99: round(at(99)), max: round(sorted.at(-1) ?? NaN), mean: round(sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1)) };
}
export const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)];
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
