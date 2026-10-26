ALTER TABLE users ADD COLUMN account_kind TEXT NOT NULL DEFAULT 'player'
  CHECK(account_kind IN ('player','staff'));
ALTER TABLE session_families ADD COLUMN audience TEXT NOT NULL DEFAULT 'player'
  CHECK(audience IN ('player','admin'));
CREATE TABLE admin_credentials (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  username TEXT NOT NULL UNIQUE CHECK(username ~ '^[a-z0-9_.-]{3,64}$'),
  password_salt TEXT NOT NULL CHECK(password_salt ~ '^[0-9a-f]{32}$'),
  password_hash TEXT NOT NULL CHECK(password_hash ~ '^[0-9a-f]{128}$'),
  development_only BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Staff identities may omit phones; player identities may not.
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_player_phone_required CHECK(account_kind='staff' OR phone IS NOT NULL);
