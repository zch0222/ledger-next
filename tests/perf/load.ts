import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Redis } from 'ioredis';
import mysql from 'mysql2/promise';
import { call, data, ok, OUT, pick, pool, sleep, stats, type Session } from './lib';

/**
 * M7-PERF load (TECHNICAL_DESIGN §7.3): cold / hot report aggregation on the 100k ledger, cold / hot dashboard TTFB,
 * then PERF_VUS virtual users (default 100) for PERF_SECONDS (default 600) with 80 % reads / 20 % writes, closed loop
 * without think time, each request as a random seeded user. During the run: FX source age sampling and reminders
 * that fall due, for scheduling delay. "Cold" means the report cache in Redis was cleared; MySQL stays warm.
 */
type User = Session & { ledgerId: string; base: string; accountId: string; categoryId?: string };
const seed = JSON.parse(readFileSync(`${OUT}/seed.json`, 'utf8')) as { big: User; users: User[] };
const VUS = Number(process.env.PERF_VUS ?? 100), SECONDS = Number(process.env.PERF_SECONDS ?? 600), RUNS = Number(process.env.PERF_COLD_RUNS ?? 20);
const TZ = 'Asia/Hong_Kong';
const redis = new Redis(process.env.REDIS_URL!);
async function flushReports() {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'report:v1:*', 'COUNT', 1000);
    if (keys.length) await redis.del(...keys);
    cursor = next;
  } while (cursor !== '0');
}
const local = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const today = local(new Date()), monthStart = `${today.slice(0, 7)}-01`;
const nextMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1)).toISOString().slice(0, 10);
const yearStart = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 12, 1)).toISOString().slice(0, 10);
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), config: { VUS, SECONDS, RUNS, users: seed.users.length } };

// 1. Reminders falling due during the mixed run (every 10th user, 2–8 minutes from now).
const reminderUsers = process.env.PERF_SKIP_REMINDERS ? [] : seed.users.filter((_, i) => i % 10 === 0);
const ruleIds = await pool(reminderUsers, 10, async (u, i) => {
  const channels = data<{ id: string; type: string }[]>(ok(await call(u, 'GET', '/api/v1/notification-channels'), 'channels'));
  const at = new Date(Date.now() + (2 + (i % 7)) * 60_000);
  const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
  const preview = data<{ previewId: string }>(ok(await call(u, 'POST', `${u.base}/reminder-previews`, { eventType: 'daily_entry', localTime, timezone: TZ, channelIds: [channels.find(c => c.type === 'in_app')!.id] }), 'reminder preview'));
  return data<{ id: string }>(ok(await call(u, 'POST', `${u.base}/reminder-rules`, { previewId: preview.previewId }, { 'Idempotency-Key': randomUUID() }), 'reminder')).id;
});
console.error(`reminders: ${ruleIds.length} rules due in 2–8 minutes`);

// 2. Twelve-month aggregation on the large ledger, cold then hot.
const big = seed.big, cold: Record<string, number[]> = {}, hot: Record<string, number[]> = {};
const aggregations = {
  summary: `${big.base}/reports/summary?dateFrom=${yearStart}&dateTo=${nextMonth}`,
  cashFlow: `${big.base}/reports/cash-flow?dateFrom=${yearStart}&dateTo=${nextMonth}&interval=month`,
  categories: `${big.base}/reports/category-breakdown?dateFrom=${yearStart}&dateTo=${nextMonth}`,
};
for (let run = 0; run < RUNS; run++) {
  await flushReports();
  for (const [name, path] of Object.entries(aggregations)) (cold[name] ??= []).push(ok(await call(big, 'GET', path), name).ms);
  for (const [name, path] of Object.entries(aggregations)) (hot[name] ??= []).push(ok(await call(big, 'GET', path), name).ms);
}
// 3. Dashboard TTFB (server-rendered, signed in), cold then hot, for the large ledger and random small ones.
// TTFB (headers) and full HTML (the streamed page including every server-rendered section).
const dash: Record<string, number[]> = {};
const page = async (key: string, u: User) => { const r = ok(await call(u, 'GET', `/ledgers/${u.ledgerId}/dashboard`), 'dashboard'); (dash[key] ??= []).push(r.ms); (dash[`${key}Full`] ??= []).push(r.total); };
for (let run = 0; run < RUNS; run++) {
  await flushReports();
  await page('bigCold', big); await page('bigHot', big);
  const u = pick(seed.users);
  await page('smallCold', u); await page('smallHot', u);
}
report.aggregation12m = { cold: Object.fromEntries(Object.entries(cold).map(([k, v]) => [k, stats(v)])), hot: Object.fromEntries(Object.entries(hot).map(([k, v]) => [k, stats(v)])) };
report.dashboardTtfb = Object.fromEntries(Object.entries(dash).map(([k, v]) => [k, stats(v)]));
console.error('cold / hot phase done');

