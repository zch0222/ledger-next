import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { cursorCodec, pageOf } from '../../packages/domain/src/cursor';

const codec = cursorCodec('test-secret-at-least-32-characters-long');
const scope = JSON.stringify(['user-1', 'listAuditEvents', 'ledger-1', { action: 'ledger.updated' }]);
const position = ['2026-10-02T01:02:03.004Z', '7a1c3a52-5b0e-4e0e-9f43-8d2d0c7f1e11'];
const rejected = expect.objectContaining({ status: 400, code: 'INVALID_CURSOR' });

it('round-trips an opaque position', () => {
  const cursor = codec.encode(scope, position);
  expect(cursor).not.toContain('2026');
  expect(codec.decode(scope, cursor)).toEqual(position);
});
it('rejects tampered payloads, signatures and malformed cursors', () => {
  const cursor = codec.encode(scope, position);
  const [payload, signature] = cursor.split('.');
  const forged = Buffer.from(JSON.stringify({ v: 1, s: 'x', p: ['2099-01-01T00:00:00.000Z', 'id'] })).toString('base64url');
  for (const bad of [`${forged}.${signature}`, `${payload}.${signature.slice(1)}x`, `${payload}.`, payload, `${cursor}.extra`, '', '..', '%%%.###'])
    expect(() => codec.decode(scope, bad)).toThrow(rejected);
});
it('binds cursors to scope and secret', () => {
  const cursor = codec.encode(scope, position);
  expect(() => codec.decode(scope.replace('ledger.updated', 'ledger.created'), cursor)).toThrow(rejected);
  expect(() => codec.decode(scope.replace('ledger-1', 'ledger-2'), cursor)).toThrow(rejected);
  expect(() => cursorCodec('another-secret-at-least-32-characters').decode(scope, cursor)).toThrow(rejected);
});
it('rejects a correctly signed body with the wrong version or shape', () => {
  // Mirrors the codec's key derivation so only the body checks can fail.
  const key = createHmac('sha256', 'test-secret-at-least-32-characters-long').update('ledger-next/cursor/v1').digest();
  const signed = (raw: string) => { const payload = Buffer.from(raw).toString('base64url'); return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`; };
  const s = JSON.parse(Buffer.from(codec.encode(scope, position).split('.')[0], 'base64url').toString()).s;
  expect(codec.decode(scope, signed(JSON.stringify({ v: 1, s, p: position })))).toEqual(position);
  for (const raw of [JSON.stringify({ v: 2, s, p: position }), JSON.stringify({ v: 1, s, p: 'x' }), JSON.stringify(null), 'not json'])
    expect(() => codec.decode(scope, signed(raw))).toThrow(rejected);
});
it('pages limit + 1 rows into data, hasMore and a cursor for the last row', () => {
  const rows = [1, 2, 3].map(n => ({ id: `id-${n}` }));
  expect(pageOf(rows, 2, r => [r.id], p => `c:${p[0]}`)).toEqual({ data: rows.slice(0, 2), page: { hasMore: true, nextCursor: 'c:id-2' } });
  expect(pageOf(rows.slice(0, 2), 2, r => [r.id], p => `c:${p[0]}`)).toEqual({ data: rows.slice(0, 2), page: { hasMore: false, nextCursor: null } });
  expect(pageOf([], 50, (r: { id: string }) => [r.id], String)).toEqual({ data: [], page: { hasMore: false, nextCursor: null } });
});
