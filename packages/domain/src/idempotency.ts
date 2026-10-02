import { createHash } from 'node:crypto';
import { DomainError } from './policy';

export const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function validateIdempotencyKey(key: string | null, mode: 'required' | 'optional') {
  if (key === null) {
    if (mode === 'required') throw new DomainError(400, 'IDEMPOTENCY_KEY_REQUIRED', '此操作需要 Idempotency-Key 请求头');
    return null;
  }
  if (!KEY.test(key)) throw new DomainError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key 须为 8–128 位字母、数字或 . _ : -');
  return key;
}

/** JSON with object keys sorted, so formatting and key order do not change the request fingerprint. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
export const requestFingerprint = (body: unknown) => sha256(canonicalJson(body));
export const idempotencyScope = (actorId: string, method: string, path: string, key: string) => sha256([actorId, method.toUpperCase(), path, key].join('\n'));
