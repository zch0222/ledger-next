-- M3-REPORTS: budgets and the per-ledger data version that tags report caches. Additive; recovery script:
-- migrations/down/0007_reports.sql.
CREATE TABLE IF NOT EXISTS budgets (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, name VARCHAR(80), category_id VARCHAR(36),
  period ENUM('week','month','year') NOT NULL, amount DECIMAL(24,6) NOT NULL, currency VARCHAR(3) NOT NULL, start_date DATE NOT NULL,
  alert_thresholds JSON NOT NULL, archived_at DATETIME(3), version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY budget_ledger_uq (ledger_id, id), INDEX budget_ledger_archived_idx (ledger_id, archived_at),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id), FOREIGN KEY (currency) REFERENCES currencies(code),
  CONSTRAINT budget_category_fk FOREIGN KEY (ledger_id, category_id) REFERENCES categories(ledger_id, id),
  CONSTRAINT budget_amount_positive CHECK (amount > 0), CONSTRAINT budget_version_positive CHECK (version > 0)
) ENGINE=InnoDB;
--> statement-breakpoint
-- Incremented in the same transaction as every financial write; report caches are keyed by it, so a cached
-- aggregate can never outlive the data it summarized.
CREATE TABLE IF NOT EXISTS ledger_data_versions (
  ledger_id VARCHAR(36) PRIMARY KEY, version BIGINT NOT NULL, updated_at DATETIME(3) NOT NULL,
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE
) ENGINE=InnoDB;
