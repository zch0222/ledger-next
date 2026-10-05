import { randomUUID } from 'node:crypto';
import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { book, choose, test } from './helpers';

// M4 end-to-end flows. Each runs in the desktop and the mobile project, so phones complete the same tasks.
const mobile = (info: TestInfo) => info.project.name === 'mobile';
async function signIn(context: BrowserContext, b: Awaited<ReturnType<typeof book>>) {
  await context.addCookies((await b.client.storageState()).cookies);
}
async function openEntry(page: Page, info: TestInfo) {
  if (mobile(info)) {
    await page.getByRole('navigation', { name: '移动导航' }).getByRole('button', { name: '记一笔' }).click();
  } else {
    // The N shortcut listens once the shell has hydrated, which is when the ledger switcher becomes interactive.
    await expect(page.getByRole('button', { name: /^切换账本/ })).toBeEnabled();
    await page.keyboard.press('n');
  }
  await expect(page.getByRole('dialog', { name: '记一笔' })).toBeVisible();
}
/** Waits for the server preview, then saves; the save button is disabled until a preview exists. */
async function submit(page: Page, dialog: string, button: string) {
  const d = page.getByRole('dialog', { name: dialog });
  await expect(d.getByRole('button', { name: button })).toBeEnabled();
  await d.getByRole('button', { name: button }).click();
  await expect(d).toBeHidden();
}
const balances = async (b: Awaited<ReturnType<typeof book>>) =>
  Object.fromEntries(
    (await (await b.client.get(`${b.base}/accounts`)).json()).data.map((a: { name: string; balance: string }) => [
      a.name,
      a.balance,
    ]),
  );

