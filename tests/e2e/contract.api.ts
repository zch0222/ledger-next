import { randomUUID } from 'node:crypto';
import { expect, request } from '@playwright/test';
import { createLedgerClient, idempotencyKey, ifMatch } from '../../packages/api-client/src/index';
import { expectContract } from './contract';
import { clientIp, ledger, origin, test, user } from './helpers';

const json = { 'Content-Type': 'application/json' };

test('every stable operation answers within the published contract', async () => {
  const a = await user('contract'), b = await user('contract-member');
  await expectContract(await a.client.get('/api/v1/me'), 'getMe', 200);
  const created = await expectContract(await a.client.post('/api/v1/ledgers', { data: { name: '契约账本', baseCurrency: 'JPY', timezone: 'Asia/Tokyo' } }), 'createLedger', 201);
  const id = created.data.id as string, base = `/api/v1/ledgers/${id}`;
  await expectContract(await a.client.get('/api/v1/ledgers'), 'listLedgers', 200);
  await expectContract(await a.client.get(base), 'getLedger', 200);
  await expectContract(await a.client.patch(base, { data: { name: '契约账本 2' }, headers: { 'If-Match': '"v1"' } }), 'updateLedger', 200);
  const member = await expectContract(await a.client.post(`${base}/memberships`, { data: { email: b.email, role: 'viewer' } }), 'createMembership', 201);
  await expectContract(await a.client.get(`${base}/memberships`), 'listMemberships', 200);
  const changed = await expectContract(await a.client.patch(`${base}/memberships/${member.data.id}`, { data: { role: 'editor' }, headers: { 'If-Match': '"v1"' } }), 'updateMembership', 200);
  expect(changed.data).toMatchObject({ id: member.data.id, email: b.email, role: 'editor', version: 2 });
  await expectContract(await a.client.delete(`${base}/memberships/${member.data.id}`, { headers: { 'If-Match': '"v2"' } }), 'deleteMembership', 204);
  const audit = await expectContract(await a.client.get(`${base}/audit-events`), 'listAuditEvents', 200);
  expect(audit.data.map((e: { action: string }) => e.action)).toEqual(['membership.removed', 'membership.updated', 'membership.created', 'ledger.updated', 'ledger.created']);
  await a.client.dispose(); await b.client.dispose();
});

test('error statuses are real, documented and problem+json', async () => {
  const u = await user('status'), book = await ledger(u.client), base = `/api/v1/ledgers/${book.id}`;
  const anonymous = await request.newContext({ baseURL: process.env.BASE_URL ?? origin, extraHTTPHeaders: { Origin: origin, 'X-Forwarded-For': clientIp() } });
  expect((await expectContract(await anonymous.get('/api/v1/me'), 'getMe', 401)).code).toBe('UNAUTHORIZED');
  expect((await expectContract(await u.client.get('/api/v1/ledgers/not-a-uuid'), 'getLedger', 404)).code).toBe('NOT_FOUND');
  expect((await expectContract(await u.client.get(`/api/v1/ledgers/${randomUUID()}`), 'getLedger', 404)).code).toBe('NOT_FOUND');
  expect((await expectContract(await u.client.post('/api/v1/ledgers', { headers: { 'Content-Type': 'text/plain' }, data: 'x' }), 'createLedger', 415)).code).toBe('UNSUPPORTED_MEDIA_TYPE');
  expect((await expectContract(await u.client.post('/api/v1/ledgers', { headers: json, data: Buffer.from('{bad') }), 'createLedger', 400)).code).toBe('BAD_REQUEST');
  expect((await expectContract(await u.client.post('/api/v1/ledgers', { data: { name: 'x'.repeat(20000), baseCurrency: 'CNY', timezone: 'UTC' } }), 'createLedger', 413)).code).toBe('PAYLOAD_TOO_LARGE');
  const invalid = await expectContract(await u.client.post('/api/v1/ledgers', { data: { name: '', baseCurrency: 'GBP', timezone: 'UTC', role: 'owner' } }), 'createLedger', 422);
  expect(invalid.errors.map((e: { path: string }) => e.path)).toEqual(expect.arrayContaining(['name', 'baseCurrency']));
  for (const query of ['limit=0', 'limit=101', 'limit=abc', 'unknown=1']) await expectContract(await u.client.get(`/api/v1/ledgers?${query}`), 'listLedgers', 422);
  await expectContract(await u.client.patch(base, { data: { name: 'n' } }), 'updateLedger', 428);
  await expectContract(await u.client.patch(base, { data: { name: 'n' }, headers: { 'If-Match': '"v9"' } }), 'updateLedger', 412);
  await expectContract(await u.client.patch(base, { data: { name: 'n' }, headers: { 'If-Match': '"v1"', Origin: 'https://evil.example' } }), 'updateLedger', 403);
  const planned = await expectContract(await u.client.get(`${base}/accounts`), 'listAccounts', 501);
  expect(planned).toMatchObject({ code: 'NOT_IMPLEMENTED', status: 501 });
  await expectContract(await u.client.post(`${base}/transactions`, { data: { previewId: randomUUID() }, headers: { 'Idempotency-Key': idempotencyKey() } }), 'createTransaction', 501);
  const unsupported = await u.client.put('/api/v1/ledgers', { data: {} });
  expect(unsupported.status()).toBe(405);
  expect(unsupported.headers().allow).toBe('GET, POST');
  expect((await unsupported.json()).code).toBe('METHOD_NOT_ALLOWED');
  const unknown = await u.client.get('/api/v1/nothing-here');
  expect(unknown.status()).toBe(404);
  expect(unknown.headers()['content-type']).toContain('application/problem+json');
  await anonymous.dispose(); await u.client.dispose();
});

