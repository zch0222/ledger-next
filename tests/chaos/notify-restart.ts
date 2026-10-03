// Docker chaos drill for reminders (M5-CHAOS), driven by scripts/docker-test.mjs:
//   prepare → the worker is SIGKILLed mid-request and Redis restarts → (outage) → worker comes back → verify.
// Expected: the in-flight send becomes delivery_unknown and is not resent (the provider did receive it once);
// deliveries that fell due during the outage are sent after the restart; one that expired meanwhile is marked
// expired instead of being sent late. Runs inside the tests container against the isolated stack.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { database, databasePool } from '@ledger/db/index';
import {
  ledgers,
  memberships,
  notificationAttempts,
  notificationChannels,
  notificationDeliveries,
  user,
} from '@ledger/db/schema';
import { createChannel } from '@ledger/domain/notify-channels';
import { insertDelivery } from '@ledger/domain/notify-store';

const MOCK = process.env.MOCK_URL!;
const MARK = 'chaos-drill';
const control = (body: Record<string, unknown>) =>
  fetch(`${MOCK}/__control/channels`, { method: 'POST', body: JSON.stringify({ service: 'telegram', ...body }) });
const inbox = async (text: string) =>
  ((await (await fetch(`${MOCK}/__inbox/telegram`)).json()).messages as { text: string }[]).filter(m =>
    m.text.includes(text),
  );
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const rows = () =>
  database()
    .select()
    .from(notificationDeliveries)
    .where(like(notificationDeliveries.eventId, `overdue:${MARK}:%`));
const byName = async () =>
  Object.fromEntries((await rows()).map(r => [(r.payload as { refs: { name: string } }).refs.name, r]));

async function prepare() {
  const now = new Date();
  const userId = randomUUID();
  const ledgerId = randomUUID();
  await database()
    .insert(user)
    .values({
      id: userId,
      name: 'chaos',
      email: `chaos-${userId}@example.test`,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    });
  await database().insert(ledgers).values({
    id: ledgerId,
    name: '故障演练',
    baseCurrency: 'CNY',
    timezone: 'Asia/Hong_Kong',
    createdAt: now,
    updatedAt: now,
  });
  await database().insert(memberships).values({ id: randomUUID(), ledgerId, userId, role: 'owner', createdAt: now });
  const channel = await createChannel(
    { userId, requestId: randomUUID() },
    {
      name: 'chaos tg',
      config: { type: 'telegram', botToken: `123456789:${randomBytes(18).toString('base64url')}`, chatId: '777000777' },
    },
  );
  await database()
    .update(notificationChannels)
    .set({ status: 'active', lastVerifiedAt: now })
    .where(eq(notificationChannels.id, channel.id));
  await control({ mode: 'ok', failNext: 0, delayMs: 20_000 }); // the provider answers slowly: the worker dies while waiting
  const add = (name: string, dueInMs: number, validMs: number) =>
    insertDelivery(database(), {
      ledgerId,
      userId,
      channelId: channel.id,
      channelType: 'telegram',
      ruleId: null,
      ruleVersion: null,
      eventType: 'overdue',
      eventId: `overdue:${MARK}:${name}`,
      subjectId: null,
      dedupeKey: `${ledgerId}/${MARK}/${name}`,
      templateVersion: 1,
      scheduledAt: new Date(Date.now() + dueInMs),
      expiresAt: new Date(Date.now() + dueInMs + validMs),
      deferredByQuietHours: false,
      payload: { title: name, kind: 'overdue', refs: { name, date: '2026-10-01', amount: '1.00', currency: 'CNY' } },
    });
  await add('chaos-inflight', 0, 3600_000);
  await add('chaos-pending', 9000, 3600_000); // falls due during the outage, still valid afterwards
  await add('chaos-short', 9000, 2000); // falls due and expires during the outage
  for (let i = 0; i < 80; i++) {
    const inflight = (await byName())['chaos-inflight'];
    const [attempt] = await database()
      .select()
      .from(notificationAttempts)
      .where(eq(notificationAttempts.deliveryId, inflight.id));
    if (inflight.status === 'sending' && attempt && !attempt.finishedAt) {
      await control({ delayMs: 0 }); // only the request already waiting at the provider stays slow
      console.log('PREPARED: request in flight, worker can be killed');
      return;
    }
    await wait(250);
  }
  throw new Error('the worker never started the in-flight request');
}

async function verify() {
  let state: Record<string, Awaited<ReturnType<typeof rows>>[number]> = {};
  for (let i = 0; i < 120; i++) {
    state = await byName();
    if (
      state['chaos-inflight']?.status === 'delivery_unknown' &&
      state['chaos-pending']?.status === 'accepted' &&
      state['chaos-short']?.status === 'expired'
    ) {
      break;
    }
    await wait(500);
  }
  for (let i = 0; i < 60 && !(await inbox('chaos-inflight')).length; i++) await wait(500); // the slow provider finishes on its own
  assert.equal(
    state['chaos-inflight'].status,
    'delivery_unknown',
    `in-flight delivery: ${JSON.stringify(state['chaos-inflight'])}`,
  );
  assert.equal(
    state['chaos-pending'].status,
    'accepted',
    `pending delivery: ${JSON.stringify(state['chaos-pending'])}`,
  );
  assert.equal(state['chaos-short'].status, 'expired', `short delivery: ${JSON.stringify(state['chaos-short'])}`);
  await wait(4000); // nothing may be resent afterwards
  assert.equal((await inbox('chaos-inflight')).length, 1, 'the provider received the in-flight message exactly once');
  assert.equal(
    (await inbox('chaos-pending')).length,
    1,
    'the delivery due during the outage was sent once after the restart',
  );
  assert.equal((await inbox('chaos-short')).length, 0, 'an expired reminder is never sent late');
  assert.equal((await byName())['chaos-inflight'].status, 'delivery_unknown');
  console.log(
    `PASS: worker SIGKILL + Redis restart — in-flight: unknown (received once, not resent); due during outage: sent once; expired: not sent (${state['chaos-short'].reason})`,
  );
}

try {
  await (process.argv[2] === 'prepare' ? prepare() : verify());
} finally {
  await databasePool().end();
}
