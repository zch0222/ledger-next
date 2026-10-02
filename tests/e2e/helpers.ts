import { randomInt, randomUUID } from 'node:crypto';
import { test as base, expect, request, type APIRequestContext } from '@playwright/test';
export const origin = process.env.APP_ORIGIN ?? process.env.BASE_URL ?? 'http://localhost:3000';
export const password = 'Ledger-test-only-2026!';
// Every request leaves the single test container, so auth throttling (3 sign-in / sign-up per 10 s per client)
// would put all tests in one bucket. Each simulated user gets its own client address, as the reverse proxy supplies in production.
let nextClient = randomInt(0, 60000);
export function clientIp() { const n = nextClient++ % 65536; return `198.18.${n >> 8}.${n & 255}`; }
export const test = base.extend({ extraHTTPHeaders: async ({}, provide) => { await provide({ 'X-Forwarded-For': clientIp() }); } });
export function client(ip = clientIp()) {
  return request.newContext({ baseURL: process.env.BASE_URL ?? origin, extraHTTPHeaders: { Origin: origin, 'X-Forwarded-For': ip } });
}
export async function user(prefix: string) {
  const email = `${prefix}-${randomUUID()}@example.test`;
  const api = await client();
  const response = await api.post('/api/auth/sign-up/email', { data: { name: prefix, email, password } });
  expect(response.status(), await response.text()).toBe(200);
  return { client: api, email };
}
export async function ledger(api: APIRequestContext, name = '家庭账本') {
  const response = await api.post('/api/v1/ledgers', { data: { name, baseCurrency: 'CNY', timezone: 'Asia/Hong_Kong' } });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).data as { id: string; name: string; version: number };
}
