import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { expectContract } from './contract';
import { book, test } from './helpers';

// M5 end-to-end: REST → outbox → worker → provider mocks (never real providers). Each mock's inbox is the
// independent evidence that a message arrived; the delivery log only says what the platform answered.
const MOCK = process.env.MOCK_URL ?? 'http://127.0.0.1:4010';
const control = (service: string, body: Record<string, unknown>) => fetch(`${MOCK}/__control/channels`, { method: 'POST', body: JSON.stringify({ service, ...body }) });
const inbox = async (service: string) => (await (await fetch(`${MOCK}/__inbox/${service}`)).json()).messages as Record<string, unknown>[];
const digits = () => String(1_000_000_000 + Math.floor(Math.random() * 1_000_000_000));
const FEISHU_SECRET = 'mock-feishu-signing-secret';
type Channel = { id: string; type: string; status: string; version: number; configSummary: Record<string, string>; lastError: string | null };
type Delivery = { id: string; status: string; attempts: number; channelId: string; title: string; responseClass: string | null; deadLetter: boolean; round: number; reason: string | null; scheduledAt: string; lastAttemptAt: string | null };

// Every test starts with healthy provider mocks, whatever an earlier (failed) test left behind.
test.beforeEach(async () => { for (const service of ['telegram', 'feishu', 'wecom_bot', 'wecom_app', 'pushplus', 'webhook', 'smtp']) await control(service, { mode: 'ok', failNext: 0, delayMs: 0 }); });

async function poll<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 30_000, step = 300) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting; last value ${JSON.stringify(value)}`);
    await new Promise(r => setTimeout(r, step));
    value = await read();
  }
  return value;
}
async function createChannel(client: APIRequestContext, name: string, config: Record<string, unknown>) {
  return (await expectContract(await client.post('/api/v1/notification-channels', { data: { name, config } }), 'createNotificationChannel', 201)).data as Channel;
}
async function testDelivery(client: APIRequestContext, channelId: string, message?: string) {
  const created = (await expectContract(await client.post(`/api/v1/notification-channels/${channelId}/test-deliveries`, { data: message ? { message } : {}, headers: { 'Idempotency-Key': randomUUID() } }), 'createTestDelivery', 202)).data as Delivery;
  return poll(async () => (await expectContract(await client.get(`/api/v1/notification-channels/${channelId}/test-deliveries/${created.id}`), 'getTestDelivery', 200)).data as Delivery, d => !['queued', 'sending'].includes(d.status));
}
/** One channel of every type, configured the way a user would (official provider URLs; the stack rewrites them to mocks). */
function configs() {
  const id = randomUUID().slice(0, 8);
  return {
    telegram: { type: 'telegram', botToken: `${digits().slice(0, 9)}:${randomBytes(18).toString('base64url')}`, chatId: digits() },
    feishu: { type: 'feishu', webhookUrl: `https://open.feishu.cn/open-apis/bot/v2/hook/${randomUUID()}`, signingSecret: FEISHU_SECRET },
    wecom_bot: { type: 'wecom_bot', webhookUrl: `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${randomUUID()}` },
    wecom_app: { type: 'wecom_app', corpId: `ww${id}`, agentId: '1000002', secret: randomBytes(16).toString('hex'), toUser: `user${id}` },
    pushplus_wechat: { type: 'pushplus_wechat', token: randomBytes(16).toString('hex') },
    email: { type: 'email', address: `notify-${id}@example.test` },
    webhook: { type: 'webhook', url: `${MOCK}/webhook/${randomUUID()}`, secret: randomBytes(16).toString('hex') },
  } as const;
}
type Configs = ReturnType<typeof configs>;
/** The inbox entry of one channel (each test uses unique chat ids, hooks, keys, users, tokens and addresses). */
async function received(type: keyof Configs, config: Configs[keyof Configs], text: string) {
  const c = config as Record<string, string>;
  const match: Record<keyof Configs, (m: Record<string, unknown>) => boolean> = {
    telegram: m => m.chatId === c.chatId && String(m.text).includes(text),
    feishu: m => c.webhookUrl.endsWith(String(m.hook)) && String(m.text).includes(text),
    wecom_bot: m => c.webhookUrl.endsWith(String(m.keyTail)) && String(m.text).includes(text),
    wecom_app: m => m.toUser === c.toUser && String(m.text).includes(text),
    pushplus_wechat: m => m.tokenTail === c.token.slice(-4) && String(m.title).includes(text),
    email: m => (m.to as string[]).includes(c.address) && String(m.subject).includes(text),
    webhook: m => c.url.endsWith(String(m.hook)) && String(m.body).includes(text),
  };
  const service = { telegram: 'telegram', feishu: 'feishu', wecom_bot: 'wecom_bot', wecom_app: 'wecom_app', pushplus_wechat: 'pushplus', email: 'smtp', webhook: 'webhook' }[type];
  return (await inbox(service)).filter(match[type]);
}

