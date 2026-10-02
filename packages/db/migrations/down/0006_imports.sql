-- Recovery for 0006_imports.sql. Import rows link to booked money; refuse while any batch exists.
-- requires-empty: import_rows import_jobs export_jobs
DROP TABLE IF EXISTS export_jobs;
--> statement-breakpoint
DROP TABLE IF EXISTS import_rows;
--> statement-breakpoint
DROP TABLE IF EXISTS import_jobs;
