CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(255) NOT NULL UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE, image TEXT,
  created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(36) PRIMARY KEY, expires_at DATETIME(3) NOT NULL, token VARCHAR(255) NOT NULL UNIQUE,
  created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, ip_address VARCHAR(64), user_agent TEXT,
  user_id VARCHAR(36) NOT NULL, INDEX sessions_user_idx (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS auth_accounts (
  id VARCHAR(36) PRIMARY KEY, account_id VARCHAR(255) NOT NULL, provider_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(36) NOT NULL, access_token TEXT, refresh_token TEXT, id_token TEXT,
  access_token_expires_at DATETIME(3), refresh_token_expires_at DATETIME(3), scope TEXT, password TEXT,
  created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY auth_provider_account_uq (provider_id, account_id), INDEX auth_accounts_user_idx (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS verifications (
  id VARCHAR(36) PRIMARY KEY, identifier VARCHAR(255) NOT NULL, value TEXT NOT NULL,
  expires_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
  INDEX verifications_identifier_idx (identifier)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ledgers (
  id VARCHAR(36) PRIMARY KEY, name VARCHAR(80) NOT NULL, base_currency VARCHAR(3) NOT NULL,
  timezone VARCHAR(64) NOT NULL, version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
  CONSTRAINT ledger_version_positive CHECK (version > 0)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS memberships (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, user_id VARCHAR(36) NOT NULL,
  role ENUM('owner','editor','viewer') NOT NULL, version INT NOT NULL DEFAULT 1, created_at DATETIME(3) NOT NULL,
  UNIQUE KEY membership_ledger_user_uq (ledger_id,user_id), INDEX membership_user_idx (user_id),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT membership_version_positive CHECK (version > 0)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, actor_id VARCHAR(36) NOT NULL,
  action VARCHAR(80) NOT NULL, resource_id VARCHAR(36) NOT NULL, request_id VARCHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL, INDEX audit_ledger_date_idx (ledger_id,created_at),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id), FOREIGN KEY (actor_id) REFERENCES users(id)
) ENGINE=InnoDB;
