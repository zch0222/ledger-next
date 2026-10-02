-- Recovery for 0008_preferences.sql. Preferences are user choices: refuse while any is stored.
-- requires-empty: user_preferences
DROP TABLE IF EXISTS user_preferences;
