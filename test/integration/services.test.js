import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { PostgresStore } from "../../src/postgres.js";
import { scenarios } from "../helpers/scenarios.js";
test("PostgreSQL server + Redis: authentication, concurrency and durable rooms", async (t) => {
  assert.ok(
    process.env.TEST_DATABASE_URL,
    "Set TEST_DATABASE_URL to a disposable PostgreSQL instance",
  );
  const schema = "test_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Pool({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const store = new PostgresStore(
    new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${schema}`,
      max: 10,
    }),
  );
  try {
    await scenarios(t, store);
  } finally {
    await store.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
