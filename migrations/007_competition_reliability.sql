CREATE TABLE competition_connections (
  id UUID PRIMARY KEY,
  competition_id UUID NOT NULL,
  user_id UUID NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()+interval '15 seconds',
  disconnected_at TIMESTAMPTZ,
  FOREIGN KEY(competition_id,user_id) REFERENCES competition_registrations(competition_id,user_id)
);
CREATE INDEX competition_connections_lookup ON competition_connections(competition_id,user_id,expires_at);
CREATE TABLE competition_notifications (
  id BIGSERIAL PRIMARY KEY,
  competition_id UUID NOT NULL REFERENCES competitions(id),
  user_id UUID NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('one_hour','five_minutes')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  read_at TIMESTAMPTZ,
  UNIQUE(competition_id,user_id,kind)
);
CREATE TABLE competition_schedules (
  id UUID PRIMARY KEY,
  actor_id UUID NOT NULL REFERENCES users(id),
  template JSONB NOT NULL,
  time_zone TEXT NOT NULL,
  local_time TIME NOT NULL,
  next_at TIMESTAMPTZ NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE competitions ADD COLUMN schedule_id UUID REFERENCES competition_schedules(id);
ALTER TABLE competition_registrations ADD COLUMN answer_revision INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX competition_daily_occurrence ON competitions(schedule_id,starts_at) WHERE schedule_id IS NOT NULL;
CREATE INDEX competition_history ON competition_registrations(user_id,registered_at,competition_id);
CREATE INDEX competition_events_revision ON competition_events(competition_id,revision);
-- NULL actor denotes a scheduler action; details retain the incident policy.
ALTER TABLE admin_audit ALTER COLUMN actor_id DROP NOT NULL;