test('cursor pagination is stable, bound to its listing and tamper-proof', async () => {
  const u = await user('paging'), other = await user('paging-other');
  const books = [await ledger(u.client, '第一本'), await ledger(u.client, '第二本'), await ledger(u.client, '第三本')];
  const seen: string[] = [];
  let cursor: string | null = null, pages = 0;
  do {
    const page = await expectContract(await u.client.get(`/api/v1/ledgers?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), 'listLedgers', 200);
    seen.push(...page.data.map((l: { id: string }) => l.id));
    cursor = page.page.nextCursor; pages++;
    expect(page.page.hasMore).toBe(cursor !== null);
  } while (cursor && pages < 10);
  expect(pages).toBe(3);
  expect(new Set(seen)).toEqual(new Set(books.map(b => b.id)));

  const [book, second] = books, audit = `/api/v1/ledgers/${book.id}/audit-events`;
  for (const [i, name] of ['一', '二', '三'].entries()) expect((await u.client.patch(`/api/v1/ledgers/${book.id}`, { data: { name }, headers: { 'If-Match': `"v${i + 1}"` } })).status()).toBe(200);
  const first = await expectContract(await u.client.get(`${audit}?action=ledger.updated&limit=2`), 'listAuditEvents', 200);
  expect(first.data).toHaveLength(2);
  const next = first.page.nextCursor as string;
  const rest = await expectContract(await u.client.get(`${audit}?action=ledger.updated&limit=2&cursor=${encodeURIComponent(next)}`), 'listAuditEvents', 200);
  expect(rest.data).toHaveLength(1);
  expect(rest.page).toEqual({ nextCursor: null, hasMore: false });
  const times = [...first.data, ...rest.data].map((e: { createdAt: string }) => e.createdAt);
  expect([...times].sort().reverse()).toEqual(times);

  const tampered = next.slice(0, -2) + (next.endsWith('AA') ? 'BB' : 'AA');
  for (const url of [`${audit}?action=ledger.updated&cursor=${encodeURIComponent(tampered)}`, `${audit}?cursor=${encodeURIComponent(next)}`, `${audit}?action=ledger.created&cursor=${encodeURIComponent(next)}`, `/api/v1/ledgers/${second.id}/audit-events?action=ledger.updated&cursor=${encodeURIComponent(next)}`, `/api/v1/ledgers?cursor=${encodeURIComponent(next)}`, `${audit}?action=ledger.updated&cursor=garbage`]) {
    const op = url.includes('audit-events') ? 'listAuditEvents' : 'listLedgers';
    expect((await expectContract(await u.client.get(url), op, 400)).code, url).toBe('INVALID_CURSOR');
  }
  const otherBook = await ledger(other.client);
  expect((await other.client.get(`/api/v1/ledgers/${otherBook.id}/audit-events?action=ledger.updated&cursor=${encodeURIComponent(next)}`)).status()).toBe(400);
  expect((await other.client.get(`${audit}`)).status()).toBe(404);
  await u.client.dispose(); await other.client.dispose();
});

test('Idempotency-Key replays the first result and never creates duplicates', async () => {
  const u = await user('idempotent'), v = await user('idempotent-other');
  const body = { name: `幂等-${randomUUID().slice(0, 8)}`, baseCurrency: 'HKD', timezone: 'Asia/Hong_Kong' };
  const key = idempotencyKey();
  const first = await u.client.post('/api/v1/ledgers', { data: body, headers: { 'Idempotency-Key': key } });
  const firstBody = await expectContract(first, 'createLedger', 201);
  expect(first.headers()['idempotent-replayed']).toBeUndefined();
  const again = await u.client.post('/api/v1/ledgers', { data: { timezone: body.timezone, name: body.name, baseCurrency: body.baseCurrency }, headers: { 'Idempotency-Key': key } });
  const againBody = await expectContract(again, 'createLedger', 201);
  expect(again.headers()['idempotent-replayed']).toBe('true');
  expect(again.headers().location).toBe(first.headers().location);
  expect(againBody.data).toEqual(firstBody.data);
  expect(againBody.meta.requestId).not.toBe(firstBody.meta.requestId);
  expect((await expectContract(await u.client.post('/api/v1/ledgers', { data: { ...body, name: '另一个' }, headers: { 'Idempotency-Key': key } }), 'createLedger', 409)).code).toBe('IDEMPOTENCY_KEY_REUSED');
  const foreign = await expectContract(await v.client.post('/api/v1/ledgers', { data: body, headers: { 'Idempotency-Key': key } }), 'createLedger', 201);
  expect(foreign.data.id).not.toBe(firstBody.data.id);
  expect((await expectContract(await u.client.post('/api/v1/ledgers', { data: body, headers: { 'Idempotency-Key': 'bad key' } }), 'createLedger', 400)).code).toBe('INVALID_IDEMPOTENCY_KEY');

  // Concurrent duplicates serialize on the key: one ledger, identical responses.
  const racing = idempotencyKey(), raced = { ...body, name: `并发-${randomUUID().slice(0, 8)}` };
  const results = await Promise.all(Array.from({ length: 6 }, () => u.client.post('/api/v1/ledgers', { data: raced, headers: { 'Idempotency-Key': racing } })));
  expect(results.map(r => r.status())).toEqual(Array(6).fill(201));
  expect(new Set(await Promise.all(results.map(async r => (await r.json()).data.id))).size).toBe(1);
  expect(results.filter(r => r.headers()['idempotent-replayed'] === 'true')).toHaveLength(5);
  const all = (await (await u.client.get('/api/v1/ledgers?limit=100')).json()).data as { name: string }[];
  expect(all.filter(l => l.name === body.name)).toHaveLength(1);
  expect(all.filter(l => l.name === raced.name)).toHaveLength(1);

  // A failed attempt stores nothing, so the same key can carry the corrected request.
  const retry = idempotencyKey();
  await expectContract(await u.client.post('/api/v1/ledgers', { data: { ...body, timezone: 'Mars/Base' }, headers: { 'Idempotency-Key': retry } }), 'createLedger', 422);
  await expectContract(await u.client.post('/api/v1/ledgers', { data: { ...body, name: '更正后' }, headers: { 'Idempotency-Key': retry } }), 'createLedger', 201);

  // A retried membership add replays instead of failing with MEMBERSHIP_EXISTS.
  const members = `/api/v1/ledgers/${firstBody.data.id}/memberships`, add = idempotencyKey();
  const added = await expectContract(await u.client.post(members, { data: { email: v.email, role: 'viewer' }, headers: { 'Idempotency-Key': add } }), 'createMembership', 201);
  const replayed = await expectContract(await u.client.post(members, { data: { email: v.email, role: 'viewer' }, headers: { 'Idempotency-Key': add } }), 'createMembership', 201);
  expect(replayed.data.id).toBe(added.data.id);
  const audit = (await (await u.client.get(`/api/v1/ledgers/${firstBody.data.id}/audit-events`)).json()).data as { action: string }[];
  expect(audit.map(e => e.action)).toEqual(['membership.created', 'ledger.created']);
  await u.client.dispose(); await v.client.dispose();
});

test('generated SDK works against the real server', async () => {
  const u = await user('sdk');
  const cookie = (await u.client.storageState()).cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const sdk = createLedgerClient({ baseUrl: process.env.BASE_URL ?? origin, headers: { Cookie: cookie, Origin: origin, 'X-Forwarded-For': clientIp() } });
  const me = await sdk.GET('/me');
  expect(me.response.status).toBe(200);
  expect(me.data?.data.email).toBe(u.email);
  const key = idempotencyKey();
  const created = await sdk.POST('/ledgers', { body: { name: 'SDK 账本', baseCurrency: 'USD', timezone: 'UTC' }, params: { header: { 'Idempotency-Key': key } } });
  expect(created.response.status).toBe(201);
  const ledgerId = created.data!.data.id;
  const renamed = await sdk.PATCH('/ledgers/{ledgerId}', { params: { path: { ledgerId }, header: { 'If-Match': ifMatch(created.data!.data.version) } }, body: { name: 'SDK 账本（改名）' } });
  expect(renamed.data?.data).toMatchObject({ name: 'SDK 账本（改名）', version: 2 });
  const stale = await sdk.PATCH('/ledgers/{ledgerId}', { params: { path: { ledgerId }, header: { 'If-Match': ifMatch(1) } }, body: { name: '过期写入' } });
  expect(stale.response.status).toBe(412);
  expect(stale.error?.code).toBe('VERSION_CONFLICT');
  const members = await sdk.GET('/ledgers/{ledgerId}/memberships', { params: { path: { ledgerId }, query: { limit: 10 } } });
  expect(members.data?.data).toHaveLength(1);
  expect(members.data?.page).toEqual({ nextCursor: null, hasMore: false });
  const replay = await sdk.POST('/ledgers', { body: { name: 'SDK 账本', baseCurrency: 'USD', timezone: 'UTC' }, params: { header: { 'Idempotency-Key': key } } });
  expect(replay.response.headers.get('Idempotent-Replayed')).toBe('true');
  expect(replay.data?.data.id).toBe(ledgerId);
  const anonymous = await createLedgerClient({ baseUrl: process.env.BASE_URL ?? origin }).GET('/me');
  expect(anonymous.response.status).toBe(401);
  await u.client.dispose();
});

