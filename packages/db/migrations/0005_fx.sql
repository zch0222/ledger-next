-- M3-FX: provider batches, manual rate records and refresh / backfill bookkeeping. Purely additive (CREATE TABLE
-- IF NOT EXISTS), so a partial run can be re-run. Recovery: migrations/down/0005_fx.sql.
-- A batch keeps the provider's original pivot-based quotes unchanged; cross rates are computed from ONE batch on read.
-- Booked transactions copy the rate they used into fx_snapshots, so nothing here can rewrite history.
CREATE TABLE IF NOT EXISTS fx_batches (
  id VARCHAR(36) PRIMARY KEY, provider VARCHAR(40) NOT NULL, pivot_currency VARCHAR(3) NOT NULL,
  kind ENUM('latest','historical') NOT NULL, source_at DATETIME(3) NOT NULL, fetched_at DATETIME(3) NOT NULL,
  effective_date DATE NOT NULL, quality ENUM('accepted','suspect') NOT NULL, note VARCHAR(200), created_at DATETIME(3) NOT NULL,
  UNIQUE KEY fx_batch_source_uq (provider, kind, source_at),
  INDEX fx_batch_lookup_idx (provider, quality, source_at),
  FOREIGN KEY (pivot_currency) REFERENCES currencies(code)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS fx_rates (
  batch_id VARCHAR(36) NOT NULL, quote_currency VARCHAR(3) NOT NULL, rate DECIMAL(38,18) NOT NULL,
  PRIMARY KEY (batch_id, quote_currency),
  FOREIGN KEY (batch_id) REFERENCES fx_batches(id), FOREIGN KEY (quote_currency) REFERENCES currencies(code),
  CONSTRAINT fx_rate_positive CHECK (rate > 0)
) ENGINE=InnoDB;
--> statement-breakpoint
-- One row per provider: the latest attempt and the failure streak drive the "stale" state when the source keeps failing.
CREATE TABLE IF NOT EXISTS fx_fetch_status (
  provider VARCHAR(40) PRIMARY KEY, last_attempt_at DATETIME(3), last_success_at DATETIME(3),
  consecutive_failures INT NOT NULL DEFAULT 0, last_error VARCHAR(200), updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fx_fetch_failures_nonnegative CHECK (consecutive_failures >= 0)
) ENGINE=InnoDB;
--> statement-breakpoint
-- Ledger-scoped manual rates with a reason; used where the market has no quote (report valuation, backfill gaps).
CREATE TABLE IF NOT EXISTS manual_rate_records (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, base_currency VARCHAR(3) NOT NULL, quote_currency VARCHAR(3) NOT NULL,
  rate DECIMAL(38,18) NOT NULL, effective_date DATE NOT NULL, reason VARCHAR(200) NOT NULL,
  created_by VARCHAR(36) NOT NULL, created_at DATETIME(3) NOT NULL,
  INDEX manual_rate_lookup_idx (ledger_id, base_currency, quote_currency, effective_date),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id), FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (base_currency) REFERENCES currencies(code), FOREIGN KEY (quote_currency) REFERENCES currencies(code),
  CONSTRAINT manual_rate_positive CHECK (rate > 0), CONSTRAINT manual_rate_distinct CHECK (base_currency <> quote_currency)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS fx_refresh_jobs (
  id VARCHAR(36) PRIMARY KEY, status ENUM('queued','running','succeeded','failed') NOT NULL, reason VARCHAR(200),
  requested_by VARCHAR(36) NOT NULL, error VARCHAR(200), created_at DATETIME(3) NOT NULL, completed_at DATETIME(3),
  INDEX fx_refresh_status_idx (status, created_at), FOREIGN KEY (requested_by) REFERENCES users(id)
) ENGINE=InnoDB;
--> statement-breakpoint
-- Historical daily rates are fetched asynchronously: a request row per (provider, date), never during a web request.
CREATE TABLE IF NOT EXISTS fx_history_requests (
  provider VARCHAR(40) NOT NULL, effective_date DATE NOT NULL, status ENUM('pending','done','failed') NOT NULL,
  attempts INT NOT NULL DEFAULT 0, last_error VARCHAR(200), created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (provider, effective_date), INDEX fx_history_status_idx (status, updated_at)
) ENGINE=InnoDB;
