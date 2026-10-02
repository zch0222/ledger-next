-- Idempotency-Key replay store (M1-API). Scope = actor + method + canonical path + key, hashed to one unique column.
-- Rows are written in the same transaction as the business change, so a crash never leaves a "succeeded" key without its effect.
-- Recovery: additive table only; dropping it loses replay protection for in-flight keys but no ledger data.
CREATE TABLE IF NOT EXISTS idempotency_records (
  scope_hash CHAR(64) PRIMARY KEY, actor_id VARCHAR(36) NOT NULL, method VARCHAR(10) NOT NULL,
  path VARCHAR(255) NOT NULL, idempotency_key VARCHAR(128) NOT NULL, request_hash CHAR(64) NOT NULL,
  response_status SMALLINT NOT NULL, response_body MEDIUMTEXT NOT NULL, response_headers TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL, expires_at DATETIME(3) NOT NULL,
  INDEX idempotency_expiry_idx (expires_at), INDEX idempotency_actor_idx (actor_id),
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
