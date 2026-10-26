import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Store } from "./store.js";
import { Rooms } from "./rooms.js";
import { requireRule } from "./rules.js";
const digest = (value) => createHash("sha256").update(value).digest("hex");
export function createApp({ store = new Store(), clock } = {}) {
  const rooms = new Rooms(store, clock);
  const buckets = new Map();
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status, value) => {
      res.writeHead(status);
      res.end(JSON.stringify(value));
    };
    try {
      const ip = req.socket.remoteAddress;
      const now = Date.now();
      if (buckets.size > 10000)
        for (const [k, b] of buckets)
          if (now - b.since > 60000) buckets.delete(k);
      const bucket = buckets.get(ip) ?? { since: now, count: 0 };
      if (now - bucket.since > 60000) {
        bucket.since = now;
        bucket.count = 0;
      }
      bucket.count++;
      buckets.set(ip, bucket);
      requireRule(bucket.count <= 240, "Too many requests", 429);
      const path = new URL(req.url, "http://localhost").pathname;
      if (req.method === "GET" && path === "/health")
        return send(200, {
          status: "ok",
          mode: "local-development",
          version: "0.1.0",
        });
      let body = {};
      if (req.method === "POST") {
        requireRule(
          req.headers["content-type"]?.split(";")[0] === "application/json",
          "JSON content type required",
          415,
        );
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          requireRule(size <= 16384, "Body too large", 413);
          chunks.push(chunk);
        }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          requireRule(false, "Invalid JSON");
        }
        requireRule(
          body && typeof body === "object" && !Array.isArray(body),
          "JSON object required",
        );
      }
      if (req.method === "POST" && path === "/dev/sessions") {
        const user = store.createUser(body.pseudo);
        const token = randomBytes(32).toString("hex");
        const expiresAt = Date.now() + 3600000;
        store.db
          .prepare("INSERT INTO sessions VALUES (?,?,?)")
          .run(digest(token), user.id, expiresAt);
        return send(201, { user, token, expiresAt });
      }
      const token = req.headers.authorization?.match(
        /^Bearer ([a-f0-9]{64})$/,
      )?.[1];
      requireRule(token, "Authentication required", 401);
      const user = store.db
        .prepare(
          "SELECT u.id,u.pseudo FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
        )
        .get(digest(token), Date.now());
      requireRule(user, "Session expired or invalid", 401);
      if (req.method === "GET" && path === "/me") return send(200, user);
      if (req.method === "GET" && path === "/wallet")
        return send(200, {
          silver: store.balance(user.id),
          golden: store.balance(user.id, "golden"),
          entries: store.entries(user.id),
        });
      if (req.method === "POST" && path === "/rooms")
        return send(201, rooms.create(user, body));
      const match = path.match(
        /^\/rooms\/([A-Z2-9]{6})(?:\/(join|ready|start|answers|next))?$/,
      );
      if (match) {
        const [, code, action] = match;
        if (req.method === "GET" && !action)
          return send(200, rooms.state(user, code));
        if (req.method === "POST") {
          const actions = {
            join: () => rooms.join(user, code),
            ready: () => rooms.ready(user, code, body.ready),
            start: () => rooms.start(user, code),
            answers: () => rooms.answer(user, code, body),
            next: () => rooms.advance(user, code),
          };
          if (actions[action]) return send(200, actions[action]());
        }
      }
      send(404, { error: "Route not found" });
    } catch (e) {
      const status = e.status ?? 500;
      if (status === 500)
        console.error(
          JSON.stringify({ event: "request_error", message: e.message }),
        );
      send(status, {
        error: status === 500 ? "Internal server error" : e.message,
      });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return { server, store, rooms };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.env.NODE_ENV === "production")
    throw new Error("Legacy development server forbidden in production");
  mkdirSync("data", { recursive: true });
  const { server, store } = createApp({
    store: new Store(process.env.DB_PATH ?? "data/quiz.sqlite"),
  });
  // Deliberately loopback-only until real authentication and deployment controls exist.
  server.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () =>
    console.log("Quiz API: http://127.0.0.1:" + server.address().port),
  );
  const shutdown = () =>
    server.close(() => {
      store.close();
      process.exit(0);
    });
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
