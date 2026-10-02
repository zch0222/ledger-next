import { randomUUID } from 'node:crypto';
import { expect, request } from '@playwright/test';
import { book, client, clientIp, origin, test } from './helpers';

// M7-SEC: enumeration, caching, cookies, CORS, stored markup and rate limits, on top of the per-milestone suites
// (CSRF and isolation in identity.api.ts, CSV formula guard in imports.api.ts, SSRF in notify.api.ts, approvals in agents.api.ts).
const BASE = process.env.BASE_URL ?? origin;
const strip = (body: Record<string, unknown>) => { const { requestId, ...rest } = body; void requestId; return rest; };

test('another user cannot tell whether any of my resources exist (AC07)', async () => {
  test.setTimeout(90_000);
  const a = await book('enum-a', '5000'), b = await book('enum-b');
  const tx = await a.record({ kind: 'expense', accountId: a.cash.id, categoryId: a.food.id, settlement: { amount: '88.00', currency: 'CNY' }, merchant: '秘密商户' });
  const tag = await a.post('/tags', { name: '私密' });
  const sub = await (async () => { const p = await a.post('/subscription-previews', { name: '会员', amount: { amount: '20.00', currency: 'USD' }, cycle: { unit: 'month', count: 1 }, anchorDate: '2026-11-05', timezone: 'Asia/Hong_Kong' }); return a.post('/subscriptions', { previewId: p.previewId }, { 'Idempotency-Key': randomUUID() }); })();
  const budget = await a.post('/budgets', { name: '餐饮', categoryId: a.food.id, period: 'month', amount: { amount: '500.00', currency: 'CNY' }, startDate: '2026-10-01', alertThresholds: [80] });
  const exportJob = await a.post('/export-jobs', { format: 'csv' });
  const approval = await a.post('/approval-requests', { method: 'DELETE', path: `${a.base}/transactions/${tx.id}`, body: null, summary: '作废' });
  const owned: [string, string][] = [['transactions', tx.id], ['accounts', a.cash.id], ['categories', a.food.id], ['tags', tag.id], ['subscriptions', sub.id], ['budgets', budget.id], ['export-jobs', exportJob.id], ['approval-requests', approval.id]];

  const notFound = strip(await (await b.client.get(`/api/v1/ledgers/${a.ledger.id}/transactions/${randomUUID()}`)).json());
  expect(notFound).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  for (const [type, id] of owned) {
    for (const path of [`/api/v1/ledgers/${a.ledger.id}/${type}/${id}`, `${b.base}/${type}/${id}`]) {
      const response = await b.client.get(path);
      expect(response.status(), path).toBe(404);
      const body = await response.json();
      expect(strip(body), path).toEqual(notFound); // same answer as for an id that never existed
      expect(JSON.stringify(body)).not.toMatch(/88\.00|秘密商户|会员/);
    }
    expect((await b.client.patch(`${b.base}/${type}/${id}`, { data: {}, headers: { 'If-Match': '"v1"' } })).status()).toBeGreaterThanOrEqual(400);
  }
  for (const path of [`/api/v1/ledgers/${a.ledger.id}`, `/api/v1/ledgers/${a.ledger.id}/transactions`, `/api/v1/ledgers/${a.ledger.id}/reports/summary?dateFrom=2026-01-01&dateTo=2027-01-01`, `/api/v1/ledgers/${a.ledger.id}/operations/${randomUUID()}`, '/api/v1/ledgers/not-a-uuid/transactions']) {
    expect((await b.client.get(path)).status(), path).toBe(404);
  }
  // A's own view is unaffected.
  expect((await a.client.get(`${a.base}/transactions/${tx.id}`)).status()).toBe(200);
  await a.client.dispose(); await b.client.dispose();
});

test('responses are never cacheable across users; security headers on pages and API; cookies are HttpOnly', async () => {
  const a = await book('cache-a');
  for (const path of ['/api/v1/me', `${a.base}/transactions`, `${a.base}/reports/summary?dateFrom=2026-01-01&dateTo=2027-01-01`, `${a.base}/transactions/${randomUUID()}`, '/api/v1/exchange-rates?base=USD&quotes=CNY']) {
    const response = await a.client.get(path);
    expect(response.headers()['cache-control'], path).toMatch(/private.*no-store|no-store.*private/);
    expect(response.headers()['x-content-type-options'], path).toBe('nosniff');
  }
  for (const path of [`/ledgers/${a.ledger.id}/dashboard`, `/ledgers/${a.ledger.id}/transactions`, '/login']) {
    const response = await a.client.get(path);
    const headers = response.headers();
    expect(headers['cache-control'], path).toContain('no-store');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
  }
  // Static chunks are immutable and carry no user data.
  const html = await (await a.client.get(`/ledgers/${a.ledger.id}/dashboard`)).text();
  const chunk = /\/_next\/static\/[^"']+\.js/.exec(html)![0];
  expect((await a.client.get(chunk)).headers()['cache-control']).toContain('immutable');
  // Session cookie flags.
  const anon = await client();
  const signIn = await anon.post('/api/auth/sign-in/email', { data: { email: a.email, password: 'Ledger-test-only-2026!' } });
  const cookie = signIn.headersArray().filter(h => h.name.toLowerCase() === 'set-cookie').map(h => h.value).find(v => /session_token=/.test(v))!;
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  if (BASE.startsWith('https:')) expect(cookie).toMatch(/Secure/i);
  // No credentialed CORS for other origins.
  const evil = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: 'https://evil.example', 'X-Forwarded-For': clientIp() } });
  const preflight = await evil.fetch('/api/v1/me', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'GET' } });
  expect(preflight.headers()['access-control-allow-origin']).toBeUndefined();
  expect((await a.client.get('/api/v1/me', { headers: { Origin: 'https://evil.example' } })).headers()['access-control-allow-origin']).toBeUndefined();
  await evil.dispose(); await anon.dispose(); await a.client.dispose();
});