test('record, correct, refund and void keep history; filters live in the URL; conflicts never overwrite', async ({
  page,
  context,
}, info) => {
  const b = await book('core-ui');
  await signIn(context, b);
  await page.goto(`/ledgers/${b.ledger.id}/transactions`);
  await expect(page.getByText('还没有账目。记下第一笔，之后都会出现在这里。')).toBeVisible();

  await openEntry(page, info);
  const entry = page.getByRole('dialog', { name: '记一笔' });
  await expect(entry.getByLabel(/结算金额/)).toBeFocused();
  await entry.getByLabel(/结算金额/).fill('128.50');
  await choose(entry.getByLabel('分类'), '餐饮');
  await entry.getByLabel('商家 / 说明').fill('午餐');
  await expect(entry.getByText('现金 −¥128.50')).toBeVisible();
  await submit(page, '记一笔', '保存');
  await expect(page.getByRole('status').filter({ hasText: '已记录 支出 CNY 128.50' })).toBeVisible();
  await expect(page.getByRole('link', { name: '午餐 支出 详情' })).toBeVisible();

  // 更正: a new version replaces the old one, which stays reachable.
  await page.getByRole('link', { name: '午餐 支出 详情' }).click();
  const detail = page.getByRole('dialog', { name: '午餐' });
  await expect(detail.getByText('CNY 128.50').first()).toBeVisible();
  await detail.getByRole('button', { name: '更正' }).click();
  const correct = page.getByRole('dialog', { name: '更正账目' });
  await correct.getByLabel(/结算金额/).fill('120');
  await expect(correct.getByText(/原值 CNY 128.50 → 新值 CNY 120.00/)).toBeVisible();
  await submit(page, '更正账目', '确认更正');
  await expect(page.getByRole('status').filter({ hasText: '已更正 支出 CNY 120.00' })).toBeVisible();
  await expect(page.getByText('支出 · CNY 120.00')).toBeVisible(); // the list has refreshed to the new version
  await page.getByRole('link', { name: '午餐 支出 详情' }).click();
  await expect(detail.getByRole('link', { name: '查看被更正的旧版本 →' })).toBeVisible();

  // 退款: linked to the expense, limited to what is left.
  await detail.getByRole('button', { name: '退款' }).click();
  const refund = page.getByRole('dialog', { name: '登记退款' });
  await expect(refund.getByLabel(/退款金额/)).toHaveValue('120.00');
  await refund.getByLabel(/退款金额/).fill('20');
  await submit(page, '登记退款', '确认退款');
  await expect(page.getByText('退款 · CNY 20.00')).toBeVisible();
  await page.getByRole('link', { name: '午餐 支出 详情' }).click();
  await expect(detail.getByRole('heading', { name: '已退款' })).toBeVisible();
  await expect(detail.getByText('可退余额：CNY 100.00')).toBeVisible();
  // With a live refund the expense is locked until the refund is voided.
  await expect(detail.getByText('已有退款：如需更正或作废，请先作废对应退款。')).toBeVisible();
  await expect(detail.getByRole('button', { name: '更正' })).toHaveCount(0);
  await detail.getByRole('button', { name: '完成' }).click();

  // 作废: reversing entries, the voided row stays visible under the status filter.
  await b.record({
    kind: 'expense',
    accountId: b.cash.id,
    settlement: { amount: '30.00', currency: 'CNY' },
    categoryId: b.traffic.id,
    merchant: '打车',
  });
  await page.reload();
  await page.getByRole('link', { name: '打车 支出 详情' }).click();
  const taxi = page.getByRole('dialog', { name: '打车' });
  await taxi.getByRole('button', { name: '作废' }).click();
  await expect(taxi.getByRole('alertdialog')).toContainText('现金 +¥30.00');
  await taxi.getByRole('button', { name: '确认作废' }).click();
  await expect(page.getByRole('status').filter({ hasText: '已作废：打车 CNY 30.00' })).toBeVisible();
  expect((await balances(b))['现金']).toBe('900.00'); // 1000 − 120 + 20; the void restored 30
  await page.keyboard.press('Escape');
  await expect(taxi).toBeHidden();
  await expect(page.getByRole('link', { name: '打车 支出 详情' })).toBeHidden();
  await choose(page.getByLabel('版本状态'), '已作废 / 旧版本');
  await expect(page).toHaveURL(/status=voided/);
  await expect(page.getByText('支出 · CNY 30.00 · 已作废')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('版本状态')).toContainText('已作废 / 旧版本');
  await expect(page.getByRole('button', { name: '移除筛选 状态' })).toBeVisible();
  await page.getByRole('button', { name: '清空筛选' }).click();
  await expect(page).not.toHaveURL(/status=/);
  await page.getByLabel('搜索商家或备注').fill('午餐');
  await expect(page).toHaveURL(/q=%E5%8D%88%E9%A4%90/);
  await expect(page.getByRole('link', { name: '午餐 支出 详情' })).toBeVisible();
  await expect(page.getByRole('link', { name: '打车 支出 详情' })).toBeHidden();
  await page.getByLabel('搜索商家或备注').fill('不存在的商家');
  await expect(page.getByText('当前条件下没有账目。')).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('搜索商家或备注')).toHaveValue('午餐');

  // 412: another member corrects the same entry while this page still shows the old version.
  const breakfast = await b.record({
    kind: 'expense',
    accountId: b.cash.id,
    settlement: { amount: '15.00', currency: 'CNY' },
    categoryId: b.food.id,
    merchant: '早餐',
  });
  await page.goto(`/ledgers/${b.ledger.id}/transactions`);
  await page.getByRole('link', { name: '早餐 支出 详情' }).click();
  await page.getByRole('dialog', { name: '早餐' }).getByRole('button', { name: '更正' }).click();
  const other = await b.post('/transaction-previews', {
    kind: 'expense',
    accountId: b.cash.id,
    settlement: { amount: '18.00', currency: 'CNY' },
    categoryId: b.food.id,
    merchant: '早餐',
    occurredAt: new Date().toISOString(),
    timezone: 'Asia/Hong_Kong',
  });
  expect(
    (
      await b.client.patch(`${b.base}/transactions/${breakfast.id}`, {
        data: { previewId: other.previewId },
        headers: { 'If-Match': `"v${breakfast.version}"`, 'Idempotency-Key': randomUUID() },
      })
    ).status(),
  ).toBe(200);
  await correct.getByLabel(/结算金额/).fill('99');
  await expect(correct.getByRole('button', { name: '确认更正' })).toBeEnabled();
  await correct.getByRole('button', { name: '确认更正' }).click();
  const conflict = correct.getByRole('alert').filter({ hasText: '这笔账目已被其他人修改' });
  await expect(conflict).toContainText('你的输入');
  await expect(conflict).toContainText('CNY 99.00');
  await expect(conflict).toContainText('CNY 18.00 · 早餐'); // the version that is current now, not the superseded one
  await expect(correct.getByRole('button', { name: '确认更正' })).toBeDisabled();
  expect((await balances(b))['现金']).toBe('882.00'); // 900 − the other member's 18, not the stale 99
  await b.client.dispose();
});

