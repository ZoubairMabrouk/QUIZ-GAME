import { createClient } from "redis";
import { createHmac, randomUUID } from "node:crypto";
import { requireRule } from "./rules.js";
const RATE = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n`;
const RELEASE = `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`;
const SAVE = `if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end
redis.call('SET',KEYS[2],ARGV[2],'EX',ARGV[3]); redis.call('SET',KEYS[3],ARGV[4],'EX',ARGV[3]); return 1`;
const CONSUME = `if redis.call('GET',KEYS[1])~=ARGV[1] or redis.call('GET',KEYS[2])~=ARGV[2] then return 0 end
if redis.call('EXISTS',KEYS[3])==0 then return 0 end
redis.call('DEL',KEYS[2],KEYS[3]); return 1`;
export class RedisSecurity {
  constructor(client, secret, prefix = "quiz:") {
    this.client = client;
    this.secret = secret;
    this.prefix = prefix;
  }
  static async connect(url, secret) {
    const client = createClient({
      url,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => Math.min(100 * retries, 2000),
      },
    });
    client.on("error", () =>
      console.error(JSON.stringify({ event: "redis_unavailable" })),
    );
    await client.connect();
    return new RedisSecurity(client, secret);
  }
  key(kind, value) {
    return (
      this.prefix +
      kind +
      ":" +
      createHmac("sha256", this.secret).update(String(value)).digest("hex")
    );
  }
  async limit(kind, value, max, seconds) {
    const count = await this.client.eval(RATE, {
      keys: [this.key(kind, value)],
      arguments: [String(seconds)],
    });
    requireRule(count <= max, "Too many attempts; try later", 429);
  }
  async locked(phone, fn) {
    const key = this.key("lock", phone),
      token = randomUUID();
    requireRule(
      await this.client.set(key, token, { NX: true, PX: 20000 }),
      "Verification in progress; try again",
      409,
    );
    try {
      return await fn({ key, token });
    } finally {
      await this.client
        .eval(RELEASE, { keys: [key], arguments: [token] })
        .catch(() => {});
    }
  }
  async cooldown(phone) {
    requireRule(
      await this.client.set(this.key("cooldown", phone), "1", {
        NX: true,
        EX: 60,
      }),
      "Wait 60 seconds before requesting another code",
      429,
    );
  }
  async saveChallenge(challenge, lock) {
    const saved = await this.client.eval(SAVE, {
      keys: [
        lock.key,
        this.key("challenge", challenge.id),
        this.key("active", challenge.phone),
      ],
      arguments: [lock.token, JSON.stringify(challenge), "300", challenge.id],
    });
    requireRule(
      saved === 1,
      "Verification request expired; request a new code",
      409,
    );
  }
  async challenge(id) {
    const raw = await this.client.get(this.key("challenge", id));
    return raw ? JSON.parse(raw) : null;
  }
  async isActive(challenge) {
    return (
      (await this.client.get(this.key("active", challenge.phone))) ===
      challenge.id
    );
  }
  async consume(challenge, lock) {
    return (
      (await this.client.eval(CONSUME, {
        keys: [
          lock.key,
          this.key("active", challenge.phone),
          this.key("challenge", challenge.id),
        ],
        arguments: [lock.token, challenge.id],
      })) === 1
    );
  }
  async close() {
    await this.client.quit();
  }
}
