import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {PostgresStore} from '../../src/postgres.js';
import {lot2Scenarios} from '../helpers/lot2-scenarios.js';
test('Lot 2 native PostgreSQL transaction and permission scenarios',async t=>{
  assert.ok(process.env.TEST_DATABASE_URL,'TEST_DATABASE_URL required');
  const schema='test_'+randomUUID().replaceAll('-','');
  const owner=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
  await owner.query(`CREATE SCHEMA ${schema}`);
  const store=new PostgresStore(new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`,max:10}));
  try{await lot2Scenarios(t,store);}finally{await store.close();await owner.query(`DROP SCHEMA ${schema} CASCADE`);await owner.end();}
});
