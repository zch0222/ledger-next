-- Recovery for 0005_fx.sql. Market data can be re-fetched, but manual rates carry user decisions:
-- the rollback refuses while manual_rate_records holds rows (restore from backup instead).
-- requires-empty: manual_rate_records
DROP TABLE IF EXISTS fx_history_requests;
--> statement-breakpoint
DROP TABLE IF EXISTS fx_refresh_jobs;
--> statement-breakpoint
DROP TABLE IF EXISTS manual_rate_records;
--> statement-breakpoint
DROP TABLE IF EXISTS fx_fetch_status;
--> statement-breakpoint
DROP TABLE IF EXISTS fx_rates;
--> statement-breakpoint
DROP TABLE IF EXISTS fx_batches;
