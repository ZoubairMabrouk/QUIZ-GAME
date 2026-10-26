import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { requireRule, integer } from "./rules.js";
export const tokenHash = (value) =>
  createHash("sha256").update(value).digest("hex");
export const newToken = () => randomBytes(32).toString("hex");
export class PostgresStore {
  constructor(pool) {
    this.pool = pool;
  }
  static connect(connectionString) {
    return new PostgresStore(
      new pg.Pool({
        connectionString,
        max: 10,
        connectionTimeoutMillis: 5000,
        statement_timeout: 5000,
      }),
    );
  }
  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await fn(client);
      await client.query("COMMIT");
      return value;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async migrate() {
    return this.transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(21410001)");
      await c.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
      );
      for (const name of (
        await readdir(new URL("../migrations/", import.meta.url))
      )
        .filter((n) => n.endsWith(".sql"))
        .sort()) {
        if (
          (
            await c.query("SELECT 1 FROM schema_migrations WHERE name=$1", [
              name,
            ])
          ).rowCount
        )
          continue;
        await c.query(
          await readFile(
            new URL("../migrations/" + name, import.meta.url),
            "utf8",
          ),
        );
        await c.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
      }
    });
  }
  async session(c, userId, familyId, audience = 'player') {
    const accessToken = newToken(),
      refreshToken = newToken();
    if (!familyId) {
      familyId = randomUUID();
      await c.query("INSERT INTO session_families(id,user_id,audience) VALUES($1,$2,$3)", [
        familyId,
        userId,
        audience,
      ]);
    }
    const {
      rows: [row],
    } = await c.query(
      `INSERT INTO sessions(id,family_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at)
      VALUES($1,$2,$3,$4,now()+interval '15 minutes',now()+interval '30 days') RETURNING access_expires_at,refresh_expires_at`,
      [randomUUID(), familyId, tokenHash(accessToken), tokenHash(refreshToken)],
    );
    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresAt: row.access_expires_at,
      refreshExpiresAt: row.refresh_expires_at,
    };
  }
  async completeLogin({ challengeId, phone, verified }) {
    return this.transaction(async (c) => {
      const id = randomUUID();
      const {
        rows: [u],
      } = await c.query(
        `INSERT INTO users(id,phone,pseudo,phone_verified_at) VALUES($1,$2,$3,CASE WHEN $4 THEN now() ELSE NULL END)
        ON CONFLICT(phone) DO UPDATE SET phone_verified_at=CASE WHEN $4 THEN now() ELSE users.phone_verified_at END RETURNING *`,
        [id, phone, "Player_" + id.replaceAll("-", "").slice(0, 16), verified],
      );
      try {
        await c.query(
          "INSERT INTO auth_completions(challenge_id,user_id) VALUES($1,$2)",
          [challengeId, u.id],
        );
      } catch (e) {
        if (e.code === "23505") requireRule(false, "OTP already consumed", 409);
        throw e;
      }
      await c.query(
        "INSERT INTO wallet_accounts(user_id) VALUES($1) ON CONFLICT DO NOTHING",
        [u.id],
      );
      return { user: this.publicUser(u), ...(await this.session(c, u.id)) };
    });
  }
  publicUser(u) {
    return {
      id: u.id,
      pseudo: u.pseudo,
      phoneMasked: u.phone ? u.phone.slice(0, 3) + "••••" + u.phone.slice(-2) : null,
      phoneVerified: !!u.phone_verified_at,
      avatar:u.avatar??'owl',country:u.country??null,languages:u.languages??['fr'],
    };
  }
  async authenticate(token, {allowDevelopmentAdmin=true} = {}) {
    requireRule(
      typeof token === "string" && /^[0-9a-f]{64}$/.test(token),
      "Authentication required",
      401,
    );
    const {
      rows: [row],
    } = await this.pool.query(
      `SELECT u.*,f.id AS family_id,f.audience,r.role,a.development_only FROM sessions s JOIN session_families f ON f.id=s.family_id JOIN users u ON u.id=f.user_id LEFT JOIN user_roles r ON r.user_id=u.id LEFT JOIN admin_credentials a ON a.user_id=u.id
      WHERE s.access_hash=$1 AND s.access_expires_at>now() AND s.rotated_at IS NULL AND f.revoked_at IS NULL`,
      [tokenHash(token)],
    );
    requireRule(row && !row.deleted_at, "Invalid or expired session", 401);
    requireRule(row.audience!=='admin'||row.role==='administrator','Invalid or expired session',401);
    requireRule(row.audience!=='admin'||allowDevelopmentAdmin||!row.development_only,'Invalid or expired session',401);
    return { ...this.publicUser(row), familyId: row.family_id, audience:row.audience };
  }
  async refresh(refreshToken, {allowDevelopmentAdmin=true} = {}) {
    requireRule(
      typeof refreshToken === "string" && /^[0-9a-f]{64}$/.test(refreshToken),
      "Invalid refresh token",
      401,
    );
    const result = await this.transaction(async (c) => {
      const {
        rows: [row],
      } = await c.query(
        `SELECT s.*,f.user_id,f.revoked_at,f.audience,r.role,a.development_only FROM sessions s JOIN session_families f ON f.id=s.family_id LEFT JOIN user_roles r ON r.user_id=f.user_id LEFT JOIN admin_credentials a ON a.user_id=f.user_id WHERE s.refresh_hash=$1 FOR UPDATE OF f,s`,
        [tokenHash(refreshToken)],
      );
      if (!row || row.revoked_at || (row.audience==='admin' && row.role!=='administrator')) return null;
      if(row.audience==='admin' && !allowDevelopmentAdmin && row.development_only) return null;
      if (row.rotated_at || new Date(row.refresh_expires_at) <= new Date()) {
        await c.query(
          "UPDATE session_families SET revoked_at=now() WHERE id=$1",
          [row.family_id],
        );
        return null;
      }
      await c.query("UPDATE sessions SET rotated_at=now() WHERE id=$1", [
        row.id,
      ]);
      return this.session(c, row.user_id, row.family_id,row.audience);
    });
    requireRule(result, "Invalid or reused refresh token; sign in again", 401);
    return result;
  }
  async logout(familyId) {
    await this.pool.query(
      "UPDATE session_families SET revoked_at=now() WHERE id=$1",
      [familyId],
    );
  }
  async profile(userId, pseudo) {
    requireRule(
      typeof pseudo === "string" && /^[\p{L}\p{N}_-]{3,24}$/u.test(pseudo),
      "Pseudo: 3–24 letters, numbers, _ or -",
    );
    try {
      const {
        rows: [u],
      } = await this.pool.query(
        "UPDATE users SET pseudo=$1 WHERE id=$2 RETURNING *",
        [pseudo, userId],
      );
      return this.publicUser(u);
    } catch (e) {
      if (e.code === "23505") requireRule(false, "Pseudo already used", 409);
      throw e;
    }
  }
  async wallet(userId,{limit=50,offset=0}={}) {
    limit=Number(limit);offset=Number(offset);integer(limit,1,100,'page limit');integer(offset,0,1000000,'page offset');
    return this.transaction(async (c) => {
      const {
        rows: [b],
      } = await c.query(
        "SELECT silver_balance,golden_balance FROM wallet_accounts WHERE user_id=$1 FOR SHARE",
        [userId],
      );
      const { rows: entries } = await c.query(
        "SELECT * FROM ledger WHERE user_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3",
        [userId,limit+1,offset],
      );
      return {
        silver: Number(b.silver_balance),
        golden: Number(b.golden_balance),
        entries:entries.slice(0,limit),nextOffset:entries.length>limit?offset+limit:null,
      };
    });
  }
  async post(c, { userId, currency = "silver", amount, reason, refId, key }) {
    integer(amount, -1000000, 1000000, "amount");
    requireRule(
      amount !== 0 && ["silver", "golden"].includes(currency),
      "Invalid posting",
    );
    for (const v of [userId, reason, refId, key])
      requireRule(
        typeof v === "string" && v.length > 0 && v.length <= 200,
        "Invalid ledger metadata",
      );
    // Key lock serializes retries, account lock serializes all debits/credits and daily cap checks.
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      key,
    ]);
    const {
      rows: [old],
    } = await c.query("SELECT * FROM ledger WHERE idempotency_key=$1", [key]);
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
      return old;
    }
    const {
      rows: [account],
    } = await c.query(
      "SELECT * FROM wallet_accounts WHERE user_id=$1 FOR UPDATE",
      [userId],
    );
    requireRule(account, "Wallet not found", 404);
    const column = currency === "silver" ? "silver_balance" : "golden_balance";
    requireRule(
      BigInt(account[column]) + BigInt(amount) >= 0n,
      "Insufficient funds",
      409,
    );
    if (['room_reward','daily_bonus'].includes(reason)) {
      requireRule(currency === "silver" && amount > 0, "Invalid room reward");
      const {
        rows: [g],
      } = await c.query(
        `SELECT COALESCE(SUM(amount),0) AS gained FROM ledger WHERE user_id=$1 AND reason IN ('room_reward','daily_bonus')
        AND created_at >= (date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`,
        [userId],
      );
      const {rows:[settings]}=await c.query('SELECT daily_silver_cap FROM game_settings WHERE id=true');
      if (Number(g.gained) + amount > settings.daily_silver_cap)
        return { amount: 0, reason: "daily_cap" };
    }
    const {
      rows: [entry],
    } = await c.query(
      `INSERT INTO ledger(id,user_id,currency,amount,reason,ref_id,idempotency_key)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [randomUUID(), userId, currency, amount, reason, refId, key],
    );
    await c.query(
      `UPDATE wallet_accounts SET ${column}=${column}+$1 WHERE user_id=$2`,
      [amount, userId],
    );
    return entry;
  }
  async close() {
    await this.pool.end();
  }
}
