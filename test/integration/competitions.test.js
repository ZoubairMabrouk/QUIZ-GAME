import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {PostgresStore} from '../../src/postgres.js';
import {competitionScenarios} from '../helpers/competition-scenarios.js';
import {engineScenarios} from '../helpers/competition-engine-scenarios.js';
import {nativeReliability} from '../helpers/native-reliability.js';
test('Competition native PostgreSQL concurrency',async t=>{
  assert.ok(process.env.TEST_DATABASE_URL,'TEST_DATABASE_URL required');
  const schema='test_'+randomUUID().replaceAll('-','');
  const admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
  await admin.query(`CREATE SCHEMA ${schema}`);
  const store=new PostgresStore(new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`,max:10}));
  try {await competitionScenarios(t,store);await engineScenarios(t,store);await nativeReliability(t,store);} finally {await store.close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
