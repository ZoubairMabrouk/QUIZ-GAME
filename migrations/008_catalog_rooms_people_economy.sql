ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT 'owl';
ALTER TABLE users ADD COLUMN country TEXT;
ALTER TABLE users ADD COLUMN languages JSONB NOT NULL DEFAULT '["fr"]';
ALTER TABLE users ADD COLUMN birth_date DATE;
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE users DROP CONSTRAINT users_player_phone_required;
ALTER TABLE users ADD CONSTRAINT users_player_phone_required CHECK(account_kind='staff' OR phone IS NOT NULL OR deleted_at IS NOT NULL);
CREATE TABLE game_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK(id),
  daily_silver_cap INTEGER NOT NULL DEFAULT 100 CHECK(daily_silver_cap BETWEEN 0 AND 1000000),
  daily_bonus INTEGER NOT NULL DEFAULT 5 CHECK(daily_bonus BETWEEN 0 AND 1000),
  room_question_limit INTEGER NOT NULL DEFAULT 30 CHECK(room_question_limit BETWEEN 1 AND 200),
  room_player_limit INTEGER NOT NULL DEFAULT 50 CHECK(room_player_limit BETWEEN 2 AND 100),
  repetition_days INTEGER NOT NULL DEFAULT 7 CHECK(repetition_days BETWEEN 0 AND 365),
  rewarded_games_per_day INTEGER NOT NULL DEFAULT 10 CHECK(rewarded_games_per_day BETWEEN 0 AND 100),
  gift_min_age INTEGER NOT NULL DEFAULT 18 CHECK(gift_min_age BETWEEN 18 AND 100),
  gifts_enabled BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO game_settings(id) VALUES(true);
CREATE TABLE question_exposures (
  user_id UUID NOT NULL REFERENCES users(id),
  question_id UUID NOT NULL REFERENCES editorial_questions(id),
  source_id UUID NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(user_id,question_id,source_id)
);
CREATE INDEX exposure_personal ON question_exposures(user_id,question_id,seen_at);
CREATE TABLE room_memberships (
  room_id UUID NOT NULL REFERENCES rooms(id),
  user_id UUID NOT NULL REFERENCES users(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  kicked BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY(room_id,user_id)
);
INSERT INTO room_memberships(room_id,user_id)
  SELECT r.id,(p->>'id')::uuid FROM rooms r CROSS JOIN LATERAL jsonb_array_elements(r.state->'players') p ON CONFLICT DO NOTHING;
CREATE TABLE game_results (
  room_id UUID NOT NULL REFERENCES rooms(id),
  user_id UUID NOT NULL REFERENCES users(id),
  mode TEXT NOT NULL CHECK(mode IN ('room','solo','duel')),
  score INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  answered INTEGER NOT NULL,
  rewarded BOOLEAN NOT NULL DEFAULT false,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(room_id,user_id)
);
CREATE INDEX game_results_personal ON game_results(user_id,finished_at,room_id);
CREATE TABLE friendships (
  sender_id UUID NOT NULL REFERENCES users(id),
  recipient_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK(sender_id<>recipient_id),
  PRIMARY KEY(sender_id,recipient_id)
);
CREATE UNIQUE INDEX friendship_pair ON friendships(LEAST(sender_id,recipient_id),GREATEST(sender_id,recipient_id));
CREATE TABLE room_invitations (
  id UUID PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES rooms(id),
  sender_id UUID NOT NULL REFERENCES users(id),
  recipient_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(room_id,recipient_id)
);
CREATE TABLE daily_bonus_claims (
  user_id UUID NOT NULL REFERENCES users(id),
  day DATE NOT NULL,
  amount INTEGER NOT NULL,
  PRIMARY KEY(user_id,day)
);
CREATE TABLE wallet_reconciliations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  old_silver BIGINT NOT NULL,
  old_golden BIGINT NOT NULL,
  ledger_silver BIGINT NOT NULL,
  ledger_golden BIGINT NOT NULL,
  repaired BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
