import { boolean, char, date, datetime, decimal, index, int, json, mediumtext, mysqlEnum, mysqlTable, primaryKey, smallint, text, tinyint, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

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

// M2-MODEL ledger core (migration 0003). DECIMAL columns map to strings; never convert them to JS numbers.
const money = (name: string) => decimal(name, { precision: 24, scale: 6 });
const ledgerId = () => varchar('ledger_id', { length: 36 }).notNull().references(() => ledgers.id);
export const currencies = mysqlTable('currencies', {
  code: varchar('code', { length: 3 }).primaryKey(), minorUnits: tinyint('minor_units', { unsigned: true }).notNull(), enabled: boolean('enabled').notNull(),
});
export const accounts = mysqlTable('accounts', {
  id: id(), ledgerId: ledgerId(), name: varchar('name', { length: 80 }).notNull(),
  type: mysqlEnum('type', ['cash', 'bank', 'credit_card', 'e_wallet', 'investment', 'other']).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().references(() => currencies.code),
  openingBalance: money('opening_balance').notNull().default('0'), balance: money('balance').notNull().default('0'),
  note: varchar('note', { length: 500 }), archivedAt: datetime('archived_at', { mode: 'date', fsp: 3 }),
  version: int('version').notNull().default(1), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex('account_ledger_uq').on(t.ledgerId, t.id), uniqueIndex('account_ledger_currency_uq').on(t.ledgerId, t.id, t.currency), index('account_ledger_archived_idx').on(t.ledgerId, t.archivedAt)]);
export const categories = mysqlTable('categories', {
  id: id(), ledgerId: ledgerId(), parentId: varchar('parent_id', { length: 36 }), name: varchar('name', { length: 80 }).notNull(),
  kind: mysqlEnum('kind', ['expense', 'income']).notNull(), icon: varchar('icon', { length: 32 }), archivedAt: datetime('archived_at', { mode: 'date', fsp: 3 }),
  version: int('version').notNull().default(1), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex('category_ledger_uq').on(t.ledgerId, t.id), index('category_ledger_kind_idx').on(t.ledgerId, t.kind, t.archivedAt)]);
export const tags = mysqlTable('tags', {
  id: id(), ledgerId: ledgerId(), name: varchar('name', { length: 40 }).notNull(), archivedAt: datetime('archived_at', { mode: 'date', fsp: 3 }),
  version: int('version').notNull().default(1), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex('tag_ledger_uq').on(t.ledgerId, t.id), uniqueIndex('tag_ledger_name_uq').on(t.ledgerId, t.name)]);
export const fxSnapshots = mysqlTable('fx_snapshots', {
  id: id(), ledgerId: ledgerId(), baseCurrency: varchar('base_currency', { length: 3 }).notNull(), quoteCurrency: varchar('quote_currency', { length: 3 }).notNull(),
  rate: decimal('rate', { precision: 38, scale: 18 }).notNull(), source: varchar('source', { length: 60 }).notNull(), sourceAt: datetime('source_at', { mode: 'date', fsp: 3 }),
  freshness: mysqlEnum('freshness', ['fresh', 'delayed', 'stale', 'market_closed', 'missing', 'manual']).notNull(),
  batchId: varchar('batch_id', { length: 36 }), manualReason: varchar('manual_reason', { length: 200 }),
  createdBy: varchar('created_by', { length: 36 }).notNull().references(() => user.id), createdAt: createdAt(),
}, t => [uniqueIndex('fx_snapshot_ledger_uq').on(t.ledgerId, t.id)]);
export const transactions = mysqlTable('transactions', {
  id: id(), ledgerId: ledgerId(),
  kind: mysqlEnum('kind', ['expense', 'income', 'transfer', 'refund']).notNull(), status: mysqlEnum('status', ['posted', 'voided']).notNull().default('posted'),
  occurredAt: datetime('occurred_at', { mode: 'date', fsp: 3 }).notNull(), localDate: date('local_date', { mode: 'string' }).notNull(), timezone: varchar('timezone', { length: 64 }).notNull(),
  accountId: varchar('account_id', { length: 36 }), categoryId: varchar('category_id', { length: 36 }),
  merchant: varchar('merchant', { length: 120 }), note: varchar('note', { length: 500 }),
  refundOf: varchar('refund_of', { length: 36 }), replacesId: varchar('replaces_id', { length: 36 }),
  source: mysqlEnum('source', ['web', 'api', 'agent', 'import', 'subscription']).notNull(),
  createdBy: varchar('created_by', { length: 36 }).notNull().references(() => user.id), version: int('version').notNull().default(1),
  voidedAt: datetime('voided_at', { mode: 'date', fsp: 3 }), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex('transaction_ledger_uq').on(t.ledgerId, t.id)]);
export const transactionTags = mysqlTable('transaction_tags', {
  ledgerId: varchar('ledger_id', { length: 36 }).notNull(), transactionId: varchar('transaction_id', { length: 36 }).notNull(), tagId: varchar('tag_id', { length: 36 }).notNull(),
}, t => [primaryKey({ columns: [t.transactionId, t.tagId] })]);
export const transactionAmounts = mysqlTable('transaction_amounts', {
  ledgerId: varchar('ledger_id', { length: 36 }).notNull(), transactionId: varchar('transaction_id', { length: 36 }).primaryKey(),
  originalAmount: money('original_amount').notNull(), originalCurrency: varchar('original_currency', { length: 3 }).notNull(),
  settlementAmount: money('settlement_amount').notNull(), settlementCurrency: varchar('settlement_currency', { length: 3 }).notNull(),
  baseAmount: money('base_amount').notNull(), baseCurrency: varchar('base_currency', { length: 3 }).notNull(),
  baseEstimated: boolean('base_estimated').notNull().default(false), fxSnapshotId: varchar('fx_snapshot_id', { length: 36 }),
});
export const accountPostings = mysqlTable('account_postings', {
  id: id(), ledgerId: varchar('ledger_id', { length: 36 }).notNull(), transactionId: varchar('transaction_id', { length: 36 }).notNull(),
  accountId: varchar('account_id', { length: 36 }).notNull(), currency: varchar('currency', { length: 3 }).notNull(),
  signedAmount: money('signed_amount').notNull(), reversesId: varchar('reverses_id', { length: 36 }), createdAt: createdAt(),
}, t => [uniqueIndex('posting_ledger_uq').on(t.ledgerId, t.id), index('posting_ledger_account_tx_idx').on(t.ledgerId, t.accountId, t.transactionId)]);
export const outboxEvents = mysqlTable('outbox_events', {
  id: id(), ledgerId: varchar('ledger_id', { length: 36 }).references(() => ledgers.id), type: varchar('type', { length: 80 }).notNull(),
  payload: json('payload').notNull(), availableAt: datetime('available_at', { mode: 'date', fsp: 3 }).notNull(),
  dispatchStatus: mysqlEnum('dispatch_status', ['pending', 'dispatched', 'failed']).notNull().default('pending'),
  attempts: int('attempts').notNull().default(0), lastError: varchar('last_error', { length: 200 }),
  createdAt: createdAt(), dispatchedAt: datetime('dispatched_at', { mode: 'date', fsp: 3 }),
}, t => [index('outbox_status_available_idx').on(t.dispatchStatus, t.availableAt)]);

// M2-LEDGER (migration 0004).
export const writePreviews = mysqlTable('write_previews', {
  id: id(), ledgerId: ledgerId(), actorId: varchar('actor_id', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }),
  kind: mysqlEnum('kind', ['expense', 'income', 'transfer', 'refund']).notNull(), bodyHash: char('body_hash', { length: 64 }).notNull(),
  normalizedInput: json('normalized_input').notNull(), computed: json('computed').notNull(), accountVersions: json('account_versions').notNull(),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(), consumedAt: datetime('consumed_at', { mode: 'date', fsp: 3 }),
  consumedBy: varchar('consumed_by', { length: 36 }), createdAt: createdAt(),
}, t => [index('write_preview_owner_idx').on(t.ledgerId, t.actorId, t.expiresAt), index('write_preview_expiry_idx').on(t.expiresAt)]);
export const transactionLinks = mysqlTable('transaction_links', {
  ledgerId: varchar('ledger_id', { length: 36 }).notNull(), childId: varchar('child_id', { length: 36 }).primaryKey(),
  parentId: varchar('parent_id', { length: 36 }).notNull(), kind: mysqlEnum('kind', ['fee']).notNull(),
}, t => [index('transaction_link_parent_idx').on(t.ledgerId, t.parentId)]);
