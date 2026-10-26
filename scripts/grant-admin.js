import { PostgresStore } from '../src/postgres.js';
import { randomUUID } from 'node:crypto';

// Local database operation only; never exposes a bootstrap HTTP endpoint.
const userId = process.argv[2];
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId ?? '')) throw new Error('Usage: node --env-file=.env scripts/grant-admin.js USER_UUID');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
const store=PostgresStore.connect(process.env.DATABASE_URL);
try {
  await store.transaction(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(21410002)');
    const {rows:[user]}=await c.query('SELECT id,phone_verified_at FROM users WHERE id=$1 FOR UPDATE',[userId]);
    if (!user) throw new Error('Existing OTP account required');
    if (process.env.NODE_ENV === 'production' && !user.phone_verified_at) throw new Error('Verified phone required');
    await c.query("INSERT INTO user_roles(user_id,role) VALUES($1,'administrator') ON CONFLICT(user_id) DO UPDATE SET role='administrator'",[userId]);
    await c.query("INSERT INTO admin_audit(id,actor_id,action,target_id) VALUES($1,$2,'local.admin_grant',$2)",[randomUUID(),userId]);
  });
  console.log('Administrator role granted to existing account.');
} finally { await store.close(); }
