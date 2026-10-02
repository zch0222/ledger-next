-- M2-MODEL ledger core. Purely additive: CREATE TABLE IF NOT EXISTS plus an idempotent seed, so a partially
-- applied run can simply be re-run. Recovery before any money is recorded: packages/db/migrations/down/0003_ledger_core.sql
-- via `pnpm db:rollback 0003_ledger_core.sql` (refuses while ledger tables hold rows; restore from backup instead).
-- Every ledger-scoped reference is a composite (ledger_id, id) foreign key, so rows of one ledger can never point
-- at another ledger's accounts, categories or transactions. Financial tables RESTRICT ledger deletion.
CREATE TABLE IF NOT EXISTS currencies (
  code VARCHAR(3) PRIMARY KEY, minor_units TINYINT UNSIGNED NOT NULL, enabled BOOLEAN NOT NULL,
  CONSTRAINT currency_minor_units_range CHECK (minor_units <= 6)
) ENGINE=InnoDB;
--> statement-breakpoint
INSERT INTO currencies (code, minor_units, enabled) VALUES
  ('CNY', 2, TRUE), ('USD', 2, TRUE), ('HKD', 2, TRUE), ('EUR', 2, TRUE), ('JPY', 0, TRUE), ('KWD', 3, FALSE) AS seed