test('entry dialog: keyboard, focus return, unsaved-change guard, soft keyboard keeps save reachable', async ({
  page,
  context,
}, info) => {
  const b = await book('focus-ui');
  await signIn(context, b);
  await page.goto(`/ledgers/${b.ledger.id}/dashboard`);
  const opener = mobile(info)
    ? page.getByRole('navigation', { name: '移动导航' }).getByRole('button', { name: '记一笔' })
    : page.getByRole('banner').getByRole('button', { name: '＋ 记一笔' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const entry = page.getByRole('dialog', { name: '记一笔' });
  await expect(entry.getByLabel(/结算金额/)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(entry).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();
  await entry.getByLabel(/结算金额/).fill('12');
  await page.keyboard.press('Escape');
  await expect(entry.getByRole('alertdialog', { name: '放弃未保存的内容' })).toBeVisible();
  await entry.getByRole('button', { name: '继续编辑' }).click();
  await expect(entry.getByLabel(/结算金额/)).toHaveValue('12');
  await expect(entry.getByLabel(/结算金额/)).toHaveAttribute('aria-describedby', 'entry-amount-error');
  await entry.getByLabel(/结算金额/).fill('12.3456789');
  await expect(entry.locator('#entry-amount-error')).toHaveText('请输入大于 0 的金额，例如 128.50');
  if (mobile(info)) {
    // Soft keyboard: about half the screen is gone; the save button must still be reachable.
    await page.setViewportSize({ width: 390, height: 420 });
    await entry.getByLabel(/结算金额/).fill('12.30');
    await entry.getByRole('button', { name: '保存' }).scrollIntoViewIfNeeded();
    await expect(entry.getByRole('button', { name: '保存' })).toBeInViewport();
    await submit(page, '记一笔', '保存');
    await page.setViewportSize({ width: 390, height: 844 });
  } else {
    await entry.getByLabel(/结算金额/).fill('12.30');
    await entry.getByRole('button', { name: '保存' }).focus();
    await expect(entry.getByRole('button', { name: '保存' })).toBeEnabled();
    await page.keyboard.press('Enter');
    await expect(entry).toBeHidden();
  }
  await expect(page.getByRole('status').filter({ hasText: '已记录 支出 CNY 12.30' })).toBeVisible();
  // The bottom bar never covers the last row.
  if (mobile(info)) {
    await page.goto(`/ledgers/${b.ledger.id}/transactions`);
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const last = await page.locator('.list-foot').boundingBox();
    const bar = await page.getByRole('navigation', { name: '移动导航' }).boundingBox();
    expect(last!.y + last!.height).toBeLessThanOrEqual(bar!.y + 1);
  }
  await b.client.dispose();
});

test('accounts: create, transfer, credit-card liability, archive keeps history', async ({ page, context }, info) => {
  const b = await book('accounts-ui', '1000');
  await signIn(context, b);
  await page.goto(`/ledgers/${b.ledger.id}/accounts`);
  await page.getByRole('button', { name: '＋ 新建账户' }).click();
  const form = page.getByRole('dialog', { name: '新建账户' });
  await form.getByLabel('账户名称').fill('招行借记卡');
  await form.getByLabel(/期初余额/).fill('500');
  await form.getByRole('button', { name: '保存账户' }).click();
  await expect(form).toBeHidden();
  const bank = page.getByRole('region', { name: '招行借记卡' });
  await expect(bank).toContainText('CNY 500.00');

  await page.getByRole('button', { name: '＋ 新建账户' }).click();
  await form.getByLabel('账户名称').fill('信用卡');
  await choose(form.getByLabel('类型'), '信用卡');
  await form.getByLabel(/期初余额/).fill('-300');
  await form.getByRole('button', { name: '保存账户' }).click();
  await expect(page.getByRole('region', { name: '信用卡' })).toContainText('负债');

  // Transfer from the cash card: principal moves, no income or expense.
  await page.getByRole('region', { name: '现金' }).getByRole('button', { name: '转账' }).click();
  const transfer = page.getByRole('dialog', { name: '记一笔' });
  await expect(transfer.getByRole('radio', { name: '转账' })).toBeChecked();
  await transfer.getByLabel(/转出金额/).fill('200');
  await choose(transfer.getByLabel('转入账户'), '招行借记卡 · CNY');
  await expect(transfer.getByText(/现金 −¥200.00；招行借记卡 \+¥200.00/)).toBeVisible();
  await submit(page, '记一笔', '保存');
  await expect(page.getByRole('region', { name: '现金' })).toContainText('CNY 800.00');
  await expect(bank).toContainText('CNY 700.00');

  await bank.getByRole('button', { name: '招行借记卡 更多操作' }).click();
  await page.getByRole('menuitem', { name: '归档' }).click();
  await expect(bank.getByRole('alertdialog', { name: '确认归档' })).toContainText('账户仍有余额 CNY 700.00');
  await bank.getByRole('button', { name: '确认归档' }).click();
  await expect(bank).toBeHidden();
  await page.getByText('已归档账户（1）').click();
  await expect(page.locator('.archived')).toContainText('招行借记卡');
  await page.goto(`/ledgers/${b.ledger.id}/transactions`);
  await expect(page.getByRole('link', { name: '现金 → 招行借记卡 转账 详情' })).toBeVisible();
  if (!mobile(info)) await expect(page.getByRole('cell', { name: /转账/ }).first()).toBeVisible();
  await b.client.dispose();
});

test('subscriptions: due is not paid until confirmed, one payment per bill, edits keep paid history', async ({
  page,
  context,
}) => {
  const b = await book('subs-ui');
  await signIn(context, b);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date());
  const past = new Date(Date.parse(`${today}T00:00:00Z`) - 3 * 86400_000).toISOString().slice(0, 10);
  // Bills are generated from today on (no backlog); overdue needs a passing day and is covered by the integration suite.
  const preview = await b.post('/subscription-previews', {
    name: '宽带',
    amount: { amount: '99.00', currency: 'CNY' },
    cycle: { unit: 'month', count: 1 },
    anchorDate: today,
    timezone: 'Asia/Hong_Kong',
    accountId: b.cash.id,
  });
  await b.post('/subscriptions', { previewId: preview.previewId }, { 'Idempotency-Key': randomUUID() });

  await page.goto(`/ledgers/${b.ledger.id}/subscriptions`);
  await expect(page.getByText(/1 笔账单待确认：宽带（今天到期）/)).toBeVisible();
  await page.getByRole('button', { name: '＋ 新增订阅' }).click();
  const form = page.getByRole('dialog', { name: '新增订阅' });
  await form.getByLabel('服务名称').fill('Cloud Pro');
  await form.getByLabel('每期金额（原币）').fill('20');
  await form.getByLabel('首个扣款日（锚点）').fill(today);
  await choose(form.getByLabel('默认账户'), '现金 · CNY');
  await expect(form.getByText(/未来三次：/)).toContainText(today);
  await form.getByRole('button', { name: '保存订阅' }).click();
  await expect(form).toBeHidden();
  const card = page.getByRole('region', { name: 'Cloud Pro' });
  await expect(card).toContainText('今天到期');
  await expect(card).toContainText('月均约 CNY 20.00 · 预测');
  expect((await balances(b))['现金']).toBe('1000.00'); // due bills never pay themselves

  await page.getByRole('tab', { name: '账单列表' }).click();
  await expect(page).toHaveURL(/view=list/);
  const row = page.getByRole('row').filter({ hasText: 'Cloud Pro' }).filter({ hasText: '今天到期' });
  await row.getByRole('button', { name: '确认已付' }).click();
  const pay = page.getByRole('dialog', { name: '确认账单已支付' });
  await expect(pay).toContainText('账单：Cloud Pro');
  await expect(pay.getByLabel(/结算金额/)).toHaveValue('20.00');
  await submit(page, '确认账单已支付', '确认已支付');
  const paid = page.getByRole('row').filter({ hasText: 'Cloud Pro' }).filter({ hasText: '已支付' });
  await expect(paid.getByRole('link', { name: '支付记录' })).toBeVisible();
  await expect(paid.getByRole('button', { name: '确认已付' })).toHaveCount(0);
  expect((await balances(b))['现金']).toBe('980.00');

  const bills = async (extra = '') =>
    (
      await (
        await b.client.get(`${b.base}/bill-occurrences?dateFrom=${past}&dateTo=2099-01-01&limit=100${extra}`)
      ).json()
    ).data as {
      id: string;
      name: string;
      status: string;
      scheduledDate: string;
      transactionId: string | null;
      scheduleVersion: number;
    }[];
  const cloudPaid = (await bills()).filter(x => x.name === 'Cloud Pro' && x.status === 'paid');
  expect(cloudPaid).toHaveLength(1);
  const again = await b.post('/transaction-previews', {
    kind: 'expense',
    accountId: b.cash.id,
    settlement: { amount: '20.00', currency: 'CNY' },
    occurredAt: new Date().toISOString(),
    timezone: 'Asia/Hong_Kong',
  });
  expect(
    (
      await b.client.post(`${b.base}/bill-occurrences/${cloudPaid[0].id}/payments`, {
        data: { previewId: again.previewId },
        headers: { 'Idempotency-Key': randomUUID() },
      })
    ).status(),
  ).toBe(409);

  await page.getByRole('tab', { name: '日历' }).click();
  await expect(
    page
      .getByRole('list', { name: /账单日历/ })
      .getByRole('listitem')
      .filter({ hasText: `${today}，` }),
  ).toContainText('Cloud Pro');

  // Editing the amount creates schedule v2: unpaid v1 bills are cancelled, the paid one stays.
  await page.getByRole('tab', { name: '卡片' }).click();
  await card.getByRole('button', { name: '管理订阅 →' }).click();
  const manage = page.getByRole('dialog', { name: 'Cloud Pro' });
  await manage.getByRole('button', { name: '编辑' }).click();
  await manage.getByLabel(/^金额/).fill('25');
  await manage.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('status').filter({ hasText: '订阅已更新' })).toBeVisible();
  const after = (await bills()).filter(x => x.name === 'Cloud Pro');
  expect(after.filter(x => x.status === 'paid').map(x => x.id)).toEqual([cloudPaid[0].id]);
  expect(after.filter(x => x.status !== 'paid').every(x => x.scheduleVersion === 2)).toBe(true);
  expect(after.some(x => x.scheduleVersion === 2 && x.status === 'scheduled')).toBe(true);
  expect((await bills('&status=cancelled')).some(x => x.name === 'Cloud Pro' && x.scheduleVersion === 1)).toBe(true);
  await card.getByRole('button', { name: '管理订阅 →' }).click();
  await expect(manage).toContainText('v2');
  await manage.getByRole('button', { name: '暂停' }).click();
  await manage.getByRole('button', { name: '确认暂停' }).click();
  await expect(card).toContainText('已暂停');
  await card.getByRole('button', { name: '管理订阅 →' }).click();
  await manage.getByRole('button', { name: '取消订阅' }).click();
  await manage.getByRole('button', { name: '服务立即结束' }).click();
  await expect(card).toContainText('已取消');
  await b.client.dispose();
});

test('a slow preview answer for an older input is never what gets saved', async ({ page, context }, info) => {
  const b = await book('stale-preview');
  await signIn(context, b);
  await page.goto(`/ledgers/${b.ledger.id}/transactions`);
  // The first preview answer is held back until after the amount has changed again.
  let first = true;
  await page.route('**/transaction-previews', async route => {
    if (first) {
      first = false;
      await new Promise(r => setTimeout(r, 1500));
    }
    await route.continue();
  });
  await openEntry(page, info);
  const entry = page.getByRole('dialog', { name: '记一笔' });
  await entry.getByLabel(/结算金额/).fill('10');
  await page.waitForTimeout(600); // the debounced request for 10 is now in flight
  await entry.getByLabel(/结算金额/).fill('20');
  await expect(entry.getByText('现金 −¥20.00')).toBeVisible();
  await page.waitForTimeout(1500); // the late answer for 10 arrives and must be ignored
  await expect(entry.getByText('现金 −¥20.00')).toBeVisible();
  await submit(page, '记一笔', '保存');
  expect((await balances(b))['现金']).toBe('980.00');
  await b.client.dispose();
});
