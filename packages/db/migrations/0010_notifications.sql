-- M5-ENGINE: notification channels (per user, credentials sealed with envelope encryption), reminder rules (per
-- ledger and owner), the persistent delivery log (one row per dedupe key — the job store the worker schedules from),
-- delivery attempts, in-app notifications, and dated milestones on subscriptions for trial / cancellation reminders.
-- Additive; recovery: migrations/down/0010_notifications.sql.
CREATE TABLE IF NOT EXISTS notification_channels (
  id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL,
  type ENUM('telegram','feishu','wecom_bot','wecom_app','pushplus_wechat','email','webhook','in_app') NOT NULL,
  name VARCHAR(60) NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status ENUM('unconfigured','verifying','active','degraded','disabled') NOT NULL,
  sealed_config TEXT, key_id VARCHAR(16), config_summary JSON NOT NULL,
  verification_hash CHAR(64), verification_expires_at DATETIME(3), verification_attempts INT NOT NULL DEFAULT 0,
  last_verified_at DATETIME(3), last_error VARCHAR(300), consecutive_failures INT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, deleted_at DATETIME(3),
  INDEX notification_channel_user_idx (user_id, deleted_at, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT notification_channel_version_positive CHECK (version > 0)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS reminder_rules (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, owner_id VARCHAR(36) NOT NULL,
  event_type ENUM('bill_due','trial_end','cancel_deadline','overdue','budget_threshold','daily_entry','weekly_summary','monthly_summary','fx_threshold','delivery_failed') NOT NULL,
  subscription_id VARCHAR(36), budget_id VARCHAR(36), lead_days JSON NOT NULL, local_time CHAR(5) NOT NULL, timezone VARCHAR(64) NOT NULL,
  quiet_start CHAR(5), quiet_end CHAR(5), channel_ids JSON NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE, template_version INT NOT NULL DEFAULT 1,
  include_details BOOLEAN NOT NULL DEFAULT FALSE,
  fx_base VARCHAR(3), fx_quote VARCHAR(3), fx_above DECIMAL(24,10), fx_below DECIMAL(24,10), fx_state JSON,
  planned_through DATETIME(3), version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, deleted_at DATETIME(3),
  UNIQUE KEY reminder_rule_ledger_uq (ledger_id, id), INDEX reminder_rule_owner_idx (ledger_id, owner_id, deleted_at, created_at),
  INDEX reminder_rule_plan_idx (enabled, deleted_at, planned_through), INDEX reminder_rule_event_idx (event_type, enabled, deleted_at),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id), FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT reminder_rule_subscription_fk FOREIGN KEY (ledger_id, subscription_id) REFERENCES subscriptions(ledger_id, id),
  CONSTRAINT reminder_rule_budget_fk FOREIGN KEY (ledger_id, budget_id) REFERENCES budgets(ledger_id, id),
  CONSTRAINT reminder_rule_version_positive CHECK (version > 0 AND template_version > 0)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS reminder_previews (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, actor_id VARCHAR(36) NOT NULL, normalized_input JSON NOT NULL,
  expires_at DATETIME(3) NOT NULL, consumed_at DATETIME(3), consumed_by VARCHAR(36), created_at DATETIME(3) NOT NULL,
  INDEX reminder_preview_owner_idx (ledger_id, actor_id, expires_at),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id), FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
--> statement-breakpoint
-- The delivery log is the job store: the dedupe key (ledger / event / subject / rule / channel / recipient / template
-- version) is unique, so planning the same reminder twice — after a restart, by two workers — creates one row.
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36), user_id VARCHAR(36) NOT NULL, channel_id VARCHAR(36) NOT NULL,
  channel_type ENUM('telegram','feishu','wecom_bot','wecom_app','pushplus_wechat','email','webhook','in_app') NOT NULL,
  rule_id VARCHAR(36), rule_version INT, event_type VARCHAR(32) NOT NULL, event_id VARCHAR(160) NOT NULL, subject_id VARCHAR(36),
  dedupe_key VARCHAR(255) NOT NULL, template_version INT NOT NULL, payload JSON NOT NULL,
  scheduled_at DATETIME(3) NOT NULL, expires_at DATETIME(3) NOT NULL, deferred_by_quiet_hours BOOLEAN NOT NULL DEFAULT FALSE,
  status ENUM('queued','sending','accepted','delivered','failed','delivery_unknown','expired','cancelled') NOT NULL,
  round INT NOT NULL DEFAULT 1, attempts INT NOT NULL DEFAULT 0, next_attempt_at DATETIME(3) NOT NULL, last_attempt_at DATETIME(3), claimed_at DATETIME(3),
  response_class ENUM('ok','rate_limited','server_error','client_error','credential_error','timeout','network'),
  provider_message_id VARCHAR(128), last_error VARCHAR(300), reason VARCHAR(160), dead_letter BOOLEAN NOT NULL DEFAULT FALSE,
  version INT NOT NULL DEFAULT 1, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY notification_delivery_dedupe_uq (dedupe_key),
  INDEX notification_delivery_due_idx (status, next_attempt_at), INDEX notification_delivery_ledger_idx (ledger_id, user_id, created_at),
  INDEX notification_delivery_subject_idx (subject_id, status), INDEX notification_delivery_rule_idx (rule_id, status),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES notification_channels(id),
  CONSTRAINT notification_delivery_attempts CHECK (attempts >= 0 AND round >= 1)
) ENGINE=InnoDB;
--> statement-breakpoint
-- One row per send attempt; the unique key stops two workers from sending the same attempt.
CREATE TABLE IF NOT EXISTS notification_attempts (
  id VARCHAR(36) PRIMARY KEY, delivery_id VARCHAR(36) NOT NULL, round INT NOT NULL, attempt_no INT NOT NULL,
  started_at DATETIME(3) NOT NULL, finished_at DATETIME(3),
  outcome ENUM('accepted','delivered','retry','failed','unknown'),
  response_class ENUM('ok','rate_limited','server_error','client_error','credential_error','timeout','network'),
  http_status INT, provider_message_id VARCHAR(128), error VARCHAR(300),
  UNIQUE KEY notification_attempt_uq (delivery_id, round, attempt_no),
  FOREIGN KEY (delivery_id) REFERENCES notification_deliveries(id) ON DELETE CASCADE
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(36) PRIMARY KEY, ledger_id VARCHAR(36) NOT NULL, user_id VARCHAR(36) NOT NULL, event_type VARCHAR(32) NOT NULL,
  title VARCHAR(200) NOT NULL, body VARCHAR(1000) NOT NULL, link VARCHAR(500), delivery_id VARCHAR(36), dedupe_key VARCHAR(255),
  read_at DATETIME(3), version INT NOT NULL DEFAULT 1, created_at DATETIME(3) NOT NULL,
  UNIQUE KEY notification_ledger_uq (ledger_id, id), UNIQUE KEY notification_dedupe_uq (dedupe_key),
  INDEX notification_user_idx (user_id, ledger_id, read_at, created_at),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
--> statement-breakpoint
-- Dated milestones for trial-end / cancellation-deadline reminders. Guarded so a re-run after a partial apply is safe.
SET @ledger_add_milestones := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE subscriptions ADD COLUMN trial_ends_on DATE NULL, ADD COLUMN cancel_by DATE NULL', 'DO 0')
  FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'subscriptions' AND column_name = 'trial_ends_on');
--> statement-breakpoint
PREPARE ledger_add_milestones FROM @ledger_add_milestones;
--> statement-breakpoint
EXECUTE ledger_add_milestones;
--> statement-breakpoint
DEALLOCATE PREPARE ledger_add_milestones;
