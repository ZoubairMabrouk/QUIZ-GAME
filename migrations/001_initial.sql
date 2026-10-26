CREATE TABLE users (
  id UUID PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  phone_verified_at TIMESTAMPTZ,
  pseudo TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_pseudo_casefold ON users(lower(pseudo));
CREATE TABLE auth_completions (
  challenge_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE session_families (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  family_id UUID NOT NULL REFERENCES session_families(id),
  access_hash TEXT NOT NULL UNIQUE,
  refresh_hash TEXT NOT NULL UNIQUE,
  access_expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  rotated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_family ON sessions(family_id);
CREATE TABLE wallet_accounts (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  silver_balance BIGINT NOT NULL DEFAULT 0 CHECK(silver_balance >= 0),
  golden_balance BIGINT NOT NULL DEFAULT 0 CHECK(golden_balance >= 0)
);
CREATE TABLE ledger (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES wallet_accounts(user_id),
  currency TEXT NOT NULL CHECK(currency IN ('silver','golden')),
  amount INTEGER NOT NULL CHECK(amount <> 0 AND abs(amount) <= 1000000),
  reason TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_user_time ON ledger(user_id,created_at);
CREATE FUNCTION reject_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable ledger'; END $$;
CREATE TRIGGER ledger_no_mutation BEFORE UPDATE OR DELETE ON ledger
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TABLE rooms (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
