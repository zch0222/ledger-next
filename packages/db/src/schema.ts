import { bigint, boolean, char, date, datetime, decimal, index, int, json, mediumtext, mysqlEnum, mysqlTable, primaryKey, smallint, text, tinyint, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

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

// M3-FX (migration 0005).
export const fxBatches = mysqlTable('fx_batches', {
  id: id(), provider: varchar('provider', { length: 40 }).notNull(), pivotCurrency: varchar('pivot_currency', { length: 3 }).notNull(),
  kind: mysqlEnum('kind', ['latest', 'historical']).notNull(), sourceAt: datetime('source_at', { mode: 'date', fsp: 3 }).notNull(),
  fetchedAt: datetime('fetched_at', { mode: 'date', fsp: 3 }).notNull(), effectiveDate: date('effective_date', { mode: 'string' }).notNull(),
  quality: mysqlEnum('quality', ['accepted', 'suspect']).notNull(), note: varchar('note', { length: 200 }), createdAt: createdAt(),
}, t => [uniqueIndex('fx_batch_source_uq').on(t.provider, t.kind, t.sourceAt), index('fx_batch_lookup_idx').on(t.provider, t.quality, t.sourceAt)]);
export const fxRates = mysqlTable('fx_rates', {
  batchId: varchar('batch_id', { length: 36 }).notNull(), quoteCurrency: varchar('quote_currency', { length: 3 }).notNull(),
  rate: decimal('rate', { precision: 38, scale: 18 }).notNull(),
}, t => [primaryKey({ columns: [t.batchId, t.quoteCurrency] })]);
export const fxFetchStatus = mysqlTable('fx_fetch_status', {
  provider: varchar('provider', { length: 40 }).primaryKey(), lastAttemptAt: datetime('last_attempt_at', { mode: 'date', fsp: 3 }),
  lastSuccessAt: datetime('last_success_at', { mode: 'date', fsp: 3 }), consecutiveFailures: int('consecutive_failures').notNull().default(0),
  lastError: varchar('last_error', { length: 200 }), updatedAt: updatedAt(),
});
export const manualRateRecords = mysqlTable('manual_rate_records', {
  id: id(), ledgerId: ledgerId(), baseCurrency: varchar('base_currency', { length: 3 }).notNull(), quoteCurrency: varchar('quote_currency', { length: 3 }).notNull(),
  rate: decimal('rate', { precision: 38, scale: 18 }).notNull(), effectiveDate: date('effective_date', { mode: 'string' }).notNull(),
  reason: varchar('reason', { length: 200 }).notNull(), createdBy: varchar('created_by', { length: 36 }).notNull().references(() => user.id), createdAt: createdAt(),
}, t => [index('manual_rate_lookup_idx').on(t.ledgerId, t.baseCurrency, t.quoteCurrency, t.effectiveDate)]);
export const fxRefreshJobs = mysqlTable('fx_refresh_jobs', {
  id: id(), status: mysqlEnum('status', ['queued', 'running', 'succeeded', 'failed']).notNull(), reason: varchar('reason', { length: 200 }),
  requestedBy: varchar('requested_by', { length: 36 }).notNull().references(() => user.id), error: varchar('error', { length: 200 }),
  createdAt: createdAt(), completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
}, t => [index('fx_refresh_status_idx').on(t.status, t.createdAt)]);
export const fxHistoryRequests = mysqlTable('fx_history_requests', {
  provider: varchar('provider', { length: 40 }).notNull(), effectiveDate: date('effective_date', { mode: 'string' }).notNull(),
  status: mysqlEnum('status', ['pending', 'done', 'failed']).notNull(), attempts: int('attempts').notNull().default(0),
  lastError: varchar('last_error', { length: 200 }), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [primaryKey({ columns: [t.provider, t.effectiveDate] }), index('fx_history_status_idx').on(t.status, t.updatedAt)]);

// M2-IMPORT (migration 0006). import_rows.committed_fingerprint is a generated column and is never written.
export const importJobs = mysqlTable('import_jobs', {
  id: id(), ledgerId: ledgerId(), createdBy: varchar('created_by', { length: 36 }).notNull().references(() => user.id),
  status: mysqlEnum('status', ['validating', 'validated', 'committing', 'committed', 'failed', 'reverting', 'reverted']).notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(), fileSha256: char('file_sha256', { length: 64 }).notNull(), mapping: json('mapping').notNull(),
  content: mediumtext('content'), rowCount: int('row_count').notNull().default(0), validRows: int('valid_rows').notNull().default(0),
  errorRows: int('error_rows').notNull().default(0), committedRows: int('committed_rows').notNull().default(0), revertedRows: int('reverted_rows').notNull().default(0),
  failureReason: varchar('failure_reason', { length: 200 }), requestedBy: varchar('requested_by', { length: 36 }),
  createdAt: createdAt(), updatedAt: updatedAt(), committedAt: datetime('committed_at', { mode: 'date', fsp: 3 }), revertedAt: datetime('reverted_at', { mode: 'date', fsp: 3 }),
}, t => [uniqueIndex('import_job_ledger_uq').on(t.ledgerId, t.id), index('import_job_ledger_created_idx').on(t.ledgerId, t.createdAt), index('import_job_status_idx').on(t.status, t.updatedAt)]);
export const importRows = mysqlTable('import_rows', {
  id: id(), ledgerId: varchar('ledger_id', { length: 36 }).notNull(), jobId: varchar('job_id', { length: 36 }).notNull(), rowNo: int('row_no').notNull(),
  fingerprint: char('fingerprint', { length: 64 }).notNull(), status: mysqlEnum('status', ['valid', 'error', 'duplicate', 'committed', 'reverted', 'skipped']).notNull(),
  data: json('data'), errorCode: varchar('error_code', { length: 40 }), errorColumn: varchar('error_column', { length: 80 }), errorMessage: varchar('error_message', { length: 200 }),
  transactionId: varchar('transaction_id', { length: 36 }),
}, t => [uniqueIndex('import_row_job_uq').on(t.jobId, t.rowNo), index('import_row_job_status_idx').on(t.jobId, t.status), index('import_row_fingerprint_idx').on(t.ledgerId, t.fingerprint)]);
export const exportJobs = mysqlTable('export_jobs', {
  id: id(), ledgerId: ledgerId(), createdBy: varchar('created_by', { length: 36 }).notNull().references(() => user.id),
  status: mysqlEnum('status', ['queued', 'running', 'ready', 'failed', 'expired']).notNull(), format: mysqlEnum('format', ['csv']).notNull(), filters: json('filters').notNull(),
  rowCount: int('row_count'), content: mediumtext('content'), contentSha256: char('content_sha256', { length: 64 }), failureReason: varchar('failure_reason', { length: 200 }),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }), createdAt: createdAt(), updatedAt: updatedAt(), completedAt: datetime('completed_at', { mode: 'date', fsp: 3 }),
}, t => [index('export_job_ledger_created_idx').on(t.ledgerId, t.createdAt), index('export_job_status_idx').on(t.status, t.updatedAt)]);

