import { expect, it } from 'vitest';
import { ledgerInput, ledgerPatch, memberInput, memberPatch, uuid } from '../../packages/contracts/src/identity';
const valid = { name: '家庭账本', baseCurrency: 'CNY', timezone: 'Asia/Hong_Kong' };
it('normalizes names while preserving IANA timezone and ISO currency', () => {
  expect(ledgerInput.parse({ ...valid, name: ' 家庭账本 ' })).toEqual(valid);
  for (const timezone of ['UTC', 'America/New_York', 'Asia/Shanghai']) expect(ledgerInput.safeParse({ ...valid, timezone }).success).toBe(true);
});
it('rejects invalid and overlong input and injected authorization', () => {
  for (const data of [{ ...valid, name: ' ' }, { ...valid, name: 'a'.repeat(81) }, { ...valid, timezone: 'Mars/Test' }, { ...valid, baseCurrency: 'cny' }, { ...valid, userId: 'attacker' }, { ...valid, role: 'owner' }]) expect(ledgerInput.safeParse(data).success).toBe(false);
  expect(ledgerPatch.safeParse({ name: 'changed', baseCurrency: 'USD' }).success).toBe(false);
});
it('validates membership input and resource UUIDs', () => {
  expect(memberInput.parse({ email: 'PERSON@EXAMPLE.COM', role: 'viewer' }).email).toBe('person@example.com');
  expect(memberPatch.safeParse({ role: 'admin' }).success).toBe(false);
  expect(memberPatch.safeParse({ role: 'editor', userId: 'forged' }).success).toBe(false);
  expect(uuid.safeParse('not-a-uuid').success).toBe(false);
  expect(uuid.safeParse('af047bf7-3254-47d1-9e07-4f2e97cb4184').success).toBe(true);
});
