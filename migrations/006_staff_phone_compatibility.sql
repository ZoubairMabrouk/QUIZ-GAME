-- Also repairs installations which already recorded the original 005.
-- Preserve all accounts, credentials, roles and session revocations.
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_player_phone_required;
ALTER TABLE users ADD CONSTRAINT users_player_phone_required CHECK(account_kind='staff' OR phone IS NOT NULL);
