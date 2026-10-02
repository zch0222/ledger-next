import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { database, databasePool } from '../../packages/db/src/index';
import { closeRedis } from '../../packages/db/src/redis';
import { notificationAttempts, notificationChannels, notificationDeliveries, notifications } from '../../packages/db/src/schema';
import { createAccount } from '../../packages/domain/src/accounts';
import { createCategory } from '../../packages/domain/src/catalog';
import { claimDue, deliver, deliveryStats, listNotifications, retryDelivery, sweepStuck, updateNotification, unreadCount } from '../../packages/domain/src/deliveries';
import type { AuthContext } from '../../packages/domain/src/identity';
import { createChannel, createTestDelivery, deleteChannel, getChannel, listChannels, presentChannel, rewrapChannelKeys, updateChannel, verifyChannel } from '../../packages/domain/src/notify-channels';
import { channelConfig, insertDelivery } from '../../packages/domain/src/notify-store';
import { budgetAlerts, createReminderPreview, createReminderRule, deleteReminderRule, planRule, updateReminderRule } from '../../packages/domain/src/reminders';
import { createBudget } from '../../packages/domain/src/reports';
import { parseKeyring } from '../../packages/domain/src/secrets';
import { createBillPayment, createSubscription, createSubscriptionPreview, listBillOccurrences, updateSubscription } from '../../packages/domain/src/subscriptions';
import { createPreview, createTransaction } from '../../packages/domain/src/transactions';
import { reminderRules } from '../../packages/db/src/schema';
import { seedLedger, seedUser } from './db';

// Reminder engine against the local provider mocks. Time is pinned in the future (2031) so the Docker worker, which
// shares this database, never claims these deliveries: every claim and send here is driven by the test.
const NOW = new Date('2031-03-05T02:00:00Z'); // Wednesday 10:00 in Hong Kong
const at = (iso: string) => new Date(iso);
const MOCK = process.env.MOCK_URL ?? 'http://127.0.0.1:4010';
const control = (service: string, body: Record<string, unknown>) => fetch(`${MOCK}/__control/channels`, { method: 'POST', body: JSON.stringify({ service, ...body }) });
const inbox = async (service: string) => (await (await fetch(`${MOCK}/__inbox/${service}`)).json()).messages as Record<string, string>[];
const row = async (id: string) => (await database().select().from(notificationDeliveries).where(eq(notificationDeliveries.id, id)))[0];
async function run(when: Date) {
  const claimed = await claimDue(200, when);
  const results: Record<string, string> = {};
  for (const c of claimed) results[c.id] = await deliver(c.id, () => when);
  return results;
}
const chat = () => String(1_000_000_000 + Math.floor(Math.random() * 1_000_000_000));
const TOKEN = `123456789:${randomBytes(18).toString('base64url')}`;
let ctx: AuthContext, other: AuthContext, ledger: string, cash: string, food: string, tg: string, tgChat: string, inApp: string;

async function activeTelegram(chatId = chat()) {
  const channel = await createChannel(ctx, { name: `TG ${chatId}`, config: { type: 'telegram', botToken: TOKEN, chatId } }, database(), NOW);
  await createTestDelivery(ctx, channel.id, {}, database(), NOW);
  await run(NOW);
  return { id: channel.id, chatId };
}
/** A ledger reminder delivery without a rule (the engine treats it like any planned one). */
async function queued(channelId: string, channelType: 'telegram' | 'in_app', when: Date, extra: Partial<{ expiresAt: Date; ruleId: string; ruleVersion: number }> = {}) {
  const eventId = `overdue:${randomUUID()}`;
  return (await insertDelivery(database(), { ledgerId: ledger, userId: ctx.userId, channelId, channelType, ruleId: extra.ruleId ?? null, ruleVersion: extra.ruleVersion ?? null, eventType: 'overdue', eventId, subjectId: null,
    dedupeKey: `${ledger}/${eventId}/${channelId}`, templateVersion: 1, scheduledAt: when, expiresAt: extra.expiresAt ?? new Date(when.getTime() + 7 * 86400_000), deferredByQuietHours: false,
    payload: { title: '宽带', kind: 'overdue', refs: { name: '宽带', date: '2031-03-04', amount: '99.00', currency: 'CNY' } } }, when)).row;
}

