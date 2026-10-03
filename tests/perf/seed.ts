import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { BASE, call, data, ok, OUT, pool, signUp, sleep, type Session } from './lib';

/**
 * M7-PERF seed (TECHNICAL_DESIGN §7.3): PERF_USERS users (default 1,000) with a small ledger each, and one large ledger
 * with PERF_BIG_TX transactions (default 100,000) over the last two years, loaded through the public CSV import in
 * 10,000-row batches so every invariant (postings, balances, audit) holds exactly as in production.
 */
const USERS = Number(process.env.PERF_USERS ?? 1000);
const BIG = Number(process.env.PERF_BIG_TX ?? 100_000);
const SMALL_TX = Number(process.env.PERF_SMALL_TX ?? 5);
const TZ = 'Asia/Hong_Kong';
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

async function book(session: Session, name: string, opening: string) {
  const ledger = data<{ id: string }>(
    ok(await call(session, 'POST', '/api/v1/ledgers', { name, baseCurrency: 'CNY', timezone: TZ }), 'ledger'),
  );
  const base = `/api/v1/ledgers/${ledger.id}`;
  const account = data<{ id: string }>(
    ok(
      await call(session, 'POST', `${base}/accounts`, {
        name: '现金',
        type: 'cash',
        currency: 'CNY',
        openingBalance: opening,
      }),
      'account',
    ),
  );
  return { ledgerId: ledger.id, base, accountId: account.id };
}

async function bigLedger() {
  const session = await signUp(0, 'perf-big');
  const b = await book(session, '大账本', '100000000');
  const expense = ['餐饮', '交通', '购物', '住房', '娱乐', '医疗', '教育', '旅行'];
  for (const name of expense) {
    ok(await call(session, 'POST', `${b.base}/categories`, { name, kind: 'expense' }), 'category');
  }
  ok(await call(session, 'POST', `${b.base}/categories`, { name: '工资', kind: 'income' }), 'category');
  const mapping = JSON.stringify({
    columns: { date: '日期', amount: '金额', account: '账户', category: '分类', merchant: '商家', note: '备注' },
  });
  const today = Date.now();
  let written = 0;
  for (let batch = 0; written < BIG; batch++) {
    const rows = Math.min(10_000, BIG - written);
    const lines = ['日期,金额,账户,分类,商家,备注'];
    for (let i = 0; i < rows; i++) {
      const n = written + i;
      const day = new Date(today - Math.floor(Math.random() * 730) * 86_400_000).toISOString().slice(0, 10);
      const income = n % 50 === 0;
      const amount = income ? (5000 + Math.random() * 20000).toFixed(2) : (-(1 + Math.random() * 499)).toFixed(2);
      lines.push(`${day},${amount},现金,${income ? '工资' : expense[n % expense.length]},商户${n % 500},#${n}`);
    }
    const form = new FormData();
    form.set('file', new Blob([lines.join('\r\n')], { type: 'text/csv' }), `perf-${batch}.csv`);
    form.set('mapping', mapping);
    const started = Date.now();
    const upload = await fetch(`${BASE}${b.base}/import-jobs`, {
      method: 'POST',
      body: form,
      headers: {
        Cookie: session.cookie,
        Origin: BASE,
        'X-Forwarded-For': session.xff,
        'Idempotency-Key': randomUUID(),
      },
    });
    if (upload.status !== 202) throw new Error(`import upload: HTTP ${upload.status} ${await upload.text()}`);
    const job = ((await upload.json()) as { data: { id: string } }).data;
    const status = async () =>
      data<{ status: string; validRows: number; errorRows: number; failureReason: string | null }>(
        ok(await call(session, 'GET', `${b.base}/import-jobs/${job.id}`), 'import status'),
      );
    let s = await status();
    while (s.status === 'validating') {
      await sleep(1000);
      s = await status();
    }
    if (s.status !== 'validated' || s.errorRows) {
      throw new Error(`import ${batch}: ${s.status} ${s.errorRows} errors ${s.failureReason ?? ''}`);
    }
    ok(
      await call(session, 'POST', `${b.base}/import-jobs/${job.id}/commits`, undefined, {
        'Idempotency-Key': randomUUID(),
      }),
      'import commit',
    );
    while ((s = await status()).status === 'committing') await sleep(1000);
    if (s.status !== 'committed') throw new Error(`import ${batch} commit: ${s.status} ${s.failureReason ?? ''}`);
    written += rows;
    console.error(
      `big ledger: ${written}/${BIG} transactions (batch ${batch + 1} in ${((Date.now() - started) / 1000).toFixed(1)} s)`,
    );
  }
  return { ...session, ...b };
}

async function smallUser(index: number) {
  const session = await signUp(index, 'perf');
  const b = await book(session, `账本 ${index}`, '10000');
  const category = data<{ id: string }>(
    ok(await call(session, 'POST', `${b.base}/categories`, { name: '餐饮', kind: 'expense' }), 'category'),
  );
  for (let i = 0; i < SMALL_TX; i++) {
    const preview = data<{ previewId: string }>(
      ok(
        await call(session, 'POST', `${b.base}/transaction-previews`, {
          kind: 'expense',
          accountId: b.accountId,
          categoryId: category.id,
          settlement: { amount: (10 + i).toFixed(2), currency: 'CNY' },
          occurredAt: ago(60 * 24 * i + 5),
          timezone: TZ,
        }),
        'preview',
      ),
    );
    ok(
      await call(
        session,
        'POST',
        `${b.base}/transactions`,
        { previewId: preview.previewId },
        { 'Idempotency-Key': randomUUID() },
      ),
      'transaction',
    );
  }
  return { ...session, ...b, categoryId: category.id };
}

const started = Date.now();
mkdirSync(OUT, { recursive: true });
const big = await bigLedger();
const bigSeconds = (Date.now() - started) / 1000;
let done = 0;
const users = await pool(
  Array.from({ length: USERS }, (_, i) => i + 1),
  20,
  async index => {
    const user = await smallUser(index);
    if (++done % 100 === 0) console.error(`users: ${done}/${USERS}`);
    return user;
  },
);
writeFileSync(
  `${OUT}/seed.json`,
  JSON.stringify({
    big,
    users,
    seededAt: new Date().toISOString(),
    seconds: { big: bigSeconds, total: (Date.now() - started) / 1000 },
    config: { USERS, BIG, SMALL_TX },
  }),
);
console.error(`seed done in ${((Date.now() - started) / 1000).toFixed(0)} s`);