// M3-REPORTS (migration 0007).
export const budgets = mysqlTable('budgets', {
  id: id(), ledgerId: ledgerId(), name: varchar('name', { length: 80 }), categoryId: varchar('category_id', { length: 36 }),
  period: mysqlEnum('period', ['week', 'month', 'year']).notNull(), amount: money('amount').notNull(), currency: varchar('currency', { length: 3 }).notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(), alertThresholds: json('alert_thresholds').notNull(), archivedAt: datetime('archived_at', { mode: 'date', fsp: 3 }),
  version: int('version').notNull().default(1), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex('budget_ledger_uq').on(t.ledgerId, t.id), index('budget_ledger_archived_idx').on(t.ledgerId, t.archivedAt)]);
export const ledgerDataVersions = mysqlTable('ledger_data_versions', {
  ledgerId: varchar('ledger_id', { length: 36 }).primaryKey(), version: bigint('version', { mode: 'number' }).notNull(), updatedAt: updatedAt(),
});

// M4-THEME (migration 0008).
export const userPreferences = mysqlTable('user_preferences', {
  userId: varchar('user_id', { length: 36 }).primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  themeMode: mysqlEnum('theme_mode', ['system', 'light', 'dark']).notNull(), accentType: mysqlEnum('accent_type', ['preset', 'custom']).notNull(),
  accentValue: varchar('accent_value', { length: 16 }).notNull(), paletteVersion: int('palette_version').notNull(), version: int('version').notNull(), updatedAt: updatedAt(),
});

