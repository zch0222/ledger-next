import assert from 'node:assert/strict';
const base = process.env.BASE_URL;
const seed = process.argv[2] === 'seed';
const credentials = { name: '持久化验证', email: process.env.PERSISTENCE_EMAIL, password: process.env.PERSISTENCE_PASSWORD };
assert.ok(base && credentials.email && credentials.password, 'Persistence environment required');
const response = await fetch(`${base}/api/auth/${seed ? 'sign-up' : 'sign-in'}/email`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
assert.equal(response.status, 200, `Authentication failed: ${response.status}`);
const cookie = response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
assert.ok(cookie, 'Database session cookie required');
const result = await fetch(`${base}/api/v1/ledgers`, { method: seed ? 'POST' : 'GET', headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, ...(seed ? { body: JSON.stringify({ name: '重启后仍在的账本', baseCurrency: 'HKD', timezone: 'Asia/Hong_Kong' }) } : {}) });
assert.equal(result.status, seed ? 201 : 200);
const { data } = await result.json();
if (!seed) {
  assert.equal(data.length, 1);
  assert.equal(data[0].name, '重启后仍在的账本');
  assert.equal(data[0].baseCurrency, 'HKD');
  assert.equal(data[0].role, 'owner');
}
console.log(seed ? 'Persistence fixture created in isolated MySQL' : 'PASS: user, authentication and ledger persisted through Docker restart');
