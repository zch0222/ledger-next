import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { choose as pick, ledger, password, test, user } from './helpers';

// The radios are visually hidden as in the prototype; users press the visible label.
async function choose(page: Page, name: string) {
  await page
    .getByRole('dialog')
    .locator('label')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .click();
  await expect(page.getByRole('radio', { name, exact: true })).toBeChecked();
}

test('registration → new ledger → reload → second ledger → sign out', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: '第一次使用？创建账号' }).click();
  await page.getByLabel('称呼').fill('小林');
  await page.getByLabel('邮箱', { exact: true }).fill(`ui-${randomUUID()}@example.test`);
  await page.getByLabel('密码（至少 12 位）').fill(password);
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  await expect(page.getByRole('heading', { name: '从一本新账本开始' })).toBeVisible();
  await page.getByLabel('账本名称').fill('我的家庭账本');
  await page.getByRole('button', { name: '创建账本', exact: true }).click();
  // Onboarding step 2: the first account (can be postponed).
  await expect(page.getByRole('heading', { name: '添加首个账户' })).toBeVisible();
  await page.getByRole('button', { name: '稍后再说' }).click();
  await expect(page.getByRole('heading', { name: '本月，收支一目了然' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('切换账本')).toContainText('我的家庭账本');
  await page.getByLabel('切换账本').click();
  await page.getByRole('menuitem', { name: '新建账本' }).click();
  await page.getByLabel('账本名称').fill('旅行基金');
  await pick(page.getByLabel('基准币种'), 'HKD');
  await page.getByRole('button', { name: '创建账本', exact: true }).click();
  await page.getByLabel('账户名称').fill('港币现金');
  await pick(page.getByLabel('结算币种'), 'HKD');
  await page.getByLabel(/期初余额/).fill('100');
  await page.getByRole('button', { name: '保存账户' }).click();
  await expect(page.getByLabel('切换账本')).toContainText('旅行基金');
  await expect(page.getByRole('heading', { name: '本月，收支一目了然' })).toBeVisible();
  await page.goto(page.url().replace(/\/dashboard.*$/, '/settings'));
  await page.getByRole('button', { name: '退出当前账号' }).click();
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
  await page.goto('/');
  await expect(page).toHaveURL(/login/);
});
test('prototype shell, theme persistence, responsive widths and SSR privacy', async ({ page, context }, testInfo) => {
  const u = await user('visual');
  const book = await ledger(u.client);
  await context.addCookies((await u.client.storageState()).cookies);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`/ledgers/${book.id}/dashboard`);
  await page.getByRole('button', { name: '外观：显示模式与主题色' }).click();
  await choose(page, '深色');
  await choose(page, '紫罗兰');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // The device copy shows first; the account copy catches up (other devices read it on their next page load).
  await expect
    .poll(async () => (await (await page.request.get('/api/v1/me/preferences')).json()).data.appearance.themeMode)
    .toBe('dark');
  await page.screenshot({ path: `test-results/${testInfo.project.name}-dark.png`, fullPage: true });
  await page.getByRole('button', { name: '外观：显示模式与主题色' }).click();
  await page.getByRole('button', { name: '恢复默认' }).click();
  await choose(page, '浅色');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  for (const width of [360, 390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `No page overflow at ${width}px`,
    ).toBeTruthy();
    if (width >= 1200) {
      expect((await page.locator('.sidebar').boundingBox())?.width).toBe(224);
      expect((await page.locator('.topbar').boundingBox())?.height).toBe(82);
    }
    if (width < 768) {
      await expect(page.locator('.sidebar')).toBeHidden();
      await expect(page.getByRole('navigation', { name: '移动导航' })).toBeVisible();
      expect((await page.locator('.topbar').boundingBox())?.height).toBe(70);
    }
    await page.screenshot({ path: `test-results/${testInfo.project.name}-${width}.png`, fullPage: true });
  }
  const legacy = await u.client.get(`/?ledger=${book.id}&view=analytics`, { maxRedirects: 0 });
  expect(legacy.headers().location).toContain(`/ledgers/${book.id}/analytics`);
  const html = await u.client.get(`/ledgers/${book.id}/dashboard`);
  expect(await html.text()).toContain('本月，收支一目了然');
  expect(html.headers()['cache-control']).toContain('private');
  expect(errors).toEqual([]);
  await u.client.dispose();
});
test('member UI enforces last-owner error and persists a new viewer', async ({ page, context }) => {
  const owner = await user('owner-ui');
  const viewer = await user('member-ui');
  const book = await ledger(owner.client);
  await context.addCookies((await owner.client.storageState()).cookies);
  await page.goto(`/ledgers/${book.id}/settings`);
  await pick(page.getByLabel(`${owner.email} 的角色`), '仅查看');
  await expect(page.getByRole('alert').filter({ hasText: '至少需要保留一位所有者' })).toBeVisible();
  await page.getByLabel('成员邮箱').fill(viewer.email);
  await page.getByRole('button', { name: '添加成员', exact: true }).click();
  await expect(page.getByText(viewer.email, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(`${viewer.email} 的角色`)).toContainText('仅查看');
  await owner.client.dispose();
  await viewer.client.dispose();
});
