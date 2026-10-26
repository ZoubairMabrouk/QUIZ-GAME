import {PostgresStore} from '../src/postgres.js';
import {bootstrapStaff} from '../src/bootstrap-staff.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
const password = process.env.QUIZ_STAFF_PASSWORD;
delete process.env.QUIZ_STAFF_PASSWORD;
const store = PostgresStore.connect(process.env.DATABASE_URL);
try {
  await store.migrate();
  await bootstrapStaff(store, {username: process.argv[2], password});
  console.log('Staff account created.');
} catch {
  console.error('Staff bootstrap failed. Check username, password policy, existing account and database availability.');
  process.exitCode = 1;
} finally { await store.close(); }
