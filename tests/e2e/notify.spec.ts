import { randomBytes, randomUUID } from 'node:crypto';
import { expect, type BrowserContext } from '@playwright/test';
import { book, test } from './helpers';

// P07 提醒中心 / P08 提醒渠道 in the browser, against the real worker and the provider mocks.
const MOCK = process.env.MOCK_URL ?? 'http://127.0.0.1:4010';
const control = (service: string, body: Record<string, unknown>) => fetch(`${MOCK}/__control/channels`, { method: 'POST', body: JSON.stringify({ service, ...body }) });
const inbox = async (service: string) => (await (await fetch(`${MOCK}/__inbox/${service}`)).json()).messages as Record<string, unknown>[];
async function signIn(context: BrowserContext, b: Awaited<ReturnType<typeof book>>) { await context.addCookies((await b.client.storageState()).cookies); }
test.beforeEach(async () => { for (const s of ['telegram', 'smtp']) await control(s, { mode: 'ok', failNext: 0, delayMs: 0 }); });

test('channels: add, test for real, verify e-mail with its code; secrets never shown again', async ({ page, context }) => {
  const b = await book('channels-ui'); await signIn(context, b);
  const chatId = String(1_000_000_000 + Math.floor(Math.random() * 1e9)), token = `987654321:${randomBytes(18).toString('base64url')}`;
  await page.goto(`/ledgers/${b.ledger.id}/settings/channels`);
  await expect(page.getByRole('region', { name: '站内通知' })).toContainText('已启用');
  await expect(page.getByRole('region', { name: '个人微信（pushplus）' })).toContainText('未配置');
  await page.getByRole('button', { name: '添加Telegram渠道' }).click();
  const form = page.getByRole('dialog', { name: '添加Telegram' });
  await form.getByLabel('Bot token').fill(token);
  await form.getByLabel('chat_id').fill(chatId);
  await form.getByRole('button', { name: '保存' }).click();
  await expect(form).toBeHidden();
  const row = page.getByLabel('Telegram 渠道', { exact: true });
  await expect(row).toContainText('待验证');
  await expect(row).toContainText(`••••${token.slice(-4)}`);
  await expect(page.locator('body')).not.toContainText(token);
  await row.getByRole('button', { name: '发送测试消息' }).click();
  await expect(row.getByRole('status').filter({ hasText: '平台已受理。请到 Telegram 确认确实收到' })).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText('已启用');
  expect((await inbox('telegram')).filter(m => m.chatId === chatId)).toHaveLength(1);

  const address = `ui-${randomUUID().slice(0, 8)}@example.test`;
  await page.getByRole('button', { name: '添加邮件渠道' }).click();
  await page.getByRole('dialog', { name: '添加邮件' }).getByLabel('收件地址').fill(address);
  await page.getByRole('dialog', { name: '添加邮件' }).getByRole('button', { name: '保存' }).click();
  const mail = page.getByLabel('邮件 渠道', { exact: true });
  await mail.getByRole('button', { name: '发送测试消息' }).click();
  await expect(mail.getByRole('status').filter({ hasText: '邮件服务器已受理' })).toBeVisible({ timeout: 20_000 });
  await expect(mail).toContainText('待验证');
  const code = /验证码：(\d{6})/.exec(String((await inbox('smtp')).find(m => (m.to as string[]).includes(address))!.text))![1];
  await mail.getByLabel('邮件验证码').fill(code);
  await mail.getByRole('button', { name: '确认收件' }).click();
  await expect(mail).toContainText('已启用');
  await b.client.dispose();
});

