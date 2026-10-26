import {randomBytes, randomUUID, scrypt} from 'node:crypto';
import {promisify} from 'node:util';

// Explicit, create-only operation: never reset existing credentials or sessions.
export async function bootstrapStaff(store, {username, password, developmentOnly = false}) {
  if (typeof username !== 'string' || !/^[a-z0-9_.-]{3,64}$/.test(username)) throw new Error('Invalid staff username');
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('Staff password must contain 12–1024 characters');
  const salt = randomBytes(16).toString('hex');
  const hash = (await promisify(scrypt)(password, salt, 64)).toString('hex');
  return store.transaction(async c => {
    await c.query('SELECT pg_advisory_xact_lock(21410002)');
    const {rowCount} = await c.query('SELECT 1 FROM admin_credentials WHERE username=$1', [username]);
    if (rowCount) throw new Error('Staff account already exists; use authenticated password change');
    const id = randomUUID();
    await c.query("INSERT INTO users(id,pseudo,phone,account_kind) VALUES($1,$2,NULL,'staff')", [id, 'Staff_' + id]);
    await c.query("INSERT INTO user_roles(user_id,role) VALUES($1,'administrator')", [id]);
    await c.query('INSERT INTO admin_credentials(user_id,username,password_salt,password_hash,development_only) VALUES($1,$2,$3,$4,$5)', [id,username,salt,hash,developmentOnly]);
    await c.query("INSERT INTO admin_audit(id,actor_id,action,target_id) VALUES($1,$2,'local.staff_bootstrap',$2)", [randomUUID(),id]);
    return id;
  });
}
