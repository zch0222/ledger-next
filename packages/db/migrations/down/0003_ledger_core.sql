-- Recovery for 0003_ledger_core.sql, only before any money is recorded. `pnpm db:rollback 0003_ledger_core.sql`
-- refuses while any table listed below holds rows; with data, restore from backup instead of dropping.
-- requires-empty: account_postings transaction_amounts transaction_tags transactions fx_snapshots tags categories accounts outbox_events
DROP TABLE IF EXISTS outbox_events;
--> statement-breakpoint
DROP TABLE IF EXISTS account_postings;
--> statement-breakpoint
DROP TABLE IF EXISTS transaction_amounts;
--> statement-breakpoint
DROP TABLE IF EXISTS transaction_tags;
--> statement-breakpoint
DROP TABLE IF EXISTS transactions;
--> statement-breakpoint
DROP TABLE IF EXISTS fx_snapshots;
--> statement-breakpoint
DROP TABLE IF EXISTS tags;
--> statement-breakpoint
DROP TABLE IF EXISTS categories;
--> statement-breakpoint
DROP TABLE IF EXISTS accounts;
--> statement-breakpoint
DROP TABLE IF EXISTS currencies;
