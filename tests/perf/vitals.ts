import { readFileSync, writeFileSync } from 'node:fs';
import { chromium, devices, type BrowserContext, type Page } from '@playwright/test';
import { BASE, OUT, stats } from './lib';

/**
 * M7-PERF browser measurements (TECHNICAL_DESIGN §7.3): PERF_VITALS_RUNS (default 20) controlled loads per page on a
 * Pixel 7 profile with "slow 4G" (150 ms RTT, 1.6 Mbps down, 750 kbps up) and 4× CPU slowdown; LCP / CLS from the
 * browser's own entries, INP from the slowest event timing of one real interaction. Then chart lifecycle: repeated
 * client-side navigation must not accumulate ECharts instances, and reduced motion must turn chart animation off.
 * Laboratory data, not RUM.
 */
type User = { cookie: string; ledgerId: string };
const seed = JSON.parse(readFileSync(`${OUT}/seed.json`, 'utf8')) as { big: User; users: User[] };
const RUNS = Number(process.env.PERF_VITALS_RUNS ?? 20);
const host = new URL(BASE).hostname;
const cookies = (u: User) => u.cookie.split('; ').map(pair => { const i = pair.indexOf('='); return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: host, path: '/', httpOnly: true, sameSite: 'Lax' as const }; });

const observe = () => {
  const w = window as unknown as { __lcp: number; __cls: number; __inp: number };
  w.__lcp = 0; w.__cls = 0; w.__inp = 0;
  new PerformanceObserver(list => { for (const e of list.getEntries()) w.__lcp = Math.max(w.__lcp, e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver(list => { for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) w.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver(list => { for (const e of list.getEntries() as (PerformanceEntry & { interactionId?: number })[]) if (e.interactionId) w.__inp = Math.max(w.__inp, e.duration); }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
};

async function throttled(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return cdp;
}

const browser = await chromium.launch(process.env.PERF_CHROMIUM ? { executablePath: process.env.PERF_CHROMIUM } : {});
const results: Record<string, { lcp: number[]; cls: number[]; inp: number[]; jsKb: number[]; lazyKb: number[] }> = {};
const pages = [
  { name: 'dashboard', path: (u: User) => `/ledgers/${u.ledgerId}/dashboard`, interact: (p: Page) => p.getByRole('button', { name: /记一笔/ }).first().click() },
  { name: 'transactions', path: (u: User) => `/ledgers/${u.ledgerId}/transactions`, interact: (p: Page) => p.getByLabel('搜索商家或备注').first().pressSequentially('餐') },
];
for (const target of pages) {
  const r: { lcp: number[]; cls: number[]; inp: number[]; jsKb: number[]; lazyKb: number[] } = (results[target.name] = { lcp: [], cls: [], inp: [], jsKb: [], lazyKb: [] });
  for (let run = 0; run < RUNS; run++) {
    const user = seed.users[run % seed.users.length];
    const context = await browser.newContext({ ...devices['Pixel 7'] });
    await context.addCookies(cookies(user));
    await context.addInitScript(observe);
    const page = await context.newPage();
    const cdp = await throttled(context, page);
    // Script bytes on the wire until the load event (first screen) and afterwards (lazy chunks such as ECharts).
    let js = 0, lazy = 0, loaded = false;
    const scripts = new Set<string>();
    cdp.on('Network.responseReceived', (e: { requestId: string; type: string }) => { if (e.type === 'Script') scripts.add(e.requestId); });
    cdp.on('Network.loadingFinished', (e: { encodedDataLength: number; requestId: string }) => { if (scripts.has(e.requestId)) { if (loaded) lazy += e.encodedDataLength; else js += e.encodedDataLength; } });
    await page.goto(`${BASE}${target.path(user)}`, { waitUntil: 'load', timeout: 120_000 });
    loaded = true;
    await page.waitForTimeout(2500);
    await target.interact(page).catch(() => undefined);
    await page.waitForTimeout(1000);
    const v = await page.evaluate(() => { const w = window as unknown as { __lcp: number; __cls: number; __inp: number }; return { lcp: w.__lcp, cls: w.__cls, inp: w.__inp }; });
    r.lcp.push(v.lcp); r.cls.push(Number(v.cls.toFixed(4))); r.inp.push(v.inp); r.jsKb.push(js / 1024); r.lazyKb.push(lazy / 1024);
    await context.close();
  }
}

// Chart lifecycle on a normal desktop profile: dashboard ↔ analytics by client-side navigation.
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies(cookies(seed.big));
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await page.goto(`${BASE}/ledgers/${seed.big.ledgerId}/dashboard`);
await page.locator('[data-chart-instance]').first().waitFor({ timeout: 60_000 });
const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return ((await cdp.send('Runtime.getHeapUsage')) as { usedSize: number }).usedSize / 1024 / 1024; };
const instances: number[] = [], heaps: number[] = [await heap()];
for (let i = 0; i < 20; i++) {
  await page.getByRole('link', { name: i % 2 ? /总览/ : /预算与分析/ }).first().click();
  await page.waitForURL(i % 2 ? /dashboard/ : /analytics/);
  await page.locator('[data-chart-instance]').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(400);
  instances.push(await page.evaluate(() => document.querySelectorAll('[_echarts_instance_]').length));
  if (i % 5 === 4) heaps.push(await heap());
}
await page.emulateMedia({ reducedMotion: 'reduce' });
let animation: string | null = null;
for (let i = 0; i < 20 && animation !== 'false'; i++) { await page.waitForTimeout(100); animation = await page.locator('[data-chart-animation]').first().getAttribute('data-chart-animation'); }
await browser.close();

const summary = {
  profile: 'Pixel 7 · slow 4G (150 ms RTT, 1.6 Mbps / 750 kbps) · CPU ×4 · Chromium (Playwright) · laboratory data',
  notes: 'inpMs 0 = every event of the interaction finished under the 16 ms reporting threshold; JS sizes are encoded (gzip / br) bytes on the wire',
  runs: RUNS,
  pages: Object.fromEntries(Object.entries(results).map(([name, r]) => [name, { lcpMs: stats(r.lcp), cls: stats(r.cls), inpMs: stats(r.inp), firstScreenJsKb: stats(r.jsKb), lazyJsKb: stats(r.lazyKb) }])),
  charts: { instancesPerPage: { min: Math.min(...instances), max: Math.max(...instances) }, heapMb: heaps.map(h => Number(h.toFixed(1))), reducedMotionAnimation: animation },
};
writeFileSync(`${OUT}/vitals.json`, `${JSON.stringify(summary, null, 2)}\n`);
console.error('vitals written');
