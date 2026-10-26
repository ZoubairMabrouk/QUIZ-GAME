ALTER TABLE competitions ADD COLUMN current_question INTEGER NOT NULL DEFAULT -1;
ALTER TABLE competitions ADD COLUMN phase_one_limit INTEGER NOT NULL DEFAULT 29 CHECK(phase_one_limit BETWEEN 1 AND 200);
ALTER TABLE competitions ADD COLUMN question_started_at TIMESTAMPTZ;
ALTER TABLE competitions ADD COLUMN question_deadline TIMESTAMPTZ;
ALTER TABLE competitions ADD COLUMN next_transition_at TIMESTAMPTZ;
ALTER TABLE competitions ADD COLUMN initial_players INTEGER NOT NULL DEFAULT 0;
ALTER TABLE competitions ADD COLUMN milestone_golden INTEGER NOT NULL DEFAULT 1 CHECK(milestone_golden BETWEEN 0 AND 1000000);
ALTER TABLE competitions ADD COLUMN winner_golden INTEGER NOT NULL DEFAULT 5 CHECK(winner_golden BETWEEN 0 AND 1000000);
ALTER TABLE competitions ADD COLUMN tie_seed TEXT;
ALTER TABLE competitions ADD COLUMN tie_commitment TEXT;
ALTER TABLE competitions ADD COLUMN finished_at TIMESTAMPTZ;
ALTER TABLE competitions ADD COLUMN resolution_reason TEXT;
ALTER TABLE competition_registrations ADD COLUMN eliminated_at INTEGER;
ALTER TABLE competition_registrations ADD COLUMN final_rank INTEGER;
ALTER TABLE competition_registrations ADD COLUMN cumulative_ms BIGINT NOT NULL DEFAULT 0;
ALTER TABLE competition_registrations ADD COLUMN milestone_awarded BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE competition_registrations ADD COLUMN last_seen_at TIMESTAMPTZ;
CREATE INDEX competition_survivors ON competition_registrations(competition_id,eliminated_at);
CREATE TABLE competition_answers (
  competition_id UUID NOT NULL,
  question_no INTEGER NOT NULL,
  user_id UUID NOT NULL,
  choice INTEGER NOT NULL CHECK(choice BETWEEN 0 AND 3),
  response_ms INTEGER NOT NULL CHECK(response_ms BETWEEN 0 AND 9999),
  received_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(competition_id,question_no,user_id),
  FOREIGN KEY(competition_id,user_id) REFERENCES competition_registrations(competition_id,user_id)
);
CREATE TRIGGER competition_answers_immutable BEFORE UPDATE OR DELETE ON competition_answers
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TABLE competition_rounds (
  competition_id UUID NOT NULL REFERENCES competitions(id),
  question_no INTEGER NOT NULL,
  phase TEXT NOT NULL,
  survivors INTEGER NOT NULL,
  all_wrong BOOLEAN NOT NULL,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(competition_id,question_no)
);
CREATE TABLE competition_events (
  id BIGSERIAL PRIMARY KEY,
  competition_id UUID NOT NULL REFERENCES competitions(id),
  revision BIGINT NOT NULL,
  state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(competition_id,revision)
);
CREATE INDEX competition_events_lookup ON competition_events(competition_id,id);