// 4. Mixed closed-loop load.
type Op = { name: string; weight: number; run: (u: User) => Promise<void> };
const samples: Record<string, number[]> = {}, errors: Record<string, number> = {}, counts: Record<string, number> = {};
const record = (name: string, result: { status: number; ms: number }) => {
  counts[name] = (counts[name] ?? 0) + 1;
  if (result.status >= 400 || result.status === 0) errors[name] = (errors[name] ?? 0) + 1; else (samples[name] ??= []).push(result.ms);
};
const ops: Op[] = [
  { name: 'page.dashboard', weight: 25, run: async u => { const r = await call(u, 'GET', `/ledgers/${u.ledgerId}/dashboard`); record('page.dashboard', r); if (r.status < 400) (samples['page.dashboard.full'] ??= []).push(r.total); } },
  { name: 'page.transactions', weight: 10, run: async u => record('page.transactions', await call(u, 'GET', `/ledgers/${u.ledgerId}/transactions`)) },
  { name: 'api.transactions', weight: 20, run: async u => record('api.transactions', await call(u, 'GET', `${u.base}/transactions?limit=50`)) },
  { name: 'api.summary', weight: 15, run: async u => record('api.summary', await call(u, 'GET', `${u.base}/reports/summary?dateFrom=${monthStart}&dateTo=${nextMonth}`)) },
  { name: 'api.accounts', weight: 10, run: async u => record('api.accounts', await call(u, 'GET', `${u.base}/accounts`)) },
  { name: 'api.write', weight: 20, run: async u => {
    const preview = await call(u, 'POST', `${u.base}/transaction-previews`, { kind: 'expense', accountId: u.accountId, ...(u.categoryId ? { categoryId: u.categoryId } : {}), settlement: { amount: (1 + Math.random() * 99).toFixed(2), currency: 'CNY' }, occurredAt: new Date(Date.now() - 60_000).toISOString(), timezone: TZ });
    record('api.preview', preview);
    if (preview.status !== 201) return;
    record('api.create', await call(u, 'POST', `${u.base}/transactions`, { previewId: data<{ previewId: string }>(preview).previewId }, { 'Idempotency-Key': randomUUID() }));
  } },
];
const total = ops.reduce((a, o) => a + o.weight, 0);
const choose = () => { let r = Math.random() * total; for (const op of ops) { if ((r -= op.weight) < 0) return op; } return ops[0]; };
const fxAge: number[] = [], fxFreshness: Record<string, number> = {};
/** One mixed run: VUS users in a closed loop; with `thinkMs` each user pauses 0.5–1.5 × thinkMs between actions. */
async function mixed(seconds: number, thinkMs: number) {
  for (const k of Object.keys(samples)) delete samples[k];
  for (const k of Object.keys(errors)) delete errors[k];
  for (const k of Object.keys(counts)) delete counts[k];
  const deadline = Date.now() + seconds * 1000;
  const sampler = (async () => {
    while (Date.now() < deadline) {
      const r = await call(seed.users[0], 'GET', '/api/v1/exchange-rates?base=USD&quotes=CNY,HKD,EUR,JPY');
      if (r.status === 200) for (const rate of data<{ rates: { sourceAt: string | null; freshness: string }[] }>(r).rates) {
        fxFreshness[rate.freshness] = (fxFreshness[rate.freshness] ?? 0) + 1;
        if (rate.sourceAt) fxAge.push((Date.now() - Date.parse(rate.sourceAt)) / 1000);
      }
      await sleep(10_000);
    }
  })();
  const started = Date.now();
  await Promise.all(Array.from({ length: VUS }, async (_, i) => {
    if (thinkMs) await sleep(Math.random() * thinkMs * (i % 10) / 10); // stagger the start
    while (Date.now() < deadline) {
      try { await choose().run(pick(seed.users)); } catch (error) { errors.exception = (errors.exception ?? 0) + 1; if ((errors.exception ?? 0) < 5) console.error(error); }
      if (thinkMs) await sleep(thinkMs * (0.5 + Math.random()));
    }
  }));
  await sampler;
  const elapsed = (Date.now() - started) / 1000;
  const requests = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    seconds: Math.round(elapsed), thinkMs, requests, throughputPerSecond: Math.round(requests / elapsed),
    readShare: Math.round(100 * (requests - (counts['api.preview'] ?? 0) - (counts['api.create'] ?? 0)) / requests),
    ops: Object.fromEntries(Object.keys(counts).filter(name => name !== 'page.dashboard.full').sort().map(name => [name, { ...stats(samples[name] ?? []), requests: counts[name], errors: errors[name] ?? 0, errorRate: Number(((errors[name] ?? 0) / counts[name] * 100).toFixed(3)) }])),
    exceptions: errors.exception ?? 0,
    dashboardFull: stats(samples['page.dashboard.full'] ?? []),
  };
}
// Stress: no think time, so 100 requests are always in flight. User model: 100 concurrent users who read before acting.
report.mixed = await mixed(SECONDS, 0);
console.error(`mixed load (stress) done: ${(report.mixed as { requests: number }).requests} requests`);
report.mixedUsers = await mixed(Number(process.env.PERF_USER_SECONDS ?? 300), Number(process.env.PERF_THINK_MS ?? 2000));
console.error(`mixed load (user model) done: ${(report.mixedUsers as { requests: number }).requests} requests`);
report.fx = { sourceAgeSeconds: stats(fxAge), freshness: fxFreshness };

