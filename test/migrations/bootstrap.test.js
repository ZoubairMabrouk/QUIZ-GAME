import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {embeddedStore} from '../helpers/embedded-store.js';
import {bootstrapStaff} from '../../src/bootstrap-staff.js';
import {AdminAuth} from '../../src/admin-auth.js';

for (const startingPoint of ['fresh', '004', '005-recorded']) {
  test(`migrations and staff authentication from ${startingPoint}`, async () => {
    const store = await embeddedStore();
    let preserved;
    try {
      if (startingPoint !== 'fresh') {
        await store.pool.query('CREATE TABLE schema_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
        const names = (await readdir(new URL('../../migrations/', import.meta.url))).filter(n => n.endsWith('.sql')).sort();
        for (const name of names.filter(n => n.slice(0,3) <= (startingPoint === '004' ? '004' : '005'))) {
          await store.pool.query(await readFile(new URL('../../migrations/' + name, import.meta.url), 'utf8'));
          await store.pool.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
        }
        // Model the NOT NULL schema left by an already-recorded legacy 005.
        if (startingPoint === '005-recorded') {
          await store.pool.query('ALTER TABLE users DROP CONSTRAINT users_player_phone_required');
          await store.pool.query('ALTER TABLE users ALTER COLUMN phone SET NOT NULL');
          preserved = randomUUID();
          await store.pool.query("INSERT INTO users(id,pseudo,phone,account_kind) VALUES($1,'LegacyStaff','+12025550123','staff')", [preserved]);
          await store.pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'administrator')", [preserved]);
          await store.pool.query("INSERT INTO admin_credentials(user_id,username,password_salt,password_hash,development_only) VALUES($1,'legacy-staff',$2,$3,true)", [preserved,'a'.repeat(32),'b'.repeat(128)]);
          await store.pool.query("INSERT INTO session_families(id,user_id,audience,revoked_at) VALUES($1,$2,'admin',now())", [randomUUID(),preserved]);
        }
      }
      await store.migrate();
      assert.equal((await store.pool.query('SELECT * FROM admin_credentials')).rowCount, preserved ? 1 : 0);
      if (preserved) {
        const {rows:[credential]} = await store.pool.query('SELECT * FROM admin_credentials WHERE user_id=$1', [preserved]);
        assert.equal(credential.password_hash, 'b'.repeat(128));
        assert.equal(credential.development_only, true);
        assert.ok((await store.pool.query('SELECT revoked_at FROM session_families WHERE user_id=$1', [preserved])).rows[0].revoked_at);
      }
      await assert.rejects(store.pool.query('INSERT INTO users(id,pseudo) VALUES($1,$2)', [randomUUID(), 'MissingPhone']));
      const password = randomUUID();
      const id = await bootstrapStaff(store, {username:'zoubair', password});
      await assert.rejects(bootstrapStaff(store, {username:'zoubair', password:randomUUID()}));
      const auth = new AdminAuth({store, security:{async limit() {}}, config:{mode:'production'}});
      await assert.rejects(auth.login({username:'zoubair', password:'wrong'}, 'local'));
      const session = await auth.login({username:'zoubair', password}, 'local');
      assert.equal(session.user.id, id);
      assert.equal(session.user.role, 'administrator');
      await store.migrate();
      assert.equal((await auth.login({username:'zoubair', password}, 'local')).user.id, id);
      await store.pool.query("UPDATE user_roles SET role='moderator' WHERE user_id=$1", [id]);
      await assert.rejects(auth.login({username:'zoubair', password}, 'local'));
    } finally { await store.close(); }
  });
}
