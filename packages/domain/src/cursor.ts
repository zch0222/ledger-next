import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError } from './policy';

export type Position = (string | number)[];
const invalid = () => new DomainError(400, 'INVALID_CURSOR', '分页游标无效或与当前筛选条件不符，请从第一页重新读取');
const digest = (scope: string) => createHash('sha256').update(scope).digest('base64url').slice(0, 22);

// Opaque keyset cursor: base64url(JSON {v, s, p}) + "." + HMAC. `s` binds the cursor to user, operation,
// ledger and filters, so a cursor cannot be replayed against another listing or tampered into one.
export function cursorCodec(secret: string) {
  const key = createHmac('sha256', secret).update('ledger-next/cursor/v1').digest();
  const sign = (payload: string) => createHmac('sha256', key).update(payload).digest('base64url');
  return {
    encode(scope: string, position: Position) {
      const payload = Buffer.from(JSON.stringify({ v: 1, s: digest(scope), p: position })).toString('base64url');
      return `${payload}.${sign(payload)}`;
    },
    decode(scope: string, cursor: string): Position {
      const [payload, signature, ...rest] = cursor.split('.');
      if (!payload || !signature || rest.length) throw invalid();
      const expected = Buffer.from(sign(payload)), given = Buffer.from(signature);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid();
      let body: { v?: unknown; s?: unknown; p?: unknown };
      try { body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw invalid(); }
      if (body?.v !== 1 || body.s !== digest(scope) || !Array.isArray(body.p)) throw invalid();
      return body.p as Position;
    },
  };
}

/** Builds a page from limit+1 fetched rows. */
export function pageOf<T>(rows: T[], limit: number, position: (row: T) => Position, encode: (position: Position) => string) {
  const data = rows.slice(0, limit), hasMore = rows.length > limit;
  return { data, page: { hasMore, nextCursor: hasMore ? encode(position(data[data.length - 1])) : null } };
}
