CREATE TABLE question_categories (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE editorial_questions (
  id UUID PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  category TEXT NOT NULL REFERENCES question_categories(slug),
  language TEXT NOT NULL CHECK (language IN ('fr','en','ar')),
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  status TEXT NOT NULL CHECK (status IN ('draft','validated','retired')),
  development BOOLEAN NOT NULL DEFAULT false,
  content JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX editorial_selection ON editorial_questions(status,language,category,difficulty);
CREATE TABLE question_versions (
  question_id UUID NOT NULL REFERENCES editorial_questions(id),
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  actor_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(question_id,version)
);
CREATE TRIGGER question_versions_immutable BEFORE UPDATE OR DELETE ON question_versions
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TABLE competition_questions (
  competition_id UUID NOT NULL REFERENCES competitions(id),
  position INTEGER NOT NULL,
  question_id UUID NOT NULL REFERENCES editorial_questions(id),
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  PRIMARY KEY(competition_id,position),
  UNIQUE(competition_id,question_id)
);
CREATE TRIGGER competition_questions_immutable BEFORE UPDATE OR DELETE ON competition_questions
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
ALTER TABLE competitions ADD COLUMN questions_frozen_at TIMESTAMPTZ;
ALTER TABLE competitions ADD COLUMN question_language TEXT NOT NULL DEFAULT 'fr';
ALTER TABLE competitions ADD COLUMN question_limit INTEGER NOT NULL DEFAULT 30 CHECK(question_limit BETWEEN 1 AND 200);
ALTER TABLE competitions ADD COLUMN question_difficulty INTEGER CHECK(question_difficulty BETWEEN 1 AND 5);
ALTER TABLE competitions ADD COLUMN repetition_days INTEGER NOT NULL DEFAULT 7 CHECK(repetition_days BETWEEN 0 AND 365);
