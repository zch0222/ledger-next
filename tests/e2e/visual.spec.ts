import { gzipSync } from 'node:zlib';
import AxeBuilder from '@axe-core/playwright';
import { expect, type APIRequestContext, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { book, clientIp, origin, test } from './helpers';

// M4-DASH / M4-THEME / M4-RESP: charts, appearance and the responsive / accessibility matrix.
const mobile = (info: TestInfo) => info.project.name === 'mobile';
type Book = Awaited<ReturnType<typeof book>>;
async function signIn(context: BrowserContext, b: Book) { await context.addCookies((await b.client.storageState()).cookies); }
async function setAppearance(client: APIRequestContext, appearance: { themeMode?: string; accent?: { type: string; value: string } }) {
  const current = (await (await client.get('/api/v1/me/preferences')).json()).data;
  const response = await client.patch('/api/v1/me/preferences', { data: { appearance }, headers: { 'If-Match': `"v${current.version}"` } });
  expect(response.status(), await response.text()).toBe(200);
}
/** A ledger with income, categorised expenses, a refund, a subscription and a budget. */
async function richBook(prefix: string) {
  const b = await book(prefix, '2000');
  await b.record({ kind: 'income', accountId: b.cash.id, settlement: { amount: '5000.00', currency: 'CNY' }, merchant: '工资' });
  const dinner = await b.record({ kind: 'expense', accountId: b.cash.id, settlement: { amount: '80.00', currency: 'CNY' }, categoryId: b.food.id, merchant: '晚餐' });
  await b.record({ kind: 'expense', accountId: b.cash.id, settlement: { amount: '50.00', currency: 'CNY' }, categoryId: b.food.id, merchant: '午餐' });
  await b.record({ kind: 'expense', accountId: b.cash.id, settlement: { amount: '30.00', currency: 'CNY' }, categoryId: b.traffic.id, merchant: '地铁' });
  await b.record({ kind: 'refund', originalTransactionId: dinner.id, accountId: b.cash.id, settlement: { amount: '10.00', currency: 'CNY' } });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date());
  const preview = await b.post('/subscription-previews', { name: '视频会员', amount: { amount: '25.00', currency: 'CNY' }, cycle: { unit: 'month', count: 1 }, anchorDate: today, timezone: 'Asia/Hong_Kong', accountId: b.cash.id });
  await b.post('/subscriptions', { previewId: preview.previewId }, { 'Idempotency-Key': crypto.randomUUID() });
  await b.post('/budgets', { period: 'month', amount: { amount: '200.00', currency: 'CNY' }, startDate: `${today.slice(0, 7)}-01` });
  return { ...b, dinner, today };
}
const chart = (page: Page, type: string) => page.locator(`.echart[data-chart="${type}"]`);
async function chartState(page: Page, type: string) {
  await expect(chart(page, type)).toHaveAttribute('data-chart-instance', /.+/);
  return { id: await chart(page, type).getAttribute('data-chart-instance'), renders: Number(await chart(page, type).getAttribute('data-chart-renders')) };
}
const sumOfRows = (texts: string[]) => texts.reduce((total, t) => total + (t.startsWith('−') ? -1 : 1) * Number(t.replace(/[^\d.]/g, '')), 0);