// 5. Reminder scheduling delay: scheduled_at → first attempt, for the rules created above.
const db = await mysql.createConnection(process.env.DATABASE_URL!);
const waitUntil = Date.now() + 10 * 60_000;
let delays: number[] = [], pending = ruleIds.length;
while (ruleIds.length && Date.now() < waitUntil) {
  const [rows] = await db.query(`SELECT d.status, TIMESTAMPDIFF(MICROSECOND, d.scheduled_at, MIN(a.started_at)) / 1e6 AS delay FROM notification_deliveries d LEFT JOIN notification_attempts a ON a.delivery_id = d.id
    WHERE d.rule_id IN (?) AND d.scheduled_at <= UTC_TIMESTAMP(3) GROUP BY d.id, d.status, d.scheduled_at`, [ruleIds]) as [{ status: string; delay: string | null }[], unknown];
  delays = rows.filter(r => r.delay !== null).map(r => Number(r.delay));
  pending = ruleIds.length - delays.length;
  if (rows.length >= ruleIds.length && pending === 0) break;
  await sleep(15_000);
}
report.reminders = { rules: ruleIds.length, measured: delays.length, pending, delaySeconds: stats(delays) };
const [[size]] = await db.query(`SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 1) AS mb, SUM(table_rows) AS rows_estimate FROM information_schema.tables WHERE table_schema = DATABASE()`) as [{ mb: string; rows_estimate: string }[], unknown];
const [[tx]] = await db.query('SELECT COUNT(*) AS n FROM transactions') as [{ n: number }[], unknown];
report.database = { sizeMb: Number(size.mb), rowsEstimate: Number(size.rows_estimate), transactions: Number(tx.n) };
await db.end(); await redis.quit();
report.finishedAt = new Date().toISOString();
writeFileSync(`${OUT}/load.json`, `${JSON.stringify(report, null, 2)}\n`);
console.error('load report written');
