import { expect } from '@playwright/test';
import { client, ledger, origin, password, test, user } from './helpers';

test('session login/logout revocation, no-store and anonymous protection', async ({ request }) => {
  const u = await user('session');
  expect((await request.get('/api/v1/me')).status()).toBe(401);
  const me = await u.client.get('/api/v1/me');
  expect(me.headers()['cache-control']).toContain('no-store');
  expect((await me.json()).data.email).toBe(u.email);
  const cookie = (await u.client.storageState()).cookies.map(c => `${c.name}=${c.value}`).join('; ');
  expect((await u.client.post('/api/auth/sign-out', { data: {} })).ok()).toBeTruthy();
  expect((await request.get('/api/v1/me', { headers: { Cookie: cookie } })).status()).toBe(401);
  expect(
    (
      await u.client.post('/api/auth/sign-in/email', { data: { email: u.email, password: 'incorrect-password' } })
    ).status(),
  ).toBe(401);
  expect((await u.client.post('/api/auth/sign-in/email', { data: { email: u.email, password } })).ok()).toBeTruthy();
  expect((await u.client.get('/api/v1/me')).ok()).toBeTruthy();
  await u.client.dispose();
});
test('tenant isolation, CSRF, validation, ETag and rename persistence', async () => {
  const a = await user('owner');
  const b = await user('outsider');
  const book = await ledger(a.client);
  const base = `/api/v1/ledgers/${book.id}`;
  expect((await b.client.get(base)).status()).toBe(404);
  expect((await b.client.get(`${base}/memberships`)).status()).toBe(404);
  expect((await b.client.patch(base, { data: { name: 'attack' }, headers: { 'If-Match': '"v1"' } })).status()).toBe(
    404,
  );
  expect((await b.client.get('/api/v1/ledgers')).headers()['cache-control']).toContain('private');
  expect((await (await b.client.get('/api/v1/ledgers')).json()).data).toEqual([]);
  expect(
    (await a.client.post('/api/v1/ledgers', { data: { name: 'bad', baseCurrency: 'CNY', timezone: 'Mars' } })).status(),
  ).toBe(422);
  expect(
    (
      await a.client.patch(base, {
        data: { name: 'bad origin' },
        headers: { Origin: 'https://evil.test', 'If-Match': '"v1"' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await a.client.patch(base, { data: { name: 'no origin' }, headers: { Origin: '', 'If-Match': '"v1"' } })).status(),
  ).toBe(403);
  expect((await a.client.patch(base, { data: { name: 'new' } })).status()).toBe(428);
  const changed = await a.client.patch(base, { data: { name: '旅行账本' }, headers: { 'If-Match': '"v1"' } });
  expect(changed.status()).toBe(200);
  expect(changed.headers().etag).toBe('"v2"');
  expect((await a.client.patch(base, { data: { name: 'stale' }, headers: { 'If-Match': '"v1"' } })).status()).toBe(412);
  expect((await (await a.client.get(base)).json()).data.name).toBe('旅行账本');
  await a.client.dispose();
  await b.client.dispose();
});
test('viewer/editor permissions, duplicates, last owner, cross-ledger membership and immediate revocation', async () => {
  const a = await user('members');
  const b = await user('viewer');
  const book = await ledger(a.client);
  const second = await ledger(a.client, '另一本');
  const base = `/api/v1/ledgers/${book.id}/memberships`;
  const added = await a.client.post(base, { data: { email: b.email, role: 'viewer' } });
  expect(added.status()).toBe(201);
  const member = (await added.json()).data;
  expect((await a.client.post(base, { data: { email: b.email, role: 'viewer' } })).status()).toBe(409);
  expect((await b.client.get(`/api/v1/ledgers/${book.id}`)).status()).toBe(200);
  expect((await b.client.get(base)).status()).toBe(403);
  expect((await b.client.post(base, { data: { email: a.email, role: 'owner' } })).status()).toBe(403);
  expect(
    (
      await a.client.delete(`/api/v1/ledgers/${second.id}/memberships/${member.id}`, {
        headers: { 'If-Match': '"v1"' },
      })
    ).status(),
  ).toBe(404);
  const all = (await (await a.client.get(base)).json()).data as { id: string; role: string }[];
  const owner = all.find(m => m.role === 'owner')!;
  expect((await a.client.delete(`${base}/${owner.id}`, { headers: { 'If-Match': '"v1"' } })).status()).toBe(409);
  expect(
    (
      await a.client.patch(`${base}/${member.id}`, { data: { role: 'editor' }, headers: { 'If-Match': '"v1"' } })
    ).status(),
  ).toBe(200);
  expect(
    (
      await b.client.patch(`/api/v1/ledgers/${book.id}`, { data: { name: 'denied' }, headers: { 'If-Match': '"v1"' } })
    ).status(),
  ).toBe(403);
  expect((await a.client.delete(`${base}/${member.id}`, { headers: { 'If-Match': '"v1"' } })).status()).toBe(412);
  expect((await a.client.delete(`${base}/${member.id}`, { headers: { 'If-Match': '"v2"' } })).status()).toBe(204);
  expect((await b.client.get(`/api/v1/ledgers/${book.id}`)).status()).toBe(404);
  await a.client.dispose();
  await b.client.dispose();
});
test('concurrent owner demotions cannot remove the last owner', async () => {
  const a = await user('concurrent-a');
  const b = await user('concurrent-b');
  const book = await ledger(a.client);
  const base = `/api/v1/ledgers/${book.id}/memberships`;
  await a.client.post(base, { data: { email: b.email, role: 'owner' } });
  const all = (await (await a.client.get(base)).json()).data as { id: string; email: string }[];
  const result = await Promise.all(
    all.map(m =>
      (m.email === a.email ? a.client : b.client).patch(`${base}/${m.id}`, {
        data: { role: 'viewer' },
        headers: { 'If-Match': '"v1"', Origin: origin },
      }),
    ),
  );
  expect(result.map(r => r.status()).sort()).toEqual([200, 409]);
  const remaining =
    result[0].status() === 409
      ? all[0].email === a.email
        ? a.client
        : b.client
      : all[1].email === a.email
        ? a.client
        : b.client;
  const members = (await (await remaining.get(base)).json()).data as { role: string }[];
  expect(members.filter(m => m.role === 'owner')).toHaveLength(1);
  await a.client.dispose();
  await b.client.dispose();
});
test('auth attempts are throttled per client without locking out others', async () => {
  const u = await user('throttle');
  const attacker = await client();
  const attempt = (api: typeof attacker) =>
    api.post('/api/auth/sign-in/email', { data: { email: u.email, password: 'incorrect-password' } });
  const statuses: number[] = [];
  for (let i = 0; i < 4; i++) statuses.push((await attempt(attacker)).status());
  expect(statuses).toEqual([401, 401, 401, 429]);
  expect(Number((await attempt(attacker)).headers()['x-retry-after'])).toBeGreaterThan(0);
  expect((await attempt(u.client)).status()).toBe(401);
  expect((await u.client.post('/api/auth/sign-in/email', { data: { email: u.email, password } })).ok()).toBeTruthy();
  await attacker.dispose();
  await u.client.dispose();
});