test('stored markup from notes, merchants and imports is shown as text, never as HTML', async () => {
  const a = await book('xss', '5000');
  const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  await a.record({ kind: 'expense', accountId: a.cash.id, categoryId: a.food.id, settlement: { amount: '1.00', currency: 'CNY' }, merchant: payload, note: payload });
  await a.post('/categories', { name: '<b>粗体</b>', kind: 'expense' });
  for (const path of [`/ledgers/${a.ledger.id}/transactions`, `/ledgers/${a.ledger.id}/dashboard`, `/ledgers/${a.ledger.id}/settings`]) {
    const html = await (await a.client.get(path)).text();
    expect(html, path).not.toContain('<img src=x onerror');
    expect(html, path).not.toContain('<script>alert(2)');
    expect(html, path).not.toContain('<b>粗体</b>');
  }
  await a.client.dispose();
});

test('rate limits: an Agent token cannot loop money writes, and failed authentication is throttled per client', async () => {
  test.setTimeout(90_000);
  const a = await book('limits', '100000');
  const issued = (await (await a.client.post('/api/v1/api-tokens', { data: { name: 'loop', scopes: ['transactions:read', 'transactions:write'], ledgerIds: [a.ledger.id], expiresInDays: 1 } })).json()).data;
  const agent = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { Authorization: `Bearer ${issued.token}` } });
  const limit = Number(process.env.AGENT_WRITE_RATE_LIMIT ?? 30);
  let refused: Awaited<ReturnType<typeof agent.post>> | null = null, written = 0;
  for (let i = 0; i <= limit + 1 && !refused; i++) {
    const preview = (await (await agent.post(`${a.base}/transaction-previews`, { data: { kind: 'expense', accountId: a.cash.id, settlement: { amount: '1.00', currency: 'CNY' }, occurredAt: new Date(Date.now() - 60_000).toISOString(), timezone: 'Asia/Hong_Kong' } })).json()).data;
    const response = await agent.post(`${a.base}/transactions`, { data: { previewId: preview.previewId }, headers: { 'Idempotency-Key': randomUUID() } });
    if (response.status() === 429) refused = response; else { expect(response.status()).toBe(201); written++; }
  }
  expect(refused, 'the Agent write budget must run out').not.toBeNull();
  expect(written).toBeLessThanOrEqual(limit);
  expect(await refused!.json()).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
  expect(Number(refused!.headers()['retry-after'])).toBeGreaterThan(0);
  expect((await agent.get(`${a.base}/transactions`)).status()).toBe(200); // reads are still fine
  expect((await a.client.post(`${a.base}/transaction-previews`, { data: { kind: 'expense', accountId: a.cash.id, settlement: { amount: '1.00', currency: 'CNY' }, occurredAt: new Date().toISOString(), timezone: 'Asia/Hong_Kong' } })).status()).toBe(201); // the person in the browser is not blocked

  // Guessing tokens from one address: refused after the failure budget, even with a valid token; other clients unaffected.
  const attacker = clientIp(), failures = Number(process.env.API_AUTH_FAILURE_LIMIT ?? 30);
  const guess = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { 'X-Forwarded-For': attacker } });
  for (let i = 0; i < failures; i++) expect((await guess.get('/api/v1/me', { headers: { Authorization: `Bearer lnp_${randomUUID().replace(/-/g, '')}${'x'.repeat(11)}` } })).status()).toBe(401);
  const blocked = await guess.get('/api/v1/me', { headers: { Authorization: `Bearer ${issued.token}` } });
  expect(blocked.status()).toBe(429);
  expect(Number(blocked.headers()['retry-after'])).toBeGreaterThan(0);
  expect((await agent.get('/api/v1/me', { headers: { 'X-Forwarded-For': clientIp() } })).status()).toBe(200);
  await guess.dispose(); await agent.dispose(); await a.client.dispose();
});
