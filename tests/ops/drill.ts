import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { call, data, ok, sleep, type Session } from '../perf/lib';

/**
 * M7-OPS restore drill, run step by step by scripts/ops-drill.mjs inside the tests container:
 *   seed     → a ledger with transfers, refunds, a correction, a void, an encrypted Telegram channel and a token
 *   more     → writes made after the full backup (lost by a dump-only restore, kept by the standby)
 *   verify   → sign in again and reconcile balances, postings, counts and audit with a recorded snapshot;
 *              the token and the encrypted channel (needs the separately backed-up key) still work
 *   reminder → a reminder due in about a minute (the harness then stops the web process)
 *   delivered→ the worker sent it while the web process was down
 */
const OUT = 'test-results/ops';
const STATE = `${OUT}/state.json`;
const TZ = 'Asia/Hong_Kong';
const MOCK = process.env.MOCK_URL ?? 'http://mock-services:4010';
type State = {
  email: string;
  password: string;
  ledgerId: string;
  cash: string;
  card: string;
  food: string;
  token: string;
  channelId: string;
  chatId: string;
  ruleId?: string;
  snapshots: Record<string, Snapshot>;
};
type Snapshot = {
  balances: Record<string, string>;
  transactions: number;
  postings: number;
  audit: number;
  postingSums: Record<string, string>;
  notifications: number;
  at: string;
};
const load = () => JSON.parse(readFileSync(STATE, 'utf8')) as State;
const save = (state: State) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(STATE, JSON.stringify(state, null, 2));
};
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

async function signIn(state: Pick<State, 'email' | 'password'>): Promise<Session> {
  const xff = `10.250.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  const response = await fetch(`${process.env.BASE_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: process.env.BASE_URL!, 'X-Forwarded-For': xff },
    body: JSON.stringify({ email: state.email, password: state.password }),
  });
  if (response.status !== 200) throw new Error(`sign-in: HTTP ${response.status} ${await response.text()}`);
  return {
    cookie: response.headers
      .getSetCookie()
      .map(c => c.split(';')[0])
      .filter(c => c.includes('session_token'))
      .join('; '),
    xff,
  };
}
async function expense(s: Session, base: string, account: string, category: string, amount: string) {
  const preview = data<{ previewId: string }>(
    ok(
      await call(s, 'POST', `${base}/transaction-previews`, {
        kind: 'expense',
        accountId: account,
        categoryId: category,
        settlement: { amount, currency: 'CNY' },
        occurredAt: ago(30),
        timezone: TZ,
      }),
      'preview',
    ),
  );
  return data<{ id: string; version: number }>(
    ok(
      await call(
        s,
        'POST',
        `${base}/transactions`,
        { previewId: preview.previewId },
        { 'Idempotency-Key': randomUUID() },
      ),
      'expense',
    ),
  );
}

