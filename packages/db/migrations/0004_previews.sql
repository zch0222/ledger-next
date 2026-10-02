-- M2-LEDGER: server-held write previews and transaction links. Additive (CREATE TABLE IF NOT EXISTS) so a partial
-- run can be re-run; recovery script: migrations/down/0004_previews.sql.
-- A preview stores the normalized input and the computed amounts / locked rate. Submitting it re-checks the
-- account versions it was computed against and consumes it once; nothing here moves money.
CREATE TABLE IF NOT EXISTS write_previews (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, actor_id VARCHAR(36) NOT NULL,
  kind ENUM('expense','income','transfer','refund') NOT NULL, body_hash CHAR(64) NOT NULL,
  normalized_input JSON NOT NULL, computed JSON NOT NULL, account_versions JSON NOT NULL,
  expires_at DATETIME(3) NOT NULL, consumed_at DATETIME(3), consumed_by VARCHAR(36), created_at DATETIME(3) NOT NULL,
  INDEX write_preview_owner_idx (ledger_id, actor_id, expires_at), INDEX write_preview_expiry_idx (expires_at),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id), FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT write_preview_consumed CHECK ((consumed_at IS NULL) = (consumed_by IS NULL))
) ENGINE=InnoDB;
--> statement-breakpoint
-- A child transaction that belongs to another one (a transfer's fee expense). One parent per child.
CREATE TABLE IF NOT EXISTS transaction_links (
  ledger_id VARCHAR(36) NOT NULL, child_id VARCHAR(36) PRIMARY KEY, parent_id VARCHAR(36) NOT NULL,
  kind ENUM('fee') NOT NULL, INDEX transaction_link_parent_idx (ledger_id, parent_id),
  CONSTRAINT transaction_link_child_fk FOREIGN KEY (ledger_id, child_id) REFERENCES transactions(ledger_id, id),
  CONSTRAINT transaction_link_parent_fk FOREIGN KEY (ledger_id, parent_id) REFERENCES transactions(ledger_id, id),
  CONSTRAINT transaction_link_not_self CHECK (child_id <> parent_id)
) ENGINE=InnoDB;
