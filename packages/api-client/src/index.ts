import createClient from 'openapi-fetch';
import type { components, paths } from './schema';

export type { components, operations, paths } from './schema';
export type Problem = components['schemas']['Problem'];

export interface LedgerClientOptions {
  /** Origin of the Ledger deployment, e.g. https://ledger.example */
  baseUrl: string;
  /** Personal Access Token (Bearer). Omit for cookie-session callers that pass headers themselves. */
  token?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

/** Typed REST client generated from the v1 OpenAPI contract. Responses keep HTTP semantics: check `error` / `response.status`. */
export function createLedgerClient(options: LedgerClientOptions) {
  const client = createClient<paths>({
    baseUrl: `${options.baseUrl.replace(/\/$/, '')}/api/v1`,
    headers: { ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...options.headers },
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return client;
}

/** A fresh key per user intent; reuse the same key only when retrying that intent. */
export function idempotencyKey() { return crypto.randomUUID(); }

/** Header value for If-Match from a resource version. */
export function ifMatch(version: number) { return `"v${version}"`; }