ON DUPLICATE KEY UPDATE minor_units = seed.minor_units, enabled = seed.enabled;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS accounts (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, name VARCHAR(80) NOT NULL,
  type ENUM('cash','bank','credit_card','e_wallet','investment','other') NOT NULL, currency VARCHAR(3) NOT NULL,
  opening_balance DECIMAL(24,6) NOT NULL DEFAULT 0, balance DECIMAL(24,6) NOT NULL DEFAULT 0, note VARCHAR(500),
  archived_at DATETIME(3), version INT NOT NULL DEFAULT 1, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY account_ledger_uq (ledger_id, id), UNIQUE KEY account_ledger_currency_uq (ledger_id, id, currency),
  INDEX account_ledger_archived_idx (ledger_id, archived_at),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id), FOREIGN KEY (currency) REFERENCES currencies(code),
  CONSTRAINT account_version_positive CHECK (version > 0)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS categories (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, parent_id VARCHAR(36), name VARCHAR(80) NOT NULL,
  kind ENUM('expense','income') NOT NULL, icon VARCHAR(32), archived_at DATETIME(3), version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY category_ledger_uq (ledger_id, id), INDEX category_ledger_kind_idx (ledger_id, kind, archived_at),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id),
  CONSTRAINT category_parent_fk FOREIGN KEY (ledger_id, parent_id) REFERENCES categories(ledger_id, id),
  CONSTRAINT category_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT category_version_positive CHECK (version > 0)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS tags (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, name VARCHAR(40) NOT NULL, archived_at DATETIME(3),
  version INT NOT NULL DEFAULT 1, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY tag_ledger_uq (ledger_id, id), UNIQUE KEY tag_ledger_name_uq (ledger_id, name),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id), CONSTRAINT tag_version_positive CHECK (version > 0)
) ENGINE=InnoDB;
--> statement-breakpoint
-- Immutable rate used by a transaction. Provider batches (fx_batches / fx_rates) arrive with M3-FX; the snapshot keeps
-- its own copy of rate, source and sourceAt so later market data never rewrites a booked amount.
CREATE TABLE IF NOT EXISTS fx_snapshots (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, base_currency VARCHAR(3) NOT NULL, quote_currency VARCHAR(3) NOT NULL,
  rate DECIMAL(38,18) NOT NULL, source VARCHAR(60) NOT NULL, source_at DATETIME(3),
  freshness ENUM('fresh','delayed','stale','market_closed','missing','manual') NOT NULL, batch_id VARCHAR(36), manual_reason VARCHAR(200),
  created_by VARCHAR(36) NOT NULL, created_at DATETIME(3) NOT NULL,
  UNIQUE KEY fx_snapshot_ledger_uq (ledger_id, id),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id), FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (base_currency) REFERENCES currencies(code), FOREIGN KEY (quote_currency) REFERENCES currencies(code),
  CONSTRAINT fx_snapshot_rate_positive CHECK (rate > 0),
  CONSTRAINT fx_snapshot_distinct_pair CHECK (base_currency <> quote_currency),
  CONSTRAINT fx_snapshot_manual_reason CHECK (freshness <> 'manual' OR manual_reason IS NOT NULL)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS transactions (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL,
  kind ENUM('expense','income','transfer','refund') NOT NULL, status ENUM('posted','voided') NOT NULL DEFAULT 'posted',
  occurred_at DATETIME(3) NOT NULL, local_date DATE NOT NULL, timezone VARCHAR(64) NOT NULL,
  account_id VARCHAR(36), category_id VARCHAR(36), merchant VARCHAR(120), note VARCHAR(500),
  refund_of VARCHAR(36), replaces_id VARCHAR(36), source ENUM('web','api','agent','import','subscription') NOT NULL,
  created_by VARCHAR(36) NOT NULL, version INT NOT NULL DEFAULT 1, voided_at DATETIME(3),
  created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY transaction_ledger_uq (ledger_id, id),
  INDEX transaction_ledger_status_date_idx (ledger_id, status, local_date DESC, id DESC),
  INDEX transaction_ledger_category_date_idx (ledger_id, category_id, local_date DESC),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id), FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT transaction_account_fk FOREIGN KEY (ledger_id, account_id) REFERENCES accounts(ledger_id, id),
  CONSTRAINT transaction_category_fk FOREIGN KEY (ledger_id, category_id) REFERENCES categories(ledger_id, id),
  CONSTRAINT transaction_refund_fk FOREIGN KEY (ledger_id, refund_of) REFERENCES transactions(ledger_id, id),
  CONSTRAINT transaction_replaces_fk FOREIGN KEY (ledger_id, replaces_id) REFERENCES transactions(ledger_id, id),
  CONSTRAINT transaction_account_required CHECK (kind = 'transfer' OR account_id IS NOT NULL),
  CONSTRAINT transaction_transfer_uncategorized CHECK (kind <> 'transfer' OR (account_id IS NULL AND category_id IS NULL)),
  CONSTRAINT transaction_refund_link CHECK ((kind = 'refund') = (refund_of IS NOT NULL)),
  CONSTRAINT transaction_voided_at CHECK ((status = 'voided') = (voided_at IS NOT NULL)),
  CONSTRAINT transaction_version_positive CHECK (version > 0)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS transaction_tags (
  ledger_id VARCHAR(36) NOT NULL, transaction_id VARCHAR(36) NOT NULL, tag_id VARCHAR(36) NOT NULL,
  PRIMARY KEY (transaction_id, tag_id), INDEX transaction_tag_ledger_tag_idx (ledger_id, tag_id),
  CONSTRAINT transaction_tag_transaction_fk FOREIGN KEY (ledger_id, transaction_id) REFERENCES transactions(ledger_id, id),
  CONSTRAINT transaction_tag_tag_fk FOREIGN KEY (ledger_id, tag_id) REFERENCES tags(ledger_id, id)
) ENGINE=InnoDB;
--> statement-breakpoint
-- Original (merchant price), settlement (what the account moved) and base (report currency) amounts, all positive.
CREATE TABLE IF NOT EXISTS transaction_amounts (
  ledger_id VARCHAR(36) NOT NULL, transaction_id VARCHAR(36) PRIMARY KEY,
  original_amount DECIMAL(24,6) NOT NULL, original_currency VARCHAR(3) NOT NULL,
  settlement_amount DECIMAL(24,6) NOT NULL, settlement_currency VARCHAR(3) NOT NULL,
  base_amount DECIMAL(24,6) NOT NULL, base_currency VARCHAR(3) NOT NULL, base_estimated BOOLEAN NOT NULL DEFAULT FALSE,
  fx_snapshot_id VARCHAR(36),
  CONSTRAINT transaction_amount_transaction_fk FOREIGN KEY (ledger_id, transaction_id) REFERENCES transactions(ledger_id, id),
  CONSTRAINT transaction_amount_snapshot_fk FOREIGN KEY (ledger_id, fx_snapshot_id) REFERENCES fx_snapshots(ledger_id, id),
  FOREIGN KEY (original_currency) REFERENCES currencies(code), FOREIGN KEY (settlement_currency) REFERENCES currencies(code),
  FOREIGN KEY (base_currency) REFERENCES currencies(code),
  CONSTRAINT transaction_amount_positive CHECK (original_amount > 0 AND settlement_amount > 0 AND base_amount >= 0),
  CONSTRAINT transaction_amount_rate_required CHECK (settlement_currency = base_currency OR fx_snapshot_id IS NOT NULL)
) ENGINE=InnoDB;
--> statement-breakpoint
-- Append-only ledger lines. The (ledger_id, account_id, currency) key forces each line into its account's currency.
-- Corrections add reversing lines (reverses_id); nothing updates or deletes a posted line.
CREATE TABLE IF NOT EXISTS account_postings (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, transaction_id VARCHAR(36) NOT NULL, account_id VARCHAR(36) NOT NULL,
  currency VARCHAR(3) NOT NULL, signed_amount DECIMAL(24,6) NOT NULL, reverses_id VARCHAR(36), created_at DATETIME(3) NOT NULL,
  UNIQUE KEY posting_ledger_uq (ledger_id, id), UNIQUE KEY posting_reverses_uq (reverses_id),
  INDEX posting_ledger_account_tx_idx (ledger_id, account_id, transaction_id),
  CONSTRAINT posting_transaction_fk FOREIGN KEY (ledger_id, transaction_id) REFERENCES transactions(ledger_id, id),
  CONSTRAINT posting_account_currency_fk FOREIGN KEY (ledger_id, account_id, currency) REFERENCES accounts(ledger_id, id, currency),
  CONSTRAINT posting_reverses_fk FOREIGN KEY (ledger_id, reverses_id) REFERENCES account_postings(ledger_id, id),
  CONSTRAINT posting_nonzero CHECK (signed_amount <> 0)
) ENGINE=InnoDB;
--> statement-breakpoint
-- Written in the same transaction as the business change; the worker dispatches it (M5-ENGINE).
CREATE TABLE IF NOT EXISTS outbox_events (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36), type VARCHAR(80) NOT NULL, payload JSON NOT NULL,
  available_at DATETIME(3) NOT NULL, dispatch_status ENUM('pending','dispatched','failed') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0, last_error VARCHAR(200), created_at DATETIME(3) NOT NULL, dispatched_at DATETIME(3),
  INDEX outbox_status_available_idx (dispatch_status, available_at), INDEX outbox_ledger_created_idx (ledger_id, created_at),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id),
  CONSTRAINT outbox_attempts_nonnegative CHECK (attempts >= 0)
) ENGINE=InnoDB;