// M4-SUBS (migration 0009).
export const subscriptions = mysqlTable('subscriptions', {
  id: id(), ledgerId: ledgerId(), name: varchar('name', { length: 80 }).notNull(), amount: money('amount').notNull(), currency: varchar('currency', { length: 3 }).notNull(),
  accountId: varchar('account_id', { length: 36 }), categoryId: varchar('category_id', { length: 36 }),
  cycleUnit: mysqlEnum('cycle_unit', ['day', 'week', 'month', 'year']).notNull(), cycleCount: int('cycle_count').notNull(), anchorDate: date('anchor_date', { mode: 'string' }).notNull(),
  timezone: varchar('timezone', { length: 64 }).notNull(), status: mysqlEnum('status', ['active', 'paused', 'cancelled']).notNull(),
  pausedUntil: date('paused_until', { mode: 'string' }), endsOn: date('ends_on', { mode: 'string' }), note: varchar('note', { length: 500 }),
  scheduleVersion: int('schedule_version').notNull().default(1), version: int('version').notNull().default(1), createdBy: varchar('created_by', { length: 36 }).notNull().references(() => user.id),
  trialEndsOn: date('trial_ends_on', { mode: 'string' }), cancelBy: date('cancel_by', { mode: 'string' }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex('subscription_ledger_uq').on(t.ledgerId, t.id), index('subscription_ledger_status_idx').on(t.ledgerId, t.status, t.createdAt)]);
export const billOccurrences = mysqlTable('bill_occurrences', {
  id: id(), ledgerId: varchar('ledger_id', { length: 36 }).notNull(), subscriptionId: varchar('subscription_id', { length: 36 }).notNull(), scheduleVersion: int('schedule_version').notNull(),
  scheduledDate: date('scheduled_date', { mode: 'string' }).notNull(), status: mysqlEnum('status', ['scheduled', 'due', 'overdue', 'paid', 'skipped', 'cancelled']).notNull(),
  amount: money('amount').notNull(), currency: varchar('currency', { length: 3 }).notNull(), transactionId: varchar('transaction_id', { length: 36 }), paidAt: datetime('paid_at', { mode: 'date', fsp: 3 }),
  version: int('version').notNull().default(1), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex('bill_occurrence_schedule_uq').on(t.subscriptionId, t.scheduleVersion, t.scheduledDate), index('bill_occurrence_ledger_date_idx').on(t.ledgerId, t.scheduledDate)]);
export const subscriptionPreviews = mysqlTable('subscription_previews', {
  id: id(), ledgerId: ledgerId(), actorId: varchar('actor_id', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }),
  normalizedInput: json('normalized_input').notNull(), expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
  consumedAt: datetime('consumed_at', { mode: 'date', fsp: 3 }), consumedBy: varchar('consumed_by', { length: 36 }), createdAt: createdAt(),
});

