-- Recovery for 0007_reports.sql. Budgets are user configuration: refuse while any exists.
-- requires-empty: budgets
DROP TABLE IF EXISTS ledger_data_versions;
--> statement-breakpoint
DROP TABLE IF EXISTS budgets;