test('every channel type: sealed credentials, a real test message reaches its provider, status follows the answer', async () => {
  const b = await book('channels');
  const all = configs();
  for (const [type, config] of Object.entries(all) as [keyof Configs, Configs[keyof Configs]][]) {
    const channel = await createChannel(b.client, `e2e ${type}`, config);
    expect(channel.status).toBe('verifying');
    const listed = JSON.stringify((await expectContract(await b.client.get('/api/v1/notification-channels'), 'listNotificationChannels', 200)).data);
    for (const [key, value] of Object.entries(config)) if (/token|secret/i.test(key)) expect(listed).not.toContain(value);
    const delivery = await testDelivery(b.client, channel.id, `e2e ${type} 测试`);
    expect(delivery.status, `${type}: ${JSON.stringify(delivery)}`).toBe(type === 'webhook' ? 'delivered' : 'accepted');
    const evidence = await received(type, config, type === 'pushplus_wechat' || type === 'email' ? 'Ledger Next 测试消息' : `e2e ${type} 测试`);
    expect(evidence, `${type} inbox`).toHaveLength(1);
    const stored = ((await b.client.get('/api/v1/notification-channels').then(r => r.json())).data as Channel[]).find(c => c.id === channel.id)!;
    if (type === 'email') {
      expect(stored.status).toBe('verifying'); // accepted by the mail server is not proof of receipt
      const code = /验证码：(\d{6})/.exec(String(evidence[0].text))![1];
      const verified = (await expectContract(await b.client.post(`/api/v1/notification-channels/${channel.id}/verifications`, { data: { code } }), 'createChannelVerification', 200)).data as Channel;
      expect(verified.status).toBe('active');
    } else expect(stored.status).toBe('active');
    if (type === 'feishu') expect(evidence[0].signed).toBe(true);
    if (type === 'pushplus_wechat') expect(String(evidence[0].content)).not.toContain('e2e pushplus_wechat 测试'); // details stay off by default
    if (type === 'webhook') {
      const hit = evidence[0] as Record<string, string>;
      expect(hit.signature).toBe(`v1=${createHmac('sha256', (config as { secret: string }).secret).update(`${hit.timestamp}.${hit.body}`).digest('hex')}`);
      expect(JSON.parse(hit.body)).toMatchObject({ id: hit.eventId, type: 'test', data: { title: 'Ledger Next 测试消息' } });
    }
  }
  // Unsafe or unofficial destinations are refused before anything is stored.
  for (const config of [{ type: 'webhook', url: 'https://169.254.169.254/latest' }, { type: 'webhook', url: 'https://localhost/hook' }, { type: 'webhook', url: 'http://hooks.example.com/x' }, { type: 'feishu', webhookUrl: 'https://open.feishu.cn.evil.example/open-apis/bot/v2/hook/x' }])
    expect((await expectContract(await b.client.post('/api/v1/notification-channels', { data: { name: 'x', config } }), 'createNotificationChannel', 422)).errors[0].path).toMatch(/^config\./);
  await b.client.dispose();
});