async function testDelivery(s: Session, channelId: string) {
  const test = data<{ id: string }>(
    ok(
      await call(
        s,
        'POST',
        `/api/v1/notification-channels/${channelId}/test-deliveries`,
        {},
        { 'Idempotency-Key': randomUUID() },
      ),
      'test delivery',
    ),
  );
  let status = '';
  for (let i = 0; i < 60 && !['accepted', 'failed', 'delivery_unknown'].includes(status); i++) {
    await sleep(1000);
    status = data<{ status: string }>(
      ok(await call(s, 'GET', `/api/v1/notification-channels/${channelId}/test-deliveries/${test.id}`), 'delivery'),
    ).status;
  }
  return status;
}
async function snapshot(s: Session, state: State): Promise<Snapshot> {
  const base = `/api/v1/ledgers/${state.ledgerId}`;
  const accounts = data<{ id: string; balance: string }[]>(
    ok(await call(s, 'GET', `${base}/accounts?includeArchived=true`), 'accounts'),
  );
  const db = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const count = async (table: string) =>
      Number(
        (
          (await db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ledger_id = ?`, [state.ledgerId])) as [
            { n: number }[],
            unknown,
          ]
        )[0][0].n,
      );
    const [sums] = (await db.query(
      'SELECT account_id, SUM(signed_amount) AS total FROM account_postings WHERE ledger_id = ? GROUP BY account_id',
      [state.ledgerId],
    )) as [{ account_id: string; total: string }[], unknown];
    const [opening] = (await db.query('SELECT id, opening_balance FROM accounts WHERE ledger_id = ?', [
      state.ledgerId,
    ])) as [{ id: string; opening_balance: string }[], unknown];
    const postingSums = Object.fromEntries(
      opening.map(a => [
        a.id,
        (Number(a.opening_balance) + Number(sums.find(x => x.account_id === a.id)?.total ?? 0)).toFixed(2),
      ]),
    );
    return {
      balances: Object.fromEntries(accounts.map(a => [a.id, Number(a.balance).toFixed(2)])),
      transactions: await count('transactions'),
      postings: await count('account_postings'),
      audit: await count('audit_logs'),
      notifications: await count('notifications'),
      postingSums,
      at: new Date().toISOString(),
    };
  } finally {
    await db.end();
  }
}

const step = process.argv[2];
if (step === 'seed') {
  const email = `ops-${randomBytes(6).toString('hex')}@example.test`;
  const password = `Ops-${randomBytes(12).toString('hex')}`;
  const signUp = await fetch(`${process.env.BASE_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: process.env.BASE_URL!, 'X-Forwarded-For': '10.251.0.1' },
    body: JSON.stringify({ name: '演练用户', email, password }),
  });
  if (signUp.status !== 200) throw new Error(`sign-up: ${signUp.status}`);
  const s = await signIn({ email, password });
  const ledger = data<{ id: string }>(
    ok(await call(s, 'POST', '/api/v1/ledgers', { name: '恢复演练', baseCurrency: 'CNY', timezone: TZ }), 'ledger'),
  );
  const base = `/api/v1/ledgers/${ledger.id}`;
  const cash = data<{ id: string }>(
    ok(
      await call(s, 'POST', `${base}/accounts`, {
        name: '现金',
        type: 'cash',
        currency: 'CNY',
        openingBalance: '5000',
      }),
      'cash',
    ),
  ).id;
  const card = data<{ id: string }>(
    ok(
      await call(s, 'POST', `${base}/accounts`, {
        name: '银行卡',
        type: 'bank',
        currency: 'CNY',
        openingBalance: '20000',
      }),
      'card',
    ),
  ).id;
  const food = data<{ id: string }>(
    ok(await call(s, 'POST', `${base}/categories`, { name: '餐饮', kind: 'expense' }), 'food'),
  ).id;
  const spent = [];
  for (const amount of ['28.50', '199.00', '66.60', '1200.00']) spent.push(await expense(s, base, cash, food, amount));
  const transfer = data<{ previewId: string }>(
    ok(
      await call(s, 'POST', `${base}/transaction-previews`, {
        kind: 'transfer',
        sourceAccountId: card,
        targetAccountId: cash,
        sourceAmount: { amount: '800.00', currency: 'CNY' },
        targetAmount: { amount: '800.00', currency: 'CNY' },
        fee: { amount: { amount: '2.00', currency: 'CNY' } },
        occurredAt: ago(20),
        timezone: TZ,
      }),
      'transfer preview',
    ),
  );
  ok(
    await call(
      s,
      'POST',
      `${base}/transactions`,
      { previewId: transfer.previewId },
      { 'Idempotency-Key': randomUUID() },
    ),
    'transfer',
  );
  const refund = data<{ previewId: string }>(
    ok(
      await call(s, 'POST', `${base}/transaction-previews`, {
        kind: 'refund',
        originalTransactionId: spent[1].id,
        accountId: cash,
        settlement: { amount: '50.00', currency: 'CNY' },
        occurredAt: ago(10),
        timezone: TZ,
      }),
      'refund preview',
    ),
  );
  ok(
    await call(
      s,
      'POST',
      `${base}/transactions/${spent[1].id}/refunds`,
      { previewId: refund.previewId },
      { 'Idempotency-Key': randomUUID() },
    ),
    'refund',
  );
  const correction = data<{ previewId: string }>(
    ok(
      await call(s, 'POST', `${base}/transaction-previews`, {
        kind: 'expense',
        accountId: cash,
        categoryId: food,
        settlement: { amount: '30.00', currency: 'CNY' },
        occurredAt: ago(30),
        timezone: TZ,
      }),
      'correction preview',
    ),
  );
  ok(
    await call(
      s,
      'PATCH',
      `${base}/transactions/${spent[0].id}`,
      { previewId: correction.previewId },
      { 'If-Match': `"v${spent[0].version}"`, 'Idempotency-Key': randomUUID() },
    ),
    'correction',
  );
  ok(
    await call(s, 'DELETE', `${base}/transactions/${spent[3].id}`, undefined, { 'If-Match': `"v${spent[3].version}"` }),
    'void',
  );
  const chatId = String(1_000_000_000 + Math.floor(Math.random() * 1e9));
  const channel = data<{ id: string }>(
    ok(
      await call(s, 'POST', '/api/v1/notification-channels', {
        name: '演练 TG',
        config: { type: 'telegram', botToken: `987654321:${randomBytes(18).toString('base64url')}`, chatId },
      }),
      'channel',
    ),
  );
  // A channel receives reminders only after its first test message was accepted.
  if ((await testDelivery(s, channel.id)) !== 'accepted') throw new Error('the Telegram channel could not be verified');
  const token = data<{ token: string }>(
    ok(
      await call(s, 'POST', '/api/v1/api-tokens', {
        name: '演练令牌',
        scopes: ['ledgers:read', 'transactions:read'],
        ledgerIds: [ledger.id],
        expiresInDays: 30,
      }),
      'token',
    ),
  ).token;
  const state: State = {
    email,
    password,
    ledgerId: ledger.id,
    cash,
    card,
    food,
    token,
    channelId: channel.id,
    chatId,
    snapshots: {},
  };
  state.snapshots.backup = await snapshot(s, state);
  save(state);
  console.log(JSON.stringify(state.snapshots.backup));
} else if (step === 'more') {
  const state = load();
  const s = await signIn(state);
  const base = `/api/v1/ledgers/${state.ledgerId}`;
  for (const amount of ['12.00', '45.00', '8.80']) await expense(s, base, state.cash, state.food, amount);
  state.snapshots.latest = await snapshot(s, state);
  save(state);
  console.log(JSON.stringify(state.snapshots.latest));
} else if (step === 'verify') {
  const expected = process.argv[3] as 'backup' | 'latest';
  const state = load();
  const s = await signIn(state);
  const actual = await snapshot(s, state);
  const want = state.snapshots[expected];
  const problems: string[] = [];
  for (const key of ['balances', 'transactions', 'postings', 'audit', 'postingSums'] as const) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(want[key])) {
      problems.push(`${key}: expected ${JSON.stringify(want[key])}, got ${JSON.stringify(actual[key])}`);
    }
  }
  if (JSON.stringify(actual.balances) !== JSON.stringify(actual.postingSums)) {
    problems.push('balances differ from opening + postings');
  }
  const me = await fetch(`${process.env.BASE_URL}/api/v1/me`, { headers: { Authorization: `Bearer ${state.token}` } });
  if (me.status !== 200) problems.push(`token after restore: HTTP ${me.status}`);
  // The channel credential is decrypted by the worker with the separately kept key: a test message must reach the mock.
  const received = async () =>
    ((await (await fetch(`${MOCK}/__inbox/telegram`)).json()) as { messages: { chatId: string }[] }).messages.filter(
      m => m.chatId === state.chatId,
    ).length;
  const before = await received();
  const delivery = await testDelivery(s, state.channelId);
  const arrived = (await received()) - before;
  if (delivery !== 'accepted' || arrived !== 1) {
    problems.push(`encrypted channel after restore: ${delivery}, ${arrived} new message(s) at the mock`);
  }
  console.log(
    JSON.stringify({
      expected,
      transactions: actual.transactions,
      audit: actual.audit,
      balances: actual.balances,
      delivery,
      arrived,
      problems,
    }),
  );
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
} else if (step === 'reminder') {
  const state = load();
  const s = await signIn(state);
  const base = `/api/v1/ledgers/${state.ledgerId}`;
  const channels = data<{ id: string; type: string }[]>(
    ok(await call(s, 'GET', '/api/v1/notification-channels'), 'channels'),
  );
  const at = new Date(Date.now() + 70_000);
  const localTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  const preview = data<{ previewId: string }>(
    ok(
      await call(s, 'POST', `${base}/reminder-previews`, {
        eventType: 'daily_entry',
        localTime,
        timezone: TZ,
        channelIds: [channels.find(c => c.type === 'in_app')!.id, state.channelId],
      }),
      'reminder preview',
    ),
  );
  state.ruleId = data<{ id: string }>(
    ok(
      await call(
        s,
        'POST',
        `${base}/reminder-rules`,
        { previewId: preview.previewId },
        { 'Idempotency-Key': randomUUID() },
      ),
      'rule',
    ),
  ).id;
  save(state);
  console.log(JSON.stringify({ ruleId: state.ruleId, localTime }));
} else if (step === 'delivered') {
  const state = load();
  const db = await mysql.createConnection(process.env.DATABASE_URL!);
  let rows: { channel_type: string; status: string }[] = [];
  for (let i = 0; i < 40; i++) {
    [rows] = (await db.query(
      "SELECT channel_type, status FROM notification_deliveries WHERE rule_id = ? AND status IN ('accepted', 'delivered')",
      [state.ruleId],
    )) as [{ channel_type: string; status: string }[], unknown];
    if (rows.length >= 2) break;
    await sleep(5000);
  }
  await db.end();
  console.log(JSON.stringify({ delivered: rows }));
  if (rows.length < 2) {
    console.error('the worker did not deliver while the web process was down');
    process.exit(1);
  }
} else {
  console.error('usage: drill.ts seed | more | verify backup|latest | reminder | delivered');
  process.exit(2);
}
