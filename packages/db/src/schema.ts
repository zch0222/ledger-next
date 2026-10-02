import { boolean, char, datetime, index, int, mediumtext, mysqlEnum, mysqlTable, smallint, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

const id = () => varchar('id', { length: 36 }).primaryKey();
const createdAt = () => datetime('created_at', { mode: 'date', fsp: 3 }).notNull();
const updatedAt = () => datetime('updated_at', { mode: 'date', fsp: 3 }).notNull();

export const user = mysqlTable('users', {
  id: id(), name: varchar('name', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'), createdAt: createdAt(), updatedAt: updatedAt(),
});
export const session = mysqlTable('sessions', {
  id: id(), expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  createdAt: createdAt(), updatedAt: updatedAt(), ipAddress: varchar('ip_address', { length: 64 }),
  userAgent: text('user_agent'), userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }),
}, t => [index('sessions_user_idx').on(t.userId)]);
export const account = mysqlTable('auth_accounts', {
  id: id(), accountId: varchar('account_id', { length: 255 }).notNull(),
  providerId: varchar('provider_id', { length: 255 }).notNull(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'), refreshToken: text('refresh_token'), idToken: text('id_token'),
  accessTokenExpiresAt: datetime('access_token_expires_at', { mode: 'date', fsp: 3 }),
  refreshTokenExpiresAt: datetime('refresh_token_expires_at', { mode: 'date', fsp: 3 }),
  scope: text('scope'), password: text('password'), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex('auth_provider_account_uq').on(t.providerId, t.accountId), index('auth_accounts_user_idx').on(t.userId)]);
export const verification = mysqlTable('verifications', {
  id: id(), identifier: varchar('identifier', { length: 255 }).notNull(), value: text('value').notNull(),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [index('verifications_identifier_idx').on(t.identifier)]);
export const ledgers = mysqlTable('ledgers', {
  id: id(), name: varchar('name', { length: 80 }).notNull(),
  baseCurrency: varchar('base_currency', { length: 3 }).notNull(), timezone: varchar('timezone', { length: 64 }).notNull(),
  version: int('version').notNull().default(1), createdAt: createdAt(), updatedAt: updatedAt(),
});
export const memberships = mysqlTable('memberships', {
  id: id(), ledgerId: varchar('ledger_id', { length: 36 }).notNull().references(() => ledgers.id, { onDelete: 'cascade' }),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: mysqlEnum('role', ['owner', 'editor', 'viewer']).notNull(),
  version: int('version').notNull().default(1), createdAt: createdAt(),
}, t => [uniqueIndex('membership_ledger_user_uq').on(t.ledgerId, t.userId), index('membership_user_idx').on(t.userId)]);
export const auditLogs = mysqlTable('audit_logs', {
  id: id(), ledgerId: varchar('ledger_id', { length: 36 }).notNull().references(() => ledgers.id),
  actorId: varchar('actor_id', { length: 36 }).notNull().references(() => user.id),
  action: varchar('action', { length: 80 }).notNull(), resourceId: varchar('resource_id', { length: 36 }).notNull(),
  requestId: varchar('request_id', { length: 36 }).notNull(), createdAt: createdAt(),
}, t => [index('audit_ledger_date_idx').on(t.ledgerId, t.createdAt)]);
export const idempotencyRecords = mysqlTable('idempotency_records', {
  scopeHash: char('scope_hash', { length: 64 }).primaryKey(),
  actorId: varchar('actor_id', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }),
  method: varchar('method', { length: 10 }).notNull(), path: varchar('path', { length: 255 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(), requestHash: char('request_hash', { length: 64 }).notNull(),
  responseStatus: smallint('response_status').notNull(), responseBody: mediumtext('response_body').notNull(), responseHeaders: text('response_headers').notNull(),
  createdAt: createdAt(), expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
}, t => [index('idempotency_expiry_idx').on(t.expiresAt), index('idempotency_actor_idx').on(t.actorId)]);