test('a budget alert fans out through the worker to every channel, once per channel', async () => {
  const b = await book('fanout');
  const all = configs(), ids: string[] = [];
  for (const [type, config] of Object.entries(all)) {
    const channel = await createChannel(b.client, `fan ${type}`, config);
    ids.push(channel.id);
    if (type === 'email') {
      await testDelivery(b.client, channel.id);
      const mail = (await received('email', config, 'Ledger Next 测试消息'))[0];
      await b.client.post(`/api/v1/notification-channels/${channel.id}/verifications`, { data: { code: /验证码：(\d{6})/.exec(String(mail.text))![1] } });
    } else await testDelivery(b.client, channel.id);
  }
  const inApp = ((await b.client.get('/api/v1/notification-channels').then(r => r.json())).data as Channel[]).find(c => c.type === 'in_app')!;
  const budget = await b.post('/budgets', { name: '外卖', categoryId: b.food.id, period: 'month', amount: { amount: '50.00', currency: 'CNY' }, startDate: `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date()).slice(0, 7)}-01`, alertThresholds: [80] });
  const preview = (await expectContract(await b.client.post(`${b.base}/reminder-previews`, { data: { eventType: 'budget_threshold', budgetId: budget.id, localTime: '09:00', timezone: 'Asia/Hong_Kong', channelIds: [...ids, inApp.id] } }), 'createReminderPreview', 201)).data;
  expect(preview.warnings.map((w: { code: string }) => w.code)).toEqual(['EVENT_DRIVEN']);
  await expectContract(await b.client.post(`${b.base}/reminder-rules`, { data: { previewId: preview.previewId }, headers: { 'Idempotency-Key': randomUUID() } }), 'createReminderRule', 201);
  await b.record({ kind: 'expense', accountId: b.cash.id, categoryId: b.food.id, settlement: { amount: '45.00', currency: 'CNY' }, merchant: '外卖' });
  const title = '预算「外卖」已用到 80%';
  for (const [type, config] of Object.entries(all) as [keyof Configs, Configs[keyof Configs]][])
    await poll(() => received(type, config, title), list => list.length === 1, 30_000);
  const notes = await poll(async () => (await expectContract(await b.client.get(`${b.base}/notifications?unreadOnly=true`), 'listNotifications', 200)).data as { title: string }[], list => list.some(n => n.title === title));
  expect(notes.filter(n => n.title === title)).toHaveLength(1);
  const deliveries = (await expectContract(await b.client.get(`${b.base}/notification-deliveries`), 'listNotificationDeliveries', 200)).data as Delivery[];
  expect(deliveries.filter(d => d.title === '外卖').map(d => d.status).sort()).toEqual([...Array(6).fill('accepted'), 'delivered', 'delivered']); // webhook and in-app: the receiver itself answered
  // A second expense in the same period does not repeat the 80 % alert.
  await b.record({ kind: 'expense', accountId: b.cash.id, categoryId: b.food.id, settlement: { amount: '1.00', currency: 'CNY' } });
  await new Promise(r => setTimeout(r, 4000));
  expect(await received('telegram', all.telegram, title)).toHaveLength(1);
  await b.client.dispose();
});

