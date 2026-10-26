CREATE TABLE user_roles (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('administrator','moderator'))
);
CREATE TABLE admin_audit (
  id UUID PRIMARY KEY,
  actor_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_id UUID NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE competitions (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  time_zone TEXT NOT NULL,
  silver_cost INTEGER NOT NULL CHECK (silver_cost BETWEEN 0 AND 1000000),
  minimum_players INTEGER NOT NULL CHECK (minimum_players BETWEEN 2 AND 100000),
  categories JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'PLANIFIEE' CHECK (state IN
    ('PLANIFIEE','INSCRIPTIONS_OUVERTES','INSCRIPTIONS_CLOSES','PHASE_1','PALIER_ATTEINT','PHASE_2','TERMINEE','ANNULEE')),
  cancellation_reason TEXT,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX competitions_schedule ON competitions(state,starts_at);
CREATE TABLE competition_registrations (
  competition_id UUID NOT NULL REFERENCES competitions(id),
  user_id UUID NOT NULL REFERENCES users(id),
  paid_silver INTEGER NOT NULL CHECK (paid_silver >= 0),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  refunded_at TIMESTAMPTZ,
  PRIMARY KEY (competition_id,user_id)
);
