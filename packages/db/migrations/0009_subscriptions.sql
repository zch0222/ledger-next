-- M4-SUBS: recurring subscriptions, their bill occurrences and server-held subscription previews. Additive;
-- recovery: migrations/down/0009_subscriptions.sql.
-- A bill is never paid by itself: an occurrence only links to a transaction the user confirmed (D14).
CREATE TABLE IF NOT EXISTS subscriptions (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, name VARCHAR(80) NOT NULL,
  amount DECIMAL(24,6) NOT NULL, currency VARCHAR(3) NOT NULL, account_id VARCHAR(36), category_id VARCHAR(36),
  cycle_unit ENUM('day','week','month','year') NOT NULL, cycle_count INT NOT NULL, anchor_date DATE NOT NULL, timezone VARCHAR(64) NOT NULL,
  status ENUM('active','paused','cancelled') NOT NULL, paused_until DATE, ends_on DATE, note VARCHAR(500),
  schedule_version INT NOT NULL DEFAULT 1, version INT NOT NULL DEFAULT 1, created_by VARCHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY subscription_ledger_uq (ledger_id, id), INDEX subscription_ledger_status_idx (ledger_id, status, created_at),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id), FOREIGN KEY (currency) REFERENCES currencies(code), FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT subscription_account_fk FOREIGN KEY (ledger_id, account_id) REFERENCES accounts(ledger_id, id),
  CONSTRAINT subscription_category_fk FOREIGN KEY (ledger_id, category_id) REFERENCES categories(ledger_id, id),
  CONSTRAINT subscription_amount_positive CHECK (amount > 0), CONSTRAINT subscription_cycle_count CHECK (cycle_count BETWEEN 1 AND 366),
  CONSTRAINT subscription_versions_positive CHECK (version > 0 AND schedule_version > 0)
) ENGINE=InnoDB;
--> statement-breakpoint
-- One row per (subscription, schedule version, date): regenerating a schedule can never duplicate a bill.
CREATE TABLE IF NOT EXISTS bill_occurrences (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, subscription_id VARCHAR(36) NOT NULL, schedule_version INT NOT NULL,
  scheduled_date DATE NOT NULL, status ENUM('scheduled','due','overdue','paid','skipped','cancelled') NOT NULL,
  amount DECIMAL(24,6) NOT NULL, currency VARCHAR(3) NOT NULL, transaction_id VARCHAR(36), paid_at DATETIME(3),
  version INT NOT NULL DEFAULT 1, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY bill_occurrence_ledger_uq (ledger_id, id), UNIQUE KEY bill_occurrence_schedule_uq (subscription_id, schedule_version, scheduled_date),
  UNIQUE KEY bill_occurrence_transaction_uq (ledger_id, transaction_id),
  INDEX bill_occurrence_ledger_date_idx (ledger_id, scheduled_date), INDEX bill_occurrence_status_date_idx (status, scheduled_date),
  CONSTRAINT bill_occurrence_subscription_fk FOREIGN KEY (ledger_id, subscription_id) REFERENCES subscriptions(ledger_id, id),
  CONSTRAINT bill_occurrence_transaction_fk FOREIGN KEY (ledger_id, transaction_id) REFERENCES transactions(ledger_id, id),
  FOREIGN KEY (currency) REFERENCES currencies(code),
  CONSTRAINT bill_occurrence_paid_link CHECK ((status = 'paid') = (transaction_id IS NOT NULL)),
  CONSTRAINT bill_occurrence_amount_positive CHECK (amount > 0)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS subscription_previews (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, actor_id VARCHAR(36) NOT NULL, normalized_input JSON NOT NULL,
  expires_at DATETIME(3) NOT NULL, consumed_at DATETIME(3), consumed_by VARCHAR(36), created_at DATETIME(3) NOT NULL,
  INDEX subscription_preview_owner_idx (ledger_id, actor_id, expires_at),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id), FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