test('faults: 429 waits, 5xx dead-letters without resending healthy channels, lost answers stay unknown, bad credentials pause', async () => {
  test.setTimeout(150_000);
  const b = await book('chaos');
  const tg = configs().telegram, fs = configs().feishu;
  const telegram = await createChannel(b.client, 'chaos tg', tg), feishu = await createChannel(b.client, 'chaos feishu', fs);
  await testDelivery(b.client, telegram.id); await testDelivery(b.client, feishu.id);
  const inApp = ((await b.client.get('/api/v1/notification-channels').then(r => r.json())).data as Channel[]).find(c => c.type === 'in_app')!;

  // 429: Retry-After (2 s) is honoured, then accepted.
  await control('telegram', { failNext: 1, failMode: 'rate_limited' });
  const started = Date.now(), limited = await testDelivery(b.client, telegram.id, '限流测试');
  expect(limited).toMatchObject({ status: 'accepted', attempts: 2 });
  expect(Date.now() - started).toBeGreaterThanOrEqual(1900);

  // Lost answer: the provider got it, we never learn that — unknown, and no automatic resend.
  await control('telegram', { failNext: 1, failMode: 'drop' });
  const lost = await testDelivery(b.client, telegram.id, '应答丢失测试');
  expect(lost.status).toBe('delivery_unknown');
  await new Promise(r => setTimeout(r, 3000));
  expect(await received('telegram', tg, '应答丢失测试')).toHaveLength(1);

  // Telegram down (5xx) while Feishu and in-app work: only Telegram retries; the healthy channels are not resent.
  const budget = await b.post('/budgets', { name: '咖啡', categoryId: b.food.id, period: 'month', amount: { amount: '10.00', currency: 'CNY' }, startDate: `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date()).slice(0, 7)}-01`, alertThresholds: [80] });
  const preview = (await b.client.post(`${b.base}/reminder-previews`, { data: { eventType: 'budget_threshold', budgetId: budget.id, localTime: '09:00', timezone: 'Asia/Hong_Kong', channelIds: [telegram.id, feishu.id, inApp.id] } }).then(r => r.json())).data;
  await b.client.post(`${b.base}/reminder-rules`, { data: { previewId: preview.previewId }, headers: { 'Idempotency-Key': randomUUID() } });
  await control('telegram', { mode: 'server_error' });
  await b.record({ kind: 'expense', accountId: b.cash.id, categoryId: b.food.id, settlement: { amount: '9.00', currency: 'CNY' } });
  const title = '预算「咖啡」已用到 80%';
  const deliveries = () => b.client.get(`${b.base}/notification-deliveries`).then(r => r.json()).then(r => (r.data as Delivery[]).filter(d => d.title === '咖啡'));
  const failedOne = await poll(deliveries, list => list.some(d => d.channelId === telegram.id && d.status === 'failed'), 90_000, 1000);
  const tgDelivery = failedOne.find(d => d.channelId === telegram.id)!;
  expect(tgDelivery).toMatchObject({ deadLetter: true, attempts: 5, responseClass: 'server_error' });
  expect(failedOne.find(d => d.channelId === feishu.id)?.status).toBe('accepted');
  expect(await received('feishu', fs, title)).toHaveLength(1);
  const notes = (await b.client.get(`${b.base}/notifications`).then(r => r.json())).data as { title: string }[];
  expect(notes.some(n => n.title === `提醒未能送达（telegram）：咖啡`)).toBe(true);
  // Recovery: replay the dead letter once Telegram is back; Feishu is still not resent.
  await control('telegram', { mode: 'ok' });
  const replay = (await expectContract(await b.client.post(`${b.base}/notification-deliveries/${tgDelivery.id}/retries`, { data: {} }), 'createDeliveryRetry', 202)).data as Delivery;
  expect(replay).toMatchObject({ status: 'queued', round: 2 });
  await poll(async () => (await expectContract(await b.client.get(`${b.base}/notification-deliveries/${tgDelivery.id}`), 'getNotificationDelivery', 200)).data as Delivery, d => d.status === 'accepted');
  expect(await received('telegram', tg, title)).toHaveLength(1);
  expect(await received('feishu', fs, title)).toHaveLength(1);
  await expectContract(await b.client.post(`${b.base}/notification-deliveries/${tgDelivery.id}/retries`, { data: {} }), 'createDeliveryRetry', 409);

  // A rejected credential pauses the channel and says why.
  const bad = await createChannel(b.client, 'bad tg', { ...configs().telegram, botToken: `123456789:invalid${randomBytes(12).toString('base64url')}` });
  expect((await testDelivery(b.client, bad.id)).status).toBe('failed');
  const paused = ((await b.client.get('/api/v1/notification-channels').then(r => r.json())).data as Channel[]).find(c => c.id === bad.id)!;
  expect(paused).toMatchObject({ status: 'disabled', lastError: 'Unauthorized' });

  const stats = (await expectContract(await b.client.get(`${b.base}/notification-stats`), 'getNotificationStats', 200)).data;
  expect(stats.byStatus.accepted).toBeGreaterThanOrEqual(2);
  expect(stats.dispatchDelayMs.samples).toBeGreaterThan(0);
  expect(stats.dispatchDelayMs.p95).toBeLessThanOrEqual(60_000);
  await b.client.dispose();
});