// M5: notification channels, reminder rules, the delivery log (job store), attempts and in-app notifications.
const CHANNEL_TYPES = ['telegram', 'feishu', 'wecom_bot', 'wecom_app', 'pushplus_wechat', 'email', 'webhook', 'in_app'] as const;
const RESPONSE_CLASSES = ['ok', 'rate_limited', 'server_error', 'client_error', 'credential_error', 'timeout', 'network'] as const;
export const REMINDER_EVENTS = ['bill_due', 'trial_end', 'cancel_deadline', 'overdue', 'budget_threshold', 'daily_entry', 'weekly_summary', 'monthly_summary', 'fx_threshold', 'delivery_failed'] as const;
export const notificationChannels = mysqlTable('notification_channels', {
  id: id(), userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }), type: mysqlEnum('type', CHANNEL_TYPES).notNull(),
  name: varchar('name', { length: 60 }).notNull(), enabled: boolean('enabled').notNull().default(true),
  status: mysqlEnum('status', ['unconfigured', 'verifying', 'active', 'degraded', 'disabled']).notNull(),
  sealedConfig: text('sealed_config'), keyId: varchar('key_id', { length: 16 }), configSummary: json('config_summary').notNull(),
  verificationHash: char('verification_hash', { length: 64 }), verificationExpiresAt: datetime('verification_expires_at', { mode: 'date', fsp: 3 }), verificationAttempts: int('verification_attempts').notNull().default(0),
  lastVerifiedAt: datetime('last_verified_at', { mode: 'date', fsp: 3 }), lastError: varchar('last_error', { length: 300 }), consecutiveFailures: int('consecutive_failures').notNull().default(0),
  version: int('version').notNull().default(1), createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: datetime('deleted_at', { mode: 'date', fsp: 3 }),
}, t => [index('notification_channel_user_idx').on(t.userId, t.deletedAt, t.createdAt)]);
export const reminderRules = mysqlTable('reminder_rules', {
  id: id(), ledgerId: ledgerId(), ownerId: varchar('owner_id', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }),
  eventType: mysqlEnum('event_type', REMINDER_EVENTS).notNull(), subscriptionId: varchar('subscription_id', { length: 36 }), budgetId: varchar('budget_id', { length: 36 }),
  leadDays: json('lead_days').notNull(), localTime: char('local_time', { length: 5 }).notNull(), timezone: varchar('timezone', { length: 64 }).notNull(),
  quietStart: char('quiet_start', { length: 5 }), quietEnd: char('quiet_end', { length: 5 }), channelIds: json('channel_ids').notNull(),
  enabled: boolean('enabled').notNull().default(true), templateVersion: int('template_version').notNull().default(1), includeDetails: boolean('include_details').notNull().default(false),
  fxBase: varchar('fx_base', { length: 3 }), fxQuote: varchar('fx_quote', { length: 3 }), fxAbove: decimal('fx_above', { precision: 24, scale: 10 }), fxBelow: decimal('fx_below', { precision: 24, scale: 10 }), fxState: json('fx_state'),
  plannedThrough: datetime('planned_through', { mode: 'date', fsp: 3 }), version: int('version').notNull().default(1),
  createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: datetime('deleted_at', { mode: 'date', fsp: 3 }),
}, t => [uniqueIndex('reminder_rule_ledger_uq').on(t.ledgerId, t.id), index('reminder_rule_owner_idx').on(t.ledgerId, t.ownerId, t.deletedAt, t.createdAt)]);
export const reminderPreviews = mysqlTable('reminder_previews', {
  id: id(), ledgerId: ledgerId(), actorId: varchar('actor_id', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }),
  normalizedInput: json('normalized_input').notNull(), expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
  consumedAt: datetime('consumed_at', { mode: 'date', fsp: 3 }), consumedBy: varchar('consumed_by', { length: 36 }), createdAt: createdAt(),
});
export const notificationDeliveries = mysqlTable('notification_deliveries', {
  id: id(), ledgerId: varchar('ledger_id', { length: 36 }).references(() => ledgers.id), userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }),
  channelId: varchar('channel_id', { length: 36 }).notNull().references(() => notificationChannels.id), channelType: mysqlEnum('channel_type', CHANNEL_TYPES).notNull(),
  ruleId: varchar('rule_id', { length: 36 }), ruleVersion: int('rule_version'), eventType: varchar('event_type', { length: 32 }).notNull(), eventId: varchar('event_id', { length: 160 }).notNull(),
  subjectId: varchar('subject_id', { length: 36 }), dedupeKey: varchar('dedupe_key', { length: 255 }).notNull(), templateVersion: int('template_version').notNull(), payload: json('payload').notNull(),
  scheduledAt: datetime('scheduled_at', { mode: 'date', fsp: 3 }).notNull(), expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
  deferredByQuietHours: boolean('deferred_by_quiet_hours').notNull().default(false),
  status: mysqlEnum('status', ['queued', 'sending', 'accepted', 'delivered', 'failed', 'delivery_unknown', 'expired', 'cancelled']).notNull(),
  round: int('round').notNull().default(1), attempts: int('attempts').notNull().default(0), nextAttemptAt: datetime('next_attempt_at', { mode: 'date', fsp: 3 }).notNull(),
  lastAttemptAt: datetime('last_attempt_at', { mode: 'date', fsp: 3 }), claimedAt: datetime('claimed_at', { mode: 'date', fsp: 3 }),
  responseClass: mysqlEnum('response_class', RESPONSE_CLASSES), providerMessageId: varchar('provider_message_id', { length: 128 }),
  lastError: varchar('last_error', { length: 300 }), reason: varchar('reason', { length: 160 }), deadLetter: boolean('dead_letter').notNull().default(false),
  version: int('version').notNull().default(1), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex('notification_delivery_dedupe_uq').on(t.dedupeKey), index('notification_delivery_due_idx').on(t.status, t.nextAttemptAt)]);