test('dashboard: server-rendered numbers, totals match the drilled details, charts update in place and clean up', async ({ page, context, browser }, info) => {
  const b = await richBook('dash-ui'); await signIn(context, b);
  // Without any JavaScript the KPIs and the data behind every chart are readable.
  const noJs = await browser.newContext({ javaScriptEnabled: false, extraHTTPHeaders: { 'X-Forwarded-For': clientIp() } });
  await noJs.addCookies((await b.client.storageState()).cookies);
  const plain = await noJs.newPage();
  await plain.goto(`/ledgers/${b.ledger.id}/dashboard`);
  const metric = (p: Page, label: string) => p.locator('.metric').filter({ hasText: label }).locator('.value');
  await expect(metric(plain, '本月支出')).toHaveText('¥150.00'); // 80 + 50 + 30 − 10 refund
  await expect(metric(plain, '本月收入')).toHaveText('¥5,000.00');
  await expect(metric(plain, '本月结余')).toHaveText('¥4,850.00');
  await expect(plain.locator('.chart-data table td').filter({ hasText: '¥150.00' }).first()).toBeAttached();
  await expect(plain.locator('.chart-data .category').filter({ hasText: '餐饮' })).toContainText('¥120.00');
  await noJs.close();

  await page.goto(`/ledgers/${b.ledger.id}/dashboard`);
  const trend = await chartState(page, 'trend');
  await page.getByRole('button', { name: '收支对比' }).click();
  await expect(chart(page, 'trend')).toHaveAttribute('data-chart-renders', String(trend.renders + 1));
  expect((await chartState(page, 'trend')).id).toBe(trend.id); // same instance, setOption update
  await expect(page.getByRole('button', { name: '收支对比' })).toHaveAttribute('aria-pressed', 'true');

  // Keyboard drill-down from the accessible category list keeps the period; the list adds up to the category total.
  await page.getByText('查看分类数据与明细').click();
  const food = page.locator('.chart-data .category a').filter({ hasText: '餐饮' });
  await food.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/transactions\\?dateFrom=${b.today.slice(0, 7)}-01&dateTo=.*categoryId=${b.food.id}`));
  await expect(page.getByLabel('分类筛选')).toHaveValue(b.food.id);
  const amounts = await page.locator('table.transactions .amount').allTextContents();
  expect(sumOfRows(amounts)).toBeCloseTo(-120, 2);
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Trend data table drills into the bucket's dates.
  await page.getByText('查看数据表与明细').click();
  await page.locator('.chart-data table a').first().click();
  await expect(page).toHaveURL(/transactions\?dateFrom=\d{4}-\d{2}-\d{2}&dateTo=\d{4}-\d{2}-\d{2}$/);
  await page.goBack();

  // Theme changes reuse the instance; data colours do not follow the accent.
  const tokens = () => page.evaluate(() => ['--positive', '--warn', '--danger', '--blue', '--cat-food', '--cat-home'].map(t => getComputedStyle(document.documentElement).getPropertyValue(t).trim()));
  const before = await tokens(), current = await chartState(page, 'trend');
  await page.getByRole('button', { name: '外观：显示模式与主题色' }).click();
  await page.getByRole('dialog').locator('label').filter({ hasText: /^紫罗兰$/ }).click();
  await expect(chart(page, 'trend')).toHaveAttribute('data-chart-renders', String(current.renders + 1));
  expect(await tokens()).toEqual(before);
  await page.getByRole('dialog').locator('label').filter({ hasText: /^深色$/ }).click();
  await expect(chart(page, 'trend')).toHaveAttribute('data-chart-renders', String(current.renders + 2));
  expect((await chartState(page, 'trend')).id).toBe(current.id);
  await page.getByRole('button', { name: '完成', exact: true }).click();

  // Leaving the page disposes every instance; coming back creates fresh ones.
  if (mobile(info)) await page.getByRole('navigation', { name: '移动导航' }).getByRole('link', { name: '账目' }).click();
  else await page.getByRole('navigation', { name: '主要导航' }).getByRole('link', { name: '账目' }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  expect(await page.locator('[_echarts_instance_]').count()).toBe(0);
  await page.goBack();
  expect((await chartState(page, 'trend')).id).not.toBe(current.id);
  await b.client.dispose();
});

test('analytics: budget progress, composition and valuation switch with drill-down', async ({ page, context }) => {
  const b = await richBook('analytics-ui'); await signIn(context, b);
  await page.goto(`/ledgers/${b.ledger.id}/analytics`);
  const budget = page.locator('.budget').first();
  await expect(budget).toContainText('¥150.00');
  await expect(budget).toContainText('/ ¥200.00');
  await expect(budget.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
  await expect(budget).toContainText('已用 75%');
  const legend = page.getByLabel('支出分类数据与明细');
  await expect(legend.getByRole('link', { name: /餐饮/ })).toContainText('¥120.00');
  await expect(legend.getByRole('link', { name: /餐饮/ })).toContainText('80.0%');
  await expect(legend.getByRole('link', { name: /交通/ })).toContainText('20.0%');
  await chartState(page, 'composition');
  await page.getByRole('link', { name: '当前估值' }).click();
  await expect(page).toHaveURL(/valuation=current/);
  await expect(page.getByText(/按当前参考汇率估值/)).toBeVisible();
  await page.getByRole('link', { name: '历史入账' }).click();
  await budget.getByRole('link', { name: '查看明细 →' }).click();
  await expect(page).toHaveURL(/transactions\?dateFrom=.*&kind=expense/);
  await page.goBack();
  await page.getByRole('button', { name: '＋ 新建预算' }).click();
  const form = page.getByRole('dialog', { name: '新建预算' });
  await form.getByLabel('范围').selectOption({ label: '交通（含子分类）' });
  await form.getByLabel(/金额/).fill('20');
  await form.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.budget').filter({ hasText: '交通' })).toContainText('已超出');
  await b.client.dispose();
});

test('appearance: six first-frame combinations, live system follow, failed sync stays on this device', async ({ page, context, browser }) => {
  const b = await book('theme-ui'); await signIn(context, b);
  const url = `/ledgers/${b.ledger.id}/dashboard`;
  // Records the state at DOMContentLoaded, before hydration can change anything.
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    (window as unknown as { first: unknown }).first = { theme: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor };
  }));
  for (const mode of ['light', 'dark', 'system'] as const) {
    await setAppearance(b.client, { themeMode: mode });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(url);
      const first = await page.evaluate(() => (window as unknown as { first: { theme: string | null; bg: string } }).first);
      const dark = (mode === 'system' ? scheme : mode) === 'dark';
      expect(first, `${mode} × system ${scheme}`).toEqual({ theme: mode === 'system' ? null : mode, bg: dark ? 'rgb(17, 24, 27)' : 'rgb(245, 246, 248)' });
    }
  }
  // Following the system: the page and the chart switch without a reload.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(url);
  const state = await chartState(page, 'trend');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(17, 24, 27)');
  await expect(chart(page, 'trend')).not.toHaveAttribute('data-chart-renders', String(state.renders));

  // Saving fails: the choice applies on this device, says so, and survives a reload until it syncs.
  await page.route('**/api/v1/me/preferences', route => (route.request().method() === 'PATCH' ? route.abort() : route.continue()));
  await page.getByRole('button', { name: '外观：显示模式与主题色' }).click();
  await page.getByRole('dialog').locator('label').filter({ hasText: /^浅色$/ }).click();
  await expect(page.getByText('未同步到账号，仅本设备生效。')).toBeVisible();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect((await (await b.client.get('/api/v1/me/preferences')).json()).data.appearance.themeMode).toBe('system');
  await page.unroute('**/api/v1/me/preferences');
  await page.reload();
  await expect.poll(async () => (await (await b.client.get('/api/v1/me/preferences')).json()).data.appearance.themeMode).toBe('light');

  // Another device (no local cookie) picks the account preference up on its first frame.
  const other = await browser.newContext({ colorScheme: 'dark', extraHTTPHeaders: { 'X-Forwarded-For': clientIp() } });
  await other.addCookies((await b.client.storageState()).cookies);
  const second = await other.newPage();
  await second.goto(`${origin}${url}`);
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'light');
  await other.close();

  // Invalid colours are rejected and never stored.
  const version = (await (await b.client.get('/api/v1/me/preferences')).json()).data.version;
  expect((await b.client.patch('/api/v1/me/preferences', { data: { appearance: { accent: { type: 'custom', value: 'red' } } }, headers: { 'If-Match': `"v${version}"` } })).status()).toBe(422);
  expect((await b.client.patch('/api/v1/me/preferences', { data: { appearance: { accent: { type: 'preset', value: 'neon' } } }, headers: { 'If-Match': `"v${version}"` } })).status()).toBe(422);
  expect((await (await b.client.get('/api/v1/me/preferences')).json()).data.version).toBe(version);
  await b.client.dispose();
});

test('responsive and accessible: every page × widths × modes, touch targets, reduced motion', async ({ page, context }, info) => {
  test.setTimeout(240_000);
  const b = await richBook('resp-ui'); await signIn(context, b);
  // Populated P07 / P08: a tested Telegram channel, an unverified e-mail channel, a rule and its deliveries.
  const tg = (await (await b.client.post('/api/v1/notification-channels', { data: { name: '家庭群 Telegram', config: { type: 'telegram', botToken: `987654321:${'x'.repeat(30)}`, chatId: String(Date.now()) } } })).json()).data;
  await b.client.post('/api/v1/notification-channels', { data: { name: '工作邮箱', config: { type: 'email', address: `resp-${Date.now()}@example.test` } } });
  await b.client.post(`/api/v1/notification-channels/${tg.id}/test-deliveries`, { data: {}, headers: { 'Idempotency-Key': crypto.randomUUID() } });
  const rp = (await (await b.client.post(`${b.base}/reminder-previews`, { data: { eventType: 'weekly_summary', localTime: '09:00', timezone: 'Asia/Hong_Kong', quietHours: { start: '22:00', end: '08:00' }, channelIds: [tg.id] } })).json()).data;
  await b.client.post(`${b.base}/reminder-rules`, { data: { previewId: rp.previewId }, headers: { 'Idempotency-Key': crypto.randomUUID() } });
  const l = `/ledgers/${b.ledger.id}`;
  const pages = ['/dashboard', '/transactions', `/transactions?tx=${b.dinner.id}`, '/subscriptions', '/subscriptions?view=list', '/subscriptions?view=calendar', '/analytics', '/accounts', '/reminders', '/reminders?tab=deliveries', '/reminders?tab=inbox', '/agents',
    '/settings', '/settings/currencies', '/settings/data', '/settings/channels', '/settings/appearance', '/more'].map(p => l + p).concat(['/onboarding']);
  const widths = mobile(info) ? [360, 390, 640] : [768, 1440, 1920]; // 640 = 1280px at 200% zoom
  const overflow: string[] = [], violations: string[] = [], small: string[] = [];
  for (const [mode, accent] of [['light', 'teal'], ['dark', 'teal'], ['dark', 'violet'], ['system', 'rose']] as const) {
    await setAppearance(b.client, { themeMode: mode, accent: { type: 'preset', value: accent } });
    for (const scheme of mode === 'system' ? ['light', 'dark'] as const : ['light'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of widths) {
        await page.setViewportSize({ width, height: mobile(info) ? 844 : 1000 });
        for (const path of pages) {
          await page.goto(path);
          await page.locator('main h1, .auth-page h1').first().waitFor();
          if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) overflow.push(`${path} @${width} ${mode}/${scheme}`);
          // Contrast and the rest of WCAG A/AA once per page and colour setting (axe needs a stable, animation-free page).
          if (width === widths[1]) {
            await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => undefined))));
            const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).exclude('.echart').analyze();
            for (const v of result.violations) violations.push(`${path} ${mode}/${scheme}/${accent}: ${v.id} — ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
            if (mobile(info) && mode === 'light') small.push(...(await page.evaluate(() => {
              const hits: string[] = [];
              for (const el of document.querySelectorAll<HTMLElement>('button, select, input:not([type=hidden]), a.button, [role=tab], nav a, summary, .legend-row')) {
                const box = (el.matches('input[type=radio], input[type=checkbox]') ? el.closest('label') ?? el : el).getBoundingClientRect();
                const style = getComputedStyle(el);
                if (!box.width || style.visibility === 'hidden' || el.closest('[hidden], dialog:not([open])')) continue;
                if (box.height < 44 || box.width < 44) hits.push(`${(el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 20)} ${Math.round(box.width)}×${Math.round(box.height)}`);
              }
              return hits;
            })).map(hit => `${path}: ${hit}`));
          }
        }
      }
    }
  }
  expect(overflow, 'pages overflow horizontally').toEqual([]);
  expect(violations, 'axe WCAG A/AA violations').toEqual([]);
  expect([...new Set(small)], 'touch targets under 44×44').toEqual([]);

  // Reduced motion, switched on while the page is open: charts stop animating, CSS motion is off.
  await setAppearance(b.client, { themeMode: 'system', accent: { type: 'preset', value: 'teal' } });
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await page.goto(`${l}/dashboard`);
  await expect(chart(page, 'trend')).toHaveAttribute('data-chart-animation', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(chart(page, 'trend')).toHaveAttribute('data-chart-animation', 'false');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.page-enter')!).animationName)).toBe('none');
  // Resizing a chart container neither replays the page entrance nor clips money labels.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`${l}/dashboard`);
  await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => undefined))));
  await page.setViewportSize({ width: mobile(info) ? 360 : 1100, height: 900 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.getAnimations().filter(a => a instanceof CSSAnimation && a.animationName.startsWith('page')).length)).toBe(0);
  const clipped = await chart(page, 'categories').evaluate(el => {
    const svg = el.querySelector('svg')!.getBoundingClientRect();
    return [...el.querySelectorAll('text')].filter(t => /¥|CNY/.test(t.textContent ?? '')).map(t => t.getBoundingClientRect()).filter(r => r.right > svg.right + 1 || r.left < svg.left - 1).length;
  });
  expect(clipped).toBe(0);
  if (mobile(info)) {
    // Touch: tapping the first category's bar (drawn in the fixed 餐饮 data colour) drills into that category.
    await chart(page, 'categories').scrollIntoViewIfNeeded();
    const fill = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cat-food').trim().toLowerCase());
    const box = (await chart(page, 'categories').locator(`path[fill="${fill}"]`).first().boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page).toHaveURL(/categoryId=/);
  }
  await b.client.dispose();
});

