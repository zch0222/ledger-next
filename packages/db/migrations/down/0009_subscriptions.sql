-- Recovery for 0009_subscriptions.sql. Subscriptions and their bills are user data: refuse while any exists.
-- requires-empty: subscriptions bill_occurrences
DROP TABLE IF EXISTS subscription_previews;
--> statement-breakpoint
DROP TABLE IF EXISTS bill_occurrences;
--> statement-breakpoint
DROP TABLE IF EXISTS subscriptions;
