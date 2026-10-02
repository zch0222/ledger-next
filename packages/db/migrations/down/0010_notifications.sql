-- Recovery for 0010_notifications.sql. Channels, rules, the delivery log and in-app notifications are user data:
-- refuse while any exists (restore from backup instead). Subscriptions are listed because the milestone columns
-- would be dropped with them.
-- requires-empty: notification_channels reminder_rules notification_deliveries notifications subscriptions
SET @ledger_drop_milestones := (SELECT IF(COUNT(*) = 1, 'ALTER TABLE subscriptions DROP COLUMN trial_ends_on, DROP COLUMN cancel_by', 'DO 0')
  FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'subscriptions' AND column_name = 'trial_ends_on');
--> statement-breakpoint
PREPARE ledger_drop_milestones FROM @ledger_drop_milestones;
--> statement-breakpoint
EXECUTE ledger_drop_milestones;
--> statement-breakpoint
DEALLOCATE PREPARE ledger_drop_milestones;
--> statement-breakpoint
DROP TABLE IF EXISTS notifications;
--> statement-breakpoint
DROP TABLE IF EXISTS notification_attempts;
--> statement-breakpoint
DROP TABLE IF EXISTS notification_deliveries;
--> statement-breakpoint
DROP TABLE IF EXISTS reminder_previews;
--> statement-breakpoint
DROP TABLE IF EXISTS reminder_rules;
--> statement-breakpoint
DROP TABLE IF EXISTS notification_channels;
