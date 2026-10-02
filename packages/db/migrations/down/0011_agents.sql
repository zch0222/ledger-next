-- Recovery for 0011_agents.sql. Tokens and approval decisions are security records: refuse while any exists.
-- requires-empty: api_tokens approval_requests
DROP TABLE IF EXISTS approval_requests;
--> statement-breakpoint
DROP TABLE IF EXISTS api_tokens;
