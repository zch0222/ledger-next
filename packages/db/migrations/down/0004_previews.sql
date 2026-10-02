-- Recovery for 0004_previews.sql. Previews are short-lived and may be dropped; links describe recorded money.
-- requires-empty: transaction_links
DROP TABLE IF EXISTS transaction_links;
--> statement-breakpoint
DROP TABLE IF EXISTS write_previews;
