-- M4-THEME: per-user display preferences (no financial data). Additive; recovery: migrations/down/0008_preferences.sql.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id VARCHAR(36) PRIMARY KEY, theme_mode ENUM('system','light','dark') NOT NULL,
  accent_type ENUM('preset','custom') NOT NULL, accent_value VARCHAR(16) NOT NULL, palette_version INT NOT NULL,
  version INT NOT NULL, updated_at DATETIME(3) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT user_preferences_version_positive CHECK (version > 0)
) ENGINE=InnoDB;
