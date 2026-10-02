-- M2-IMPORT: CSV import batches, their rows, and export jobs. Additive (CREATE TABLE IF NOT EXISTS); recovery script:
-- migrations/down/0006_imports.sql. Imported money is booked through the normal transaction tables with source='import'.
CREATE TABLE IF NOT EXISTS import_jobs (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, created_by VARCHAR(36) NOT NULL,
  status ENUM('validating','validated','committing','committed','failed','reverting','reverted') NOT NULL,
  file_name VARCHAR(255) NOT NULL, file_sha256 CHAR(64) NOT NULL, mapping JSON NOT NULL, content MEDIUMTEXT,
  row_count INT NOT NULL DEFAULT 0, valid_rows INT NOT NULL DEFAULT 0, error_rows INT NOT NULL DEFAULT 0,
  committed_rows INT NOT NULL DEFAULT 0, reverted_rows INT NOT NULL DEFAULT 0, failure_reason VARCHAR(200),
  requested_by VARCHAR(36), created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
  committed_at DATETIME(3), reverted_at DATETIME(3),
  UNIQUE KEY import_job_ledger_uq (ledger_id, id), INDEX import_job_ledger_created_idx (ledger_id, created_at),
  INDEX import_job_status_idx (status, updated_at),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id), FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT import_job_counts CHECK (row_count >= 0 AND valid_rows >= 0 AND error_rows >= 0 AND committed_rows >= 0 AND reverted_rows >= 0)
) ENGINE=InnoDB;
--> statement-breakpoint
-- One row per CSV line. committed_fingerprint is set only while a row's money is booked, so the unique key stops the
-- same line from being booked twice across batches, yet frees it again after a reversal.
CREATE TABLE IF NOT EXISTS import_rows (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, job_id VARCHAR(36) NOT NULL, row_no INT NOT NULL,
  fingerprint CHAR(64) NOT NULL, status ENUM('valid','error','duplicate','committed','reverted','skipped') NOT NULL,
  data JSON, error_code VARCHAR(40), error_column VARCHAR(80), error_message VARCHAR(200), transaction_id VARCHAR(36),
  committed_fingerprint CHAR(64) GENERATED ALWAYS AS (IF(status = 'committed', fingerprint, NULL)) STORED,
  UNIQUE KEY import_row_job_uq (job_id, row_no), UNIQUE KEY import_row_committed_uq (ledger_id, committed_fingerprint),
  INDEX import_row_job_status_idx (job_id, status), INDEX import_row_fingerprint_idx (ledger_id, fingerprint),
  CONSTRAINT import_row_job_fk FOREIGN KEY (ledger_id, job_id) REFERENCES import_jobs(ledger_id, id),
  CONSTRAINT import_row_transaction_fk FOREIGN KEY (ledger_id, transaction_id) REFERENCES transactions(ledger_id, id),
  CONSTRAINT import_row_number CHECK (row_no >= 1)
) ENGINE=InnoDB;
--> statement-breakpoint
-- Export files live in MySQL until they expire (short-lived; only the creator may download).
CREATE TABLE IF NOT EXISTS export_jobs (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, created_by VARCHAR(36) NOT NULL,
  status ENUM('queued','running','ready','failed','expired') NOT NULL, format ENUM('csv') NOT NULL, filters JSON NOT NULL,
  row_count INT, content MEDIUMTEXT, content_sha256 CHAR(64), failure_reason VARCHAR(200),
  expires_at DATETIME(3), created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, completed_at DATETIME(3),
  INDEX export_job_ledger_created_idx (ledger_id, created_at), INDEX export_job_status_idx (status, updated_at),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id), FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;