export const notificationAttempts = mysqlTable('notification_attempts', {
  id: id(), deliveryId: varchar('delivery_id', { length: 36 }).notNull().references(() => notificationDeliveries.id, { onDelete: 'cascade' }),
  round: int('round').notNull(), attemptNo: int('attempt_no').notNull(), startedAt: datetime('started_at', { mode: 'date', fsp: 3 }).notNull(), finishedAt: datetime('finished_at', { mode: 'date', fsp: 3 }),
  outcome: mysqlEnum('outcome', ['accepted', 'delivered', 'retry', 'failed', 'unknown']), responseClass: mysqlEnum('response_class', RESPONSE_CLASSES),
  httpStatus: int('http_status'), providerMessageId: varchar('provider_message_id', { length: 128 }), error: varchar('error', { length: 300 }),
}, t => [uniqueIndex('notification_attempt_uq').on(t.deliveryId, t.round, t.attemptNo)]);
export const notifications = mysqlTable('notifications', {
  id: id(), ledgerId: ledgerId(), userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 32 }).notNull(), title: varchar('title', { length: 200 }).notNull(), body: varchar('body', { length: 1000 }).notNull(),
  link: varchar('link', { length: 500 }), deliveryId: varchar('delivery_id', { length: 36 }), dedupeKey: varchar('dedupe_key', { length: 255 }),
  readAt: datetime('read_at', { mode: 'date', fsp: 3 }), version: int('version').notNull().default(1), createdAt: createdAt(),
}, t => [uniqueIndex('notification_ledger_uq').on(t.ledgerId, t.id), uniqueIndex('notification_dedupe_uq').on(t.dedupeKey), index('notification_user_idx').on(t.userId, t.ledgerId, t.readAt, t.createdAt)]);

// M6: personal access tokens (hash only) and approval requests for high-impact Agent writes.
export const apiTokens = mysqlTable('api_tokens', {
  id: id(), userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }), name: varchar('name', { length: 60 }).notNull(),
  tokenHash: char('token_hash', { length: 64 }).notNull(), prefix: varchar('prefix', { length: 16 }).notNull(), scopes: json('scopes').notNull(), ledgerIds: json('ledger_ids').notNull(),
  expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(), revokedAt: datetime('revoked_at', { mode: 'date', fsp: 3 }), lastUsedAt: datetime('last_used_at', { mode: 'date', fsp: 3 }), createdAt: createdAt(),
}, t => [uniqueIndex('api_token_hash_uq').on(t.tokenHash), index('api_token_user_idx').on(t.userId, t.createdAt)]);
export const approvalRequests = mysqlTable('approval_requests', {
  id: id(), ledgerId: ledgerId(), status: mysqlEnum('status', ['pending', 'approved', 'rejected', 'expired', 'consumed']).notNull(),
  method: mysqlEnum('method', ['POST', 'PATCH', 'DELETE']).notNull(), path: varchar('path', { length: 255 }).notNull(), bodyHash: char('body_hash', { length: 64 }).notNull(),
  summary: varchar('summary', { length: 500 }).notNull(), reason: varchar('reason', { length: 500 }), requestedBy: varchar('requested_by', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }),
  via: mysqlEnum('via', ['session', 'token']).notNull(), tokenId: varchar('token_id', { length: 36 }), decidedBy: varchar('decided_by', { length: 36 }), decidedAt: datetime('decided_at', { mode: 'date', fsp: 3 }),
  decisionNote: varchar('decision_note', { length: 500 }), expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(), consumedAt: datetime('consumed_at', { mode: 'date', fsp: 3 }),
  version: int('version').notNull().default(1), createdAt: createdAt(),
}, t => [uniqueIndex('approval_ledger_uq').on(t.ledgerId, t.id), index('approval_ledger_status_idx').on(t.ledgerId, t.status, t.createdAt)]);