test('reminders: create with a live preview, see deliveries, retry a dead letter, read the in-app inbox', async ({ page, context }) => {
  test.setTimeout(120_000);
  const b = await book('reminders-ui'); await signIn(context, b);
  const chatId = String(1_000_000_000 + Math.floor(Math.random() * 1e9));
  const channel = (await (await b.client.post('/api/v1/notification-channels', { data: { name: '我的 TG', config: { type: 'telegram', botToken: `987654321:${randomBytes(18).toString('base64url')}`, chatId } } })).json()).data;
  const test1 = (await (await b.client.post(`/api/v1/notification-channels/${channel.id}/test-deliveries`, { data: {}, headers: { 'Idempotency-Key': randomUUID() } })).json()).data;
  await expect.poll(async () => (await (await b.client.get(`/api/v1/notification-channels/${channel.id}/test-deliveries/${test1.id}`)).json()).data.status, { timeout: 20_000 }).toBe('accepted');
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date()).slice(0, 7);
  await b.post('/budgets', { name: '零食', categoryId: b.food.id, period: 'month', amount: { amount: '20.00', currency: 'CNY' }, startDate: `${month}-01`, alertThresholds: [80, 100] });

  await page.goto(`/ledgers/${b.ledger.id}/reminders`);
  await expect(page.getByText('还没有提醒。')).toBeVisible();
  await page.getByRole('button', { name: '＋ 新建提醒' }).click();
  const form = page.getByRole('dialog', { name: '新建提醒' });
  await form.getByLabel('提醒什么').selectOption({ label: '预算阈值' });
  await form.getByLabel('预算').selectOption({ label: '零食' });
  await form.getByLabel(/我的 TG/).check();
  await expect(form.getByText('事件触发，无固定时间。')).toBeVisible();
  await form.getByRole('button', { name: '保存提醒' }).click();
  await expect(form).toBeHidden();
  const rule = page.getByLabel('预算阈值提醒');
  await expect(rule).toContainText('零食');
  await expect(rule).toContainText('事件触发：达到条件时发送');
  await expect(rule).toContainText('站内通知 + 我的 TG');

  // 80 %: Telegram is down → retries, then a dead letter; in-app still arrives.
  await control('telegram', { mode: 'server_error' });
  await b.record({ kind: 'expense', accountId: b.cash.id, categoryId: b.food.id, settlement: { amount: '17.00', currency: 'CNY' } });
  await expect.poll(async () => ((await (await b.client.get(`${b.base}/notification-deliveries?status=failed`)).json()).data as unknown[]).length, { timeout: 60_000 }).toBe(1);
  await control('telegram', { mode: 'ok' });
  await page.goto(`/ledgers/${b.ledger.id}/reminders?tab=deliveries&status=failed`);
  const failed = page.getByRole('row').filter({ hasText: '预算阈值' });
  await expect(failed).toContainText('失败');
  await expect(failed).toContainText('服务端错误');
  await failed.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('status').filter({ hasText: '已重新排队' })).toBeVisible();
  await expect.poll(async () => (await inbox('telegram')).filter(m => m.chatId === chatId && String(m.text).includes('预算「零食」已用到 80%')).length, { timeout: 20_000 }).toBe(1);
  await page.goto(`/ledgers/${b.ledger.id}/reminders?tab=deliveries`);
  await expect(page.getByRole('row').filter({ hasText: '预算阈值' }).filter({ hasText: '平台已受理' }).first()).toBeVisible();

  // In-app inbox and the unread badge in the top bar.
  const bell = page.getByRole('link', { name: /站内通知，\d+ 条未读/ });
  await expect(bell).toBeVisible();
  const before = Number(/(\d+) 条未读/.exec((await bell.getAttribute('aria-label'))!)![1]);
  await bell.click();
  await expect(page).toHaveURL(/tab=inbox/);
  const item = page.getByRole('region', { name: '站内通知' }).getByRole('listitem').filter({ hasText: '预算「零食」已用到 80%' });
  await item.getByRole('button', { name: '标为已读' }).click();
  await expect(item.getByRole('button', { name: '标为未读' })).toBeVisible();
  await expect(page.getByRole('link', { name: before - 1 ? new RegExp(`站内通知，${before - 1} 条未读`) : /^站内通知$/ })).toBeVisible();
  await b.client.dispose();
});