test('reminder rules: preview, next fire times, edits replan; a due-today reminder reaches Telegram at its minute', async () => {
  test.setTimeout(240_000);
  const hk = () => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date()).map(p => [p.type, p.value]));
  const now = hk(), minutes = Number(now.hour) * 60 + Number(now.minute) + 2;
  test.skip(minutes >= 24 * 60, 'too close to midnight in Hong Kong for a same-day slot');
  const today = `${now.year}-${now.month}-${now.day}`, slot = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const b = await book('rules');
  const tg = configs().telegram, telegram = await createChannel(b.client, 'rules tg', tg);
  expect((await testDelivery(b.client, telegram.id)).status).toBe('accepted');
  const sub = await b.post('/subscriptions', { previewId: (await b.post('/subscription-previews', { name: '音乐会员', amount: { amount: '15.00', currency: 'CNY' }, cycle: { unit: 'month', count: 1 }, anchorDate: today, timezone: 'Asia/Hong_Kong', accountId: b.cash.id })).previewId }, { 'Idempotency-Key': randomUUID() });
  const preview = (await expectContract(await b.client.post(`${b.base}/reminder-previews`, { data: { eventType: 'bill_due', subscriptionId: sub.id, leadDays: [0], localTime: slot, timezone: 'Asia/Hong_Kong', channelIds: [telegram.id] } }), 'createReminderPreview', 201)).data;
  expect(preview.nextFireTimes[0]).toMatchObject({ localDate: today, localTime: slot, deferredByQuietHours: false });
  const rule = (await expectContract(await b.client.post(`${b.base}/reminder-rules`, { data: { previewId: preview.previewId }, headers: { 'Idempotency-Key': randomUUID() } }), 'createReminderRule', 201)).data;
  expect(rule.nextFireTimes).toEqual([preview.nextFireTimes[0].scheduledAt]);
  const listed = (await expectContract(await b.client.get(`${b.base}/reminder-rules`), 'listReminderRules', 200)).data;
  expect(listed.map((r: { id: string }) => r.id)).toEqual([rule.id]);
  await expectContract(await b.client.patch(`${b.base}/reminder-rules/${rule.id}`, { data: { localTime: slot } }), 'updateReminderRule', 428);

  const evidence = await poll(() => received('telegram', tg, '订阅「音乐会员」今天到期'), list => list.length === 1, 200_000, 2000);
  expect(String(evidence[0].text)).toContain('系统不会自动记为已支付');
  const sent = ((await b.client.get(`${b.base}/notification-deliveries`).then(r => r.json())).data as Delivery[]).find(d => d.title === '音乐会员')!;
  expect(sent.status).toBe('accepted');
  expect(Date.parse(sent.lastAttemptAt!) - Date.parse(sent.scheduledAt)).toBeLessThanOrEqual(60_000); // §7.3 dispatch delay
  // Editing replans without repeating what was sent; deleting cancels what is left.
  const edited = (await expectContract(await b.client.patch(`${b.base}/reminder-rules/${rule.id}`, { data: { quietHours: { start: '23:00', end: '07:00' } }, headers: { 'If-Match': `"v${rule.version}"` } }), 'updateReminderRule', 200)).data;
  expect(edited.version).toBe(2);
  await expectContract(await b.client.delete(`${b.base}/reminder-rules/${rule.id}`, { headers: { 'If-Match': '"v2"' } }), 'deleteReminderRule', 204);
  await new Promise(r => setTimeout(r, 3000));
  expect(await received('telegram', tg, '订阅「音乐会员」今天到期')).toHaveLength(1);
  await b.client.dispose();
});