beforeAll(async () => {
  ctx = { userId: await seedUser(), requestId: randomUUID() }; other = { userId: await seedUser(), requestId: randomUUID() };
  ledger = await seedLedger(ctx.userId, 'CNY');
  cash = (await createAccount(ctx, ledger, { name: '现金', type: 'cash', currency: 'CNY', openingBalance: '1000' })).id;
  food = (await createCategory(ctx, ledger, { name: '餐饮', kind: 'expense' })).id;
  inApp = (await listChannels(ctx, { limit: 10 })).find(c => c.type === 'in_app')!.id;
  ({ id: tg, chatId: tgChat } = await activeTelegram());
});
afterEach(async () => { for (const s of ['telegram', 'smtp']) await control(s, { mode: 'ok', failNext: 0, delayMs: 0 }); });
afterAll(async () => { await closeRedis(); await databasePool().end(); });

describe('channels', () => {
  it('seals credentials, shows masked summaries and validates provider endpoints', async () => {
    const channel = await createChannel(ctx, { name: '告警群', config: { type: 'telegram', botToken: TOKEN, chatId: '-100123' } }, database(), NOW);
    const [stored] = await database().select().from(notificationChannels).where(eq(notificationChannels.id, channel.id));
    expect(stored.sealedConfig).not.toContain(TOKEN.split(':')[1]);
    expect(presentChannel(stored)).toMatchObject({ status: 'verifying', configSummary: { chatId: '-100123', botToken: `••••${TOKEN.slice(-4)}` } });
    expect(JSON.stringify(presentChannel(stored))).not.toContain(TOKEN);
    expect(channelConfig(stored)).toEqual({ type: 'telegram', botToken: TOKEN, chatId: '-100123' });
    const reject = async (config: Record<string, unknown>) => { try { await createChannel(ctx, { name: 'x', config }); return 'created'; } catch (e) { return (e as { errors?: { path: string }[] }).errors?.[0]?.path ?? (e as Error).message; } };
    expect(await reject({ type: 'telegram', botToken: 'abc', chatId: '1' })).toBe('config.botToken');
    expect(await reject({ type: 'feishu', webhookUrl: 'https://evil.example/open-apis/bot/v2/hook/x' })).toBe('config.webhookUrl');
    expect(await reject({ type: 'wecom_bot', webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send' })).toBe('config.webhookUrl');
    expect(await reject({ type: 'webhook', url: 'https://10.0.0.8/hook' })).toBe('config.url');
    expect(await reject({ type: 'webhook', url: 'http://hooks.example.com/x' })).toBe('config.url');
    expect(await reject({ type: 'webhook', url: 'https://169.254.169.254/latest/meta-data' })).toBe('config.url');
    expect((await listChannels(ctx, { limit: 50 })).map(c => c.type)).toEqual(expect.arrayContaining(['in_app', 'telegram']));
    await expect(getChannel(other, channel.id)).rejects.toMatchObject({ status: 404 });
    await expect(updateChannel(ctx, channel.id, { name: '新名字' }, '"v9"')).rejects.toMatchObject({ status: 412 });
    expect((await updateChannel(ctx, channel.id, { name: '新名字' }, '"v1"')).version).toBe(2);
    await expect(deleteChannel(ctx, inApp, '"v1"')).rejects.toMatchObject({ code: 'IN_APP_REQUIRED' });
    await deleteChannel(ctx, channel.id, '"v2"');
    const [gone] = await database().select().from(notificationChannels).where(eq(notificationChannels.id, channel.id));
    expect(gone).toMatchObject({ sealedConfig: null, status: 'disabled' });
    expect(gone.deletedAt).not.toBeNull();
  });

  it('activates a channel only after its test message was accepted; e-mail needs the code from the mail', async () => {
    const [stored] = await database().select().from(notificationChannels).where(eq(notificationChannels.id, tg));
    expect(stored).toMatchObject({ status: 'active' });
    expect((await inbox('telegram')).some(m => m.chatId === tgChat && m.text.includes('Ledger Next 测试消息'))).toBe(true);

    const address = `verify-${randomUUID()}@example.test`;
    const mail = await createChannel(ctx, { name: '邮箱', config: { type: 'email', address } }, database(), NOW);
    const test = await createTestDelivery(ctx, mail.id, { message: '你好' }, database(), NOW);
    expect(Object.values(await run(NOW))).toContain('accepted');
    expect((await row(test.id)).status).toBe('accepted');
    const received = (await inbox('smtp')).find(m => (m.to as unknown as string[]).includes(address))!;
    expect(received.subject).toBe('Ledger Next 测试消息');
    const code = /验证码：(\d{6})/.exec(received.text)?.[1];
    expect(code).toMatch(/^\d{6}$/);
    expect((await getChannel(ctx, mail.id)).status).toBe('verifying'); // the platform accepting a mail proves nothing yet
    await expect(verifyChannel(ctx, mail.id, { code: code === '000000' ? '111111' : '000000' }, NOW)).rejects.toMatchObject({ code: 'CODE_MISMATCH' });
    expect((await verifyChannel(ctx, mail.id, { code }, NOW)).status).toBe('active');
    await expect(verifyChannel(ctx, mail.id, { code }, NOW)).rejects.toMatchObject({ code: 'CODE_EXPIRED' });
  });
});

describe('rules and planning', () => {
  let subscription: string;
  beforeAll(async () => {
    const preview = await createSubscriptionPreview(ctx, ledger, { name: '视频会员', amount: { amount: '25.00', currency: 'CNY' }, cycle: { unit: 'month', count: 1 }, anchorDate: '2031-03-10', timezone: 'Asia/Hong_Kong', accountId: cash }, NOW);
    subscription = (await createSubscription(ctx, ledger, { previewId: preview.previewId }, database(), NOW)).id;
  });
  const bill = async (date: string) => (await listBillOccurrences(ctx, ledger, { dateFrom: date, dateTo: '2031-12-31', subscriptionId: subscription }, { limit: 5 }, NOW))[0];
  const ofRule = (ruleId: string) => database().select().from(notificationDeliveries).where(eq(notificationDeliveries.ruleId, ruleId));

  it('previews and plans dated reminders once per slot and channel, honouring quiet hours', async () => {
    const preview = await createReminderPreview(ctx, ledger, { eventType: 'bill_due', subscriptionId: subscription, leadDays: [3, 0], localTime: '09:00', timezone: 'Asia/Hong_Kong', quietHours: { start: '22:00', end: '08:00' }, channelIds: [tg, inApp] }, NOW);
    expect(preview.nextFireTimes.map(f => f.scheduledAt)).toEqual(['2031-03-07T01:00:00.000Z', '2031-03-10T01:00:00.000Z', '2031-04-07T01:00:00.000Z']);
    expect(preview.warnings).toEqual([]);
    const rule = await createReminderRule(ctx, ledger, { previewId: preview.previewId }, database(), NOW);
    expect(rule.nextFireTimes).toEqual(['2031-03-07T01:00:00.000Z']); // planned through NOW + 48 h
    expect(await ofRule(rule.id)).toHaveLength(2); // one per channel
    const [stored] = await database().select().from(reminderRules).where(eq(reminderRules.id, rule.id));
    expect(await planRule(database(), stored, NOW)).toBe(0); // the dedupe key makes re-planning harmless

    const night = await createReminderPreview(ctx, ledger, { eventType: 'daily_entry', localTime: '23:00', timezone: 'Asia/Hong_Kong', quietHours: { start: '22:00', end: '08:00' }, channelIds: [inApp] }, NOW);
    expect(night.nextFireTimes[0]).toMatchObject({ localDate: '2031-03-06', localTime: '08:00', deferredByQuietHours: true });
    expect(night.warnings.map(w => w.code)).toContain('QUIET_HOURS');
    const unverified = await createChannel(ctx, { name: '未验证', config: { type: 'telegram', botToken: TOKEN, chatId: chat() } }, database(), NOW);
    expect((await createReminderPreview(ctx, ledger, { eventType: 'weekly_summary', localTime: '09:00', timezone: 'Asia/Hong_Kong', channelIds: [unverified.id] }, NOW)).warnings.map(w => w.code)).toContain('CHANNEL_NOT_READY');
    await expect(createReminderPreview(ctx, ledger, { eventType: 'bill_due', localTime: '09:00', timezone: 'Asia/Hong_Kong', channelIds: [randomUUID()] }, NOW)).rejects.toMatchObject({ status: 422 });
    await expect(createReminderPreview(ctx, ledger, { eventType: 'fx_threshold', localTime: '09:00', timezone: 'Asia/Hong_Kong', channelIds: [inApp] }, NOW)).rejects.toMatchObject({ status: 422 });
  });

  it('sends at the slot, then cancels the remaining reminders of a bill once it is paid (AC05)', async () => {
    const results = await run(at('2031-03-07T01:00:00Z'));
    expect(Object.values(results).filter(r => r === 'accepted' || r === 'delivered')).toHaveLength(2);
    expect((await inbox('telegram')).some(m => m.chatId === tgChat && m.text.startsWith('订阅「视频会员」3 天后到期'))).toBe(true);
    expect((await listNotifications(ctx, ledger, {}, { limit: 20 })).some(n => n.title === '订阅「视频会员」3 天后到期')).toBe(true);
    // Two days later the "due today" slot is planned; paying the bill first cancels it.
    const [rule] = await database().select().from(reminderRules).where(and(eq(reminderRules.ledgerId, ledger), eq(reminderRules.eventType, 'bill_due')));
    await planRule(database(), rule, at('2031-03-09T02:00:00Z'));
    const occurrence = await bill('2031-03-10');
    const dueToday = (await ofRule(rule.id)).filter(d => d.subjectId === occurrence.id && d.status === 'queued');
    expect(dueToday).toHaveLength(2);
    const preview = await createPreview(ctx, ledger, { kind: 'expense', accountId: cash, settlement: { amount: '25.00', currency: 'CNY' }, occurredAt: '2031-03-09T02:00:00.000Z', timezone: 'Asia/Hong_Kong' });
    await createBillPayment(ctx, ledger, occurrence.id, { previewId: preview.previewId }, database(), at('2031-03-09T02:00:00Z'));
    for (const d of dueToday) expect(await row(d.id)).toMatchObject({ status: 'cancelled', reason: '账单已支付' });
    expect(Object.keys(await run(at('2031-03-10T01:00:00Z'))).filter(id => dueToday.some(d => d.id === id))).toEqual([]);
  });

  it('a rule edit cancels queued deliveries of the old version and never repeats a sent one', async () => {
    const preview = await createSubscriptionPreview(ctx, ledger, { name: '云盘', amount: { amount: '9.00', currency: 'CNY' }, cycle: { unit: 'month', count: 1 }, anchorDate: '2031-03-20', timezone: 'Asia/Hong_Kong', accountId: cash }, NOW);
    const cloud = (await createSubscription(ctx, ledger, { previewId: preview.previewId }, database(), NOW)).id;
    const rp = await createReminderPreview(ctx, ledger, { eventType: 'bill_due', subscriptionId: cloud, leadDays: [3, 1], localTime: '09:00', timezone: 'Asia/Hong_Kong', channelIds: [tg] }, NOW);
    const rule = await createReminderRule(ctx, ledger, { previewId: rp.previewId }, database(), NOW);
    const [stored] = await database().select().from(reminderRules).where(eq(reminderRules.id, rule.id));
    await planRule(database(), stored, at('2031-03-16T02:00:00Z'));
    await run(at('2031-03-17T01:00:00Z')); // the 3-day reminder goes out
    await planRule(database(), { ...stored, plannedThrough: null }, at('2031-03-17T02:00:00Z')); // the 1-day one enters the horizon
    const before = await ofRule(rule.id);
    expect(before.map(d => d.status).sort()).toEqual(['accepted', 'queued']);
    const edited = await updateReminderRule(ctx, ledger, rule.id, { localTime: '10:30' }, '"v1"', at('2031-03-17T03:00:00Z'));
    expect(edited.version).toBe(2);
    const after = await ofRule(rule.id);
    expect(after.find(d => d.id === before.find(b => b.status === 'queued')!.id)).toMatchObject({ status: 'cancelled', reason: '规则已修改' });
    expect(after.filter(d => d.eventId.endsWith(':3'))).toHaveLength(1); // the sent one is not planned again under v2
    expect(after.find(d => d.ruleVersion === 2)).toMatchObject({ status: 'queued', scheduledAt: at('2031-03-19T02:30:00Z') });
    // Pausing the subscription cancels what is still queued; deleting the rule as well.
    await updateSubscription(ctx, ledger, cloud, { status: 'paused' }, '"v1"', at('2031-03-17T03:30:00Z'));
    expect((await ofRule(rule.id)).find(d => d.ruleVersion === 2)!.status).toBe('cancelled');
    await deleteReminderRule(ctx, ledger, rule.id, '"v2"', at('2031-03-17T03:30:00Z'));
    await expect(updateReminderRule(ctx, ledger, rule.id, { localTime: '11:00' }, '"v3"')).rejects.toMatchObject({ status: 404 });
  });
});

describe('delivery failures and recovery', () => {
  it('429 honours Retry-After, then the next attempt is accepted', async () => {
    const d = await queued(tg, 'telegram', at('2031-03-21T01:00:00Z'));
    await control('telegram', { failNext: 1, failMode: 'rate_limited' });
    expect((await run(at('2031-03-21T01:00:00Z')))[d.id]).toBe('retry');
    expect(await row(d.id)).toMatchObject({ status: 'queued', attempts: 1, responseClass: 'rate_limited', nextAttemptAt: at('2031-03-21T01:00:02Z') });
    expect((await run(at('2031-03-21T01:00:01Z')))[d.id]).toBeUndefined();
    expect((await run(at('2031-03-21T01:00:03Z')))[d.id]).toBe('accepted');
    expect(await database().select().from(notificationAttempts).where(eq(notificationAttempts.deliveryId, d.id))).toHaveLength(2);
  });

  it('5xx backs off up to five attempts, dead-letters, tells the user in-app, and can be replayed', async () => {
    const start = at('2031-03-22T01:00:00Z'), d = await queued(tg, 'telegram', start);
    await control('telegram', { failNext: 5, failMode: 'server_error' });
    let when = start;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const result = (await run(when))[d.id];
      expect(result).toBe(attempt < 5 ? 'retry' : 'dead_letter');
      const current = await row(d.id);
      if (attempt < 5) {
        const wait = current.nextAttemptAt.getTime() - when.getTime(), base = Math.min(15 * 60_000, 30_000 * 2 ** (attempt - 1));
        expect(wait).toBeGreaterThanOrEqual(base * 0.5);
        expect(wait).toBeLessThanOrEqual(base * 1.5);
        when = current.nextAttemptAt;
      }
    }
    expect(await row(d.id)).toMatchObject({ status: 'failed', deadLetter: true, attempts: 5, responseClass: 'server_error' });
    expect((await listNotifications(ctx, ledger, { unreadOnly: 'true' }, { limit: 50 })).some(n => n.title.startsWith('提醒未能送达（telegram）'))).toBe(true);
    const replay = await retryDelivery(ctx, ledger, d.id, when);
    expect(replay).toMatchObject({ status: 'queued', round: 2, attempts: 0, deadLetter: false });
    expect((await run(when))[d.id]).toBe('accepted');
    await expect(retryDelivery(ctx, ledger, d.id, when)).rejects.toMatchObject({ code: 'DELIVERY_NOT_RETRYABLE' });
  });

  it('a lost answer becomes delivery_unknown and is never resent automatically', async () => {
    const d = await queued(tg, 'telegram', at('2031-03-23T01:00:00Z'));
    const before = (await inbox('telegram')).length;
    await control('telegram', { failNext: 1, failMode: 'drop' });
    expect((await run(at('2031-03-23T01:00:00Z')))[d.id]).toBe('unknown');
    expect(await row(d.id)).toMatchObject({ status: 'delivery_unknown', responseClass: 'timeout' });
    expect((await inbox('telegram')).length).toBe(before + 1); // the provider did receive it: resending would duplicate
    expect((await run(at('2031-03-23T02:00:00Z')))[d.id]).toBeUndefined();
  });

  it('a credential error pauses the channel and cancels its queue', async () => {
    const bad = await activeTelegram();
    const first = await queued(bad.id, 'telegram', at('2031-03-24T01:00:00Z')), second = await queued(bad.id, 'telegram', at('2031-03-24T05:00:00Z'));
    await control('telegram', { failNext: 1, failMode: 'credential' });
    expect((await run(at('2031-03-24T01:00:00Z')))[first.id]).toBe('failed');
    expect(await row(first.id)).toMatchObject({ status: 'failed', responseClass: 'credential_error', deadLetter: true });
    expect(await row(second.id)).toMatchObject({ status: 'cancelled', reason: '渠道凭据失效，已暂停' });
    const channel = await getChannel(ctx, bad.id);
    expect(channel).toMatchObject({ status: 'disabled', lastError: 'Unauthorized' });
    // Re-enabling needs a fresh verification.
    expect((await updateChannel(ctx, bad.id, { enabled: true }, `"v${channel.version}"`)).status).toBe('verifying');
  });

  it('expires instead of sending late, and recovers deliveries stuck in "sending"', async () => {
    const late = await queued(tg, 'telegram', at('2031-03-25T01:00:00Z'), { expiresAt: at('2031-03-25T01:01:00Z') });
    await run(at('2031-03-25T01:05:00Z'));
    expect(await row(late.id)).toMatchObject({ status: 'expired' });

    const never = await queued(tg, 'telegram', at('2031-03-26T01:00:00Z')), started = await queued(tg, 'telegram', at('2031-03-26T01:00:00Z'));
    const claimed = await claimDue(200, at('2031-03-26T01:00:00Z'));
    expect(claimed.map(c => c.id)).toEqual(expect.arrayContaining([never.id, started.id]));
    // The worker died: one claim never reached the provider, the other was mid-request.
    await database().insert(notificationAttempts).values({ id: randomUUID(), deliveryId: started.id, round: 1, attemptNo: 1, startedAt: at('2031-03-26T01:00:00Z') });
    const swept = await sweepStuck(at('2031-03-26T01:10:00Z'));
    expect(swept).toMatchObject({ requeued: expect.any(Number), unknown: expect.any(Number) });
    expect(await row(never.id)).toMatchObject({ status: 'queued', attempts: 0 });
    expect(await row(started.id)).toMatchObject({ status: 'delivery_unknown' });
    expect((await run(at('2031-03-26T01:10:00Z')))[never.id]).toBe('accepted');
  });

  it('two workers cannot send the same claimed attempt', async () => {
    const d = await queued(tg, 'telegram', at('2031-03-27T01:00:00Z'));
    const before = (await inbox('telegram')).length;
    await claimDue(200, at('2031-03-27T01:00:00Z'));
    const outcomes = await Promise.all([deliver(d.id, () => at('2031-03-27T01:00:00Z')), deliver(d.id, () => at('2031-03-27T01:00:00Z'))]);
    expect(outcomes.sort()).toEqual(['accepted', 'skipped']);
    expect((await inbox('telegram')).length).toBe(before + 1);
  });

  it('a retry that lands in quiet hours waits for the end of the window', async () => {
    const rp = await createReminderPreview(ctx, ledger, { eventType: 'weekly_summary', localTime: '09:00', timezone: 'Asia/Hong_Kong', quietHours: { start: '22:00', end: '08:00' }, channelIds: [tg] }, NOW);
    const rule = await createReminderRule(ctx, ledger, { previewId: rp.previewId }, database(), NOW);
    const d = await queued(tg, 'telegram', at('2031-03-28T15:00:00Z'), { ruleId: rule.id, ruleVersion: 1 }); // 23:00 in Hong Kong
    expect((await run(at('2031-03-28T15:00:00Z')))[d.id]).toBe('deferred');
    expect(await row(d.id)).toMatchObject({ status: 'queued', nextAttemptAt: at('2031-03-29T00:00:00Z'), deferredByQuietHours: true, attempts: 0 });
  });
});

describe('event-driven reminders, inbox and statistics', () => {
  it('budget thresholds alert once per threshold and period', async () => {
    const budget = await createBudget(ctx, ledger, { name: '餐饮预算', categoryId: food, period: 'month', amount: { amount: '100.00', currency: 'CNY' }, startDate: '2031-03-01', alertThresholds: [80, 100] });
    const rp = await createReminderPreview(ctx, ledger, { eventType: 'budget_threshold', budgetId: budget.id, localTime: '09:00', timezone: 'Asia/Hong_Kong', channelIds: [inApp] }, NOW);
    expect(rp.warnings.map(w => w.code)).toContain('EVENT_DRIVEN');
    await createReminderRule(ctx, ledger, { previewId: rp.previewId }, database(), NOW);
    const spend = async (amount: string) => createTransaction(ctx, ledger, { previewId: (await createPreview(ctx, ledger, { kind: 'expense', accountId: cash, categoryId: food, settlement: { amount, currency: 'CNY' }, occurredAt: NOW.toISOString(), timezone: 'Asia/Hong_Kong' })).previewId });
    await spend('85.00');
    expect(await budgetAlerts(ledger, NOW)).toBe(1);
    expect(await budgetAlerts(ledger, NOW)).toBe(0);
    await spend('20.00');
    expect(await budgetAlerts(ledger, NOW)).toBe(1);
    await run(NOW);
    const titles = (await listNotifications(ctx, ledger, {}, { limit: 50 })).map(n => n.title);
    expect(titles).toEqual(expect.arrayContaining(['预算「餐饮预算」已用到 80%', '预算「餐饮预算」已用到 100%']));
  });

  it('reports states, dead letters and dispatch delay; marks inbox items read', async () => {
    const stats = await deliveryStats(ctx, ledger, at('2031-03-29T00:00:00Z'));
    expect(stats.byStatus.accepted).toBeGreaterThan(0);
    expect(stats.deadLetters).toBeGreaterThan(0);
    expect(stats.unknown).toBeGreaterThan(0);
    expect(stats.dispatchDelayMs.samples).toBeGreaterThan(0);
    expect(stats.dispatchDelayMs.p95).not.toBeNull();
    const unread = await unreadCount(ctx, ledger);
    const [first] = await listNotifications(ctx, ledger, { unreadOnly: 'true' }, { limit: 1 });
    const read = await updateNotification(ctx, ledger, first.id, { read: true }, `"v${first.version}"`);
    expect(read.readAt).not.toBeNull();
    expect(await unreadCount(ctx, ledger)).toBe(unread - 1);
    expect(await unreadCount(other, ledger).catch(() => 'denied')).toBe(0); // counts only the caller's own items
    const [stored] = await database().select().from(notifications).where(eq(notifications.id, first.id));
    expect(stored.userId).toBe(ctx.userId);
  });

  it('rotates the master key without touching plaintext', async () => {
    const current = process.env.LEDGER_ENCRYPTION_KEYS!;
    const rotated = `${'r' + randomBytes(3).toString('hex')}:${randomBytes(32).toString('base64')},${current}`;
    const result = await rewrapChannelKeys(parseKeyring(rotated), { userId: ctx.userId });
    expect(result.moved).toBe(result.total);
    process.env.LEDGER_ENCRYPTION_KEYS = rotated;
    const [stored] = await database().select().from(notificationChannels).where(eq(notificationChannels.id, tg));
    expect(stored.keyId).toBe(rotated.split(':')[0]);
    expect(channelConfig(stored)).toMatchObject({ type: 'telegram', chatId: tgChat });
  });
});
