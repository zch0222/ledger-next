-- M6-SERVER: personal access tokens (only a SHA-256 hash is stored; the token is shown once) and approval requests
-- that bind a high-impact Agent write to its exact request (method, path, body hash), actor and expiry.
-- Additive; recovery: migrations/down/0011_agents.sql.
CREATE TABLE IF NOT EXISTS api_tokens (
  id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL, name VARCHAR(60) NOT NULL,
  token_hash CHAR(64) NOT NULL, prefix VARCHAR(16) NOT NULL, scopes JSON NOT NULL, ledger_ids JSON NOT NULL,
  expires_at DATETIME(3) NOT NULL, revoked_at DATETIME(3), last_used_at DATETIME(3), created_at DATETIME(3) NOT NULL,
  UNIQUE KEY api_token_hash_uq (token_hash), INDEX api_token_user_idx (user_id, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS approval_requests (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, status ENUM('pending','approved','rejected','expired','consumed') NOT NULL,
  method ENUM('POST','PATCH','DELETE') NOT NULL, path VARCHAR(255) NOT NULL, body_hash CHAR(64) NOT NULL,
  summary VARCHAR(500) NOT NULL, reason VARCHAR(500), requested_by VARCHAR(36) NOT NULL, via ENUM('session','token') NOT NULL, token_id VARCHAR(36),
  decided_by VARCHAR(36), decided_at DATETIME(3), decision_note VARCHAR(500), expires_at DATETIME(3) NOT NULL, consumed_at DATETIME(3),
  version INT NOT NULL DEFAULT 1, created_at DATETIME(3) NOT NULL,
  UNIQUE KEY approval_ledger_uq (ledger_id, id), INDEX approval_ledger_status_idx (ledger_id, status, created_at),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id), FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT approval_version_positive CHECK (version > 0)
) ENGINE=InnoDB;
