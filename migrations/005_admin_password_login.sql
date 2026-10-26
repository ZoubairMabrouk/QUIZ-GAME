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

-- Requested initial local administrator. Store only salted scrypt output.
-- The application refuses this development credential in production.
INSERT INTO users(id,pseudo,phone,account_kind)
VALUES('a06d7f58-5c1c-4e20-a0e1-6af8a2e4ee01','Admin_zoubair',NULL,'staff');
INSERT INTO user_roles(user_id,role)
VALUES('a06d7f58-5c1c-4e20-a0e1-6af8a2e4ee01','administrator');
INSERT INTO admin_credentials(user_id,username,password_salt,password_hash,development_only)
VALUES('a06d7f58-5c1c-4e20-a0e1-6af8a2e4ee01','zoubair',
  '6d1c5a58eed8fcb7140db63168670c92',
  'aad9f53e0b14b27a8ce04553ab53c5f89941550e8183d2741b8a13e5bbcdbaf1e4486d2ed64ac775f1f8ed12ce37aaa2d0fd485c913efb67770fd59f81e8c2d0',true);
INSERT INTO admin_audit(id,actor_id,action,target_id)
VALUES('f5d6a045-2d84-4bbc-ace1-25160f04afe9','a06d7f58-5c1c-4e20-a0e1-6af8a2e4ee01',
  'migration.admin_seed','a06d7f58-5c1c-4e20-a0e1-6af8a2e4ee01');
