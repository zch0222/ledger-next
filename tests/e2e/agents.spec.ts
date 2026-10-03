import { randomUUID } from 'node:crypto';
import { expect, request } from '@playwright/test';
import { book, origin, test } from './helpers';

// P10 Agent 接入 in the browser: client configs without secrets, a token shown once, an approval decided on the page, revocation.
test('agents page: configure a client, issue a token once, approve an Agent request, revoke', async ({
  page,
  context,
}) => {
  const b = await book('agents-ui', '100000');
  await context.addCookies((await b.client.storageState()).cookies);
  await page.goto(`/ledgers/${b.ledger.id}/agents`);
  await expect(page.getByRole('heading', { name: '选择客户端' })).toBeVisible();
  await page.getByRole('button', { name: 'Claude Code' }).click();
  const config = page.getByLabel('Claude Code 配置');
  await expect(config).toContainText('"type": "http"');
  await expect(config).toContainText('Bearer ${LEDGER_API_TOKEN}');
  await expect(config).toContainText('/mcp');
  await page.getByRole('button', { name: 'Qoder IDE / CLI' }).click();
  await expect(page.getByLabel('Qoder IDE / CLI 配置')).toContainText('<在本机注入，不要提交到仓库>');
  await expect(page.getByRole('table').filter({ hasText: 'ledger_create_transaction' })).toContainText(
    'transactions:write',
  );

  // Issue: read-only is the default; the bookkeeping preset adds writes; the token appears once.
  await page.getByRole('button', { name: '＋ 签发令牌' }).click();
  const form = page.getByRole('dialog', { name: '签发访问令牌' });
  await expect(form.getByLabel(/^交易/)).toBeChecked();
  await expect(form.getByLabel(/^记账 \/ 更正 \/ 退款/)).not.toBeChecked();
  await form.getByLabel('名称').fill('Claude Code（测试）');
  await form.getByRole('button', { name: '记账' }).click();
  await expect(form.getByText('包含写入权限')).toBeVisible();
  await form.getByRole('button', { name: '签发令牌' }).click();
  await expect(form).toBeHidden();
  const once = page.getByRole('status').filter({ hasText: '令牌只显示这一次' });
  const token = (await once.getByLabel('新令牌').textContent())!.trim();
  expect(token).toMatch(/^lnp_[A-Za-z0-9_-]{43}$/);
  const row = page.getByRole('row', { name: '令牌 Claude Code（测试）' });
  await expect(row).toContainText('可写');
  await expect(row).toContainText('有效');
  await once.getByRole('button', { name: '我已保存，关闭' }).click();
  await page.reload();
  await expect(page.locator('body')).not.toContainText(token);
  await expect(row).toContainText(token.slice(0, 12));

  // The Agent asks for a large write: refused with an approval link that opens this page on that request.
  const agent = await request.newContext({
    baseURL: process.env.BASE_URL ?? origin,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  const preview = (
    await (
      await agent.post(`${b.base}/transaction-previews`, {
        data: {
          kind: 'expense',
          accountId: b.cash.id,
          categoryId: b.food.id,
          settlement: { amount: '12000.00', currency: 'CNY' },
          occurredAt: new Date(Date.now() - 60_000).toISOString(),
          timezone: 'Asia/Hong_Kong',
        },
      })
    ).json()
  ).data;
  const key = randomUUID();
  const refused = await (
    await agent.post(`${b.base}/transactions`, {
      data: { previewId: preview.previewId },
      headers: { 'Idempotency-Key': key },
    })
  ).json();
  expect(refused.code).toBe('APPROVAL_REQUIRED');
  await page.goto(new URL(refused.approval.approvalUrl).pathname + new URL(refused.approval.approvalUrl).search);
  const item = page.getByRole('listitem', { name: /审批：提交预览/ });
  await expect(item).toBeFocused();
  await expect(item).toContainText('支出 12000.00 CNY');
  await expect(item).toContainText('通过 Agent 令牌');
  await expect(page.getByText('1 项待处理')).toBeVisible();
  await item.getByRole('button', { name: '批准' }).click();
  await expect(item).toContainText('已批准，等待 Agent 使用');
  const approved = await agent.post(`${b.base}/transactions`, {
    data: { previewId: preview.previewId },
    headers: { 'Idempotency-Key': key, 'X-Approval-Id': refused.approval.id },
  });
  expect(approved.status()).toBe(201);
  await page.reload();
  await expect(page.getByRole('listitem', { name: /审批：提交预览/ })).toContainText('已执行');
  await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Agent 相关审计' }) })).toContainText(
    '批准 Agent 操作',
  );

  // Revoke: the very next request with the token is refused.
  await page.getByRole('row', { name: '令牌 Claude Code（测试）' }).getByRole('button', { name: '撤销' }).click();
  await page.getByRole('alertdialog', { name: '确认撤销' }).getByRole('button', { name: '确认撤销' }).click();
  await expect(page.getByRole('row', { name: '令牌 Claude Code（测试）' })).toContainText('已撤销');
  expect((await agent.get('/api/v1/me')).status()).toBe(401);
  await agent.dispose();
  await b.client.dispose();
});
