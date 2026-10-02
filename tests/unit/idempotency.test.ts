import { expect, it } from 'vitest';
import { canonicalJson, idempotencyScope, requestFingerprint, validateIdempotencyKey } from '../../packages/domain/src/idempotency';

it('accepts UUIDs and opaque keys, rejects missing-when-required and malformed keys', () => {
  expect(validateIdempotencyKey('7a1c3a52-5b0e-4e0e-9f43-8d2d0c7f1e11', 'required')).toBe('7a1c3a52-5b0e-4e0e-9f43-8d2d0c7f1e11');
  expect(validateIdempotencyKey('client:ledger.create_01', 'optional')).toBe('client:ledger.create_01');
  expect(validateIdempotencyKey(null, 'optional')).toBeNull();
  expect(() => validateIdempotencyKey(null, 'required')).toThrow(expect.objectContaining({ status: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' }));
  for (const key of ['short', 'has space in it', 'x'.repeat(129), '中文中文中文中文', 'semi;colon-key']) expect(() => validateIdempotencyKey(key, 'optional')).toThrow(expect.objectContaining({ code: 'INVALID_IDEMPOTENCY_KEY' }));
});
it('fingerprints the request body independent of key order and whitespace', () => {
  expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}');
  expect(requestFingerprint(JSON.parse('{ "name": "家庭", "baseCurrency": "CNY" }'))).toBe(requestFingerprint({ baseCurrency: 'CNY', name: '家庭' }));
  expect(requestFingerprint({ name: '家庭' })).not.toBe(requestFingerprint({ name: '家庭 ' }));
  expect(requestFingerprint(undefined)).toBe(requestFingerprint(null));
  expect(requestFingerprint([1, 2])).not.toBe(requestFingerprint([2, 1]));
});
it('scopes keys by actor, method and canonical path', () => {
  const base = idempotencyScope('user-a', 'post', '/api/v1/ledgers', 'key-12345678');
  expect(base).toMatch(/^[0-9a-f]{64}$/);
  expect(idempotencyScope('user-a', 'POST', '/api/v1/ledgers', 'key-12345678')).toBe(base);
  for (const other of [idempotencyScope('user-b', 'POST', '/api/v1/ledgers', 'key-12345678'), idempotencyScope('user-a', 'POST', '/api/v1/ledgers/x/memberships', 'key-12345678'), idempotencyScope('user-a', 'POST', '/api/v1/ledgers', 'key-87654321')])
    expect(other).not.toBe(base);
});