test('first-screen JavaScript stays within budget; ECharts loads later in its own chunk', async ({ page, context }, info) => {
  test.skip(mobile(info), 'measured once');
  const b = await richBook('budget-ui'); await signIn(context, b);
  const scripts = new Map<string, number>();
  let chartChunk: string | null = null;
  page.on('response', async response => {
    if (response.request().resourceType() !== 'script') return;
    const body = await response.body().catch(() => null);
    if (!body) return;
    scripts.set(response.url(), gzipSync(body).length);
    if (body.includes('_echarts_instance_')) chartChunk = response.url();
  });
  const html = await (await b.client.get(`/ledgers/${b.ledger.id}/dashboard`)).text();
  const initial = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => new URL(m[1], origin).pathname);
  await page.goto(`/ledgers/${b.ledger.id}/dashboard`);
  await chartState(page, 'trend');
  expect(chartChunk, 'the chart library is fetched after the first screen').not.toBeNull();
  expect(initial.some(p => chartChunk!.includes(p))).toBe(false);
  const total = initial.reduce((sum, path) => sum + ([...scripts].find(([url]) => url.includes(path))?.[1] ?? 0), 0);
  info.annotations.push({ type: 'first-screen-js-gzip', description: `${(total / 1024).toFixed(1)} KiB in ${initial.length} scripts; chart chunk ${((scripts.get(chartChunk!) ?? 0) / 1024).toFixed(1)} KiB` });
  console.log(`first-screen JS gzip ${(total / 1024).toFixed(1)} KiB (${initial.length} scripts); chart chunk ${((scripts.get(chartChunk!) ?? 0) / 1024).toFixed(1)} KiB`);
  expect(total).toBeLessThanOrEqual(180 * 1024); // TECHNICAL_DESIGN §7.3: ≤180 KiB gzip for own code; this counts the framework too
  await b.client.dispose();
});
