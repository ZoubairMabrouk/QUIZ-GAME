import { PGlite } from "@electric-sql/pglite";
import { PostgresStore } from "../../src/postgres.js";
// Real PostgreSQL WASM engine, single connection. Does NOT validate server locking or TCP.
export async function embeddedStore() {
  const db = new PGlite();
  await db.waitReady;
  let tail = Promise.resolve();
  async function acquire() {
    const previous = tail;
    let release;
    tail = new Promise((r) => {
      release = r;
    });
    await previous;
    return release;
  }
  async function query(text, params) {
    if (!params && text.includes(";")) {
      const results = await db.exec(text);
      const last = results.at(-1) ?? {};
      return {
        ...last,
        rowCount: last.rowCount ?? last.affectedRows ?? last.rows?.length ?? 0,
      };
    }
    const r = await db.query(text, params);
    return { ...r, rowCount: r.rowCount ?? r.affectedRows ?? r.rows.length };
  }
  const pool = {
    async connect() {
      const release = await acquire();
      return { query, release };
    },
    async query(...args) {
      const release = await acquire();
      try {
        return await query(...args);
      } finally {
        release();
      }
    },
    async end() {
      await db.close();
    },
  };
  return new PostgresStore(pool);
}
