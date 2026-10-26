import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { requireRule, integer } from "./rules.js";
export class Store {
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, pseudo TEXT NOT NULL UNIQUE COLLATE NOCASE);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger(
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), currency TEXT NOT NULL CHECK(currency IN ('silver','golden')),
        amount INTEGER NOT NULL CHECK(amount != 0), reason TEXT NOT NULL, ref_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id, currency, created_at);
      CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT,'Immutable ledger'); END;
      CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT,'Immutable ledger'); END;`);
  }
  createUser(pseudo) {
    requireRule(
      typeof pseudo === "string" && /^[\p{L}\p{N}_-]{3,24}$/u.test(pseudo),
      "Pseudo: 3–24 letters, numbers, _ or -",
    );
    const id = randomUUID();
    try {
      this.db.prepare("INSERT INTO users VALUES (?,?)").run(id, pseudo);
    } catch (e) {
      if (String(e).includes("UNIQUE"))
        requireRule(false, "Pseudo already used", 409);
      throw e;
    }
    return { id, pseudo };
  }
  balance(userId, currency = "silver") {
    return this.db
      .prepare(
        "SELECT COALESCE(SUM(amount),0) AS balance FROM ledger WHERE user_id=? AND currency=?",
      )
      .get(userId, currency).balance;
  }
  entries(userId) {
    return this.db
      .prepare(
        "SELECT * FROM ledger WHERE user_id=? ORDER BY created_at, rowid",
      )
      .all(userId);
  }
  // BEGIN IMMEDIATE serializes competing debits, including across SQLite connections.
  post(
    { userId, currency = "silver", amount, reason, refId, key },
    now = Date.now(),
  ) {
    integer(amount, -1000000, 1000000, "amount");
    requireRule(
      amount !== 0 && ["silver", "golden"].includes(currency),
      "Invalid posting",
    );
    for (const value of [userId, reason, refId, key])
      requireRule(
        typeof value === "string" && value.length > 0 && value.length <= 200,
        "Invalid ledger metadata",
      );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.db
        .prepare("SELECT * FROM ledger WHERE idempotency_key=?")
        .get(key);
      if (old) {
        requireRule(
          old.user_id === userId &&
            old.currency === currency &&
            old.amount === amount &&
            old.reason === reason &&
            old.ref_id === refId,
          "Idempotency conflict",
          409,
        );
        this.db.exec("COMMIT");
        return old;
      }
      requireRule(
        this.balance(userId, currency) + amount >= 0,
        "Insufficient funds",
        409,
      );
      if (reason === "room_reward") {
        requireRule(currency === "silver" && amount > 0, "Invalid room reward");
        const dayStart = Math.floor(now / 86400000) * 86400000;
        const gained = this.db
          .prepare(
            "SELECT COALESCE(SUM(amount),0) AS total FROM ledger WHERE user_id=? AND reason='room_reward' AND created_at>=? AND created_at<?",
          )
          .get(userId, dayStart, dayStart + 86400000).total;
        requireRule(
          gained + amount <= 100,
          "Daily room reward cap reached",
          409,
        );
      }
      const entry = {
        id: randomUUID(),
        user_id: userId,
        currency,
        amount,
        reason,
        ref_id: refId,
        idempotency_key: key,
        created_at: now,
      };
      this.db
        .prepare("INSERT INTO ledger VALUES (?,?,?,?,?,?,?,?)")
        .run(...Object.values(entry));
      this.db.exec("COMMIT");
      return entry;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
