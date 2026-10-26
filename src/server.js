import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { PostgresStore } from "./postgres.js";
import { RedisSecurity } from "./redis-security.js";
import { TwilioVerify, MockVerify } from "./otp-provider.js";
import { Auth } from "./auth.js";
import { DurableRooms } from "./durable-rooms.js";
import { Realtime,originAllowed } from "./realtime.js";
import { requireRule } from "./rules.js";
import { Competitions } from './competitions.js';
import { Editorial } from './editorial.js';
import { Administration } from './administration.js';
import { AdminAuth } from './admin-auth.js';
export function createApp({ store, security, provider, config }) {
  const auth = new Auth({ store, security, provider, config });
  const rooms = new DurableRooms(store);
  const competitions = new Competitions(store);
  const editorial = new Editorial(store);
  const administration = new Administration(store);
  const adminAuth = new AdminAuth({store,security,config});
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status, value) => {
      res.writeHead(status);
      res.end(JSON.stringify(value));
    };
    try {
      const origin=req.headers.origin;
      requireRule(originAllowed(origin,config),'Origin not allowed',403);
      if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
      if(req.method==='OPTIONS'){
        res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
        res.writeHead(204);res.end();return;
      }
      const path = new URL(req.url, "http://localhost").pathname;
      if (req.method === "GET" && path === "/health")
        return send(200, { status: "ok", version: "0.3.0" });
      if(req.method==='GET' && path==='/config')return send(200,{otpMode:config.provider??(provider.real?'twilio':'mock'),channels:config.channels});
      if (req.method === "GET" && path === "/ready") {
        await store.pool.query("SELECT 1");
        await security.client.ping();
        return send(200, { status: "ready" });
      }
      // Do not trust client-controlled X-Forwarded-For. Configure edge limits before production.
      const ip = req.socket.remoteAddress;
      await security.limit("http", ip, 240, 60);
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
      if (req.method === "POST" && path === "/auth/otp/request")
        return send(202, await auth.request(body, ip));
      if(req.method==='POST' && path==='/v1/admin/auth/login')
        return send(200,await adminAuth.login(body,ip));
      if (req.method === "POST" && path === "/auth/otp/verify")
        return send(200, await auth.verify(body, ip));
      if (req.method === "POST" && path === "/auth/refresh") {
        await security.limit("refresh", ip, 30, 60);
        return send(200, await store.refresh(body.refreshToken,{allowDevelopmentAdmin:config.mode!=='production'}));
      }
      const token = req.headers.authorization?.match(
        /^Bearer ([a-f0-9]{64})$/,
      )?.[1];
      const user = await store.authenticate(token,{allowDevelopmentAdmin:config.mode!=='production'});
      if(user.audience==='admin') {
        const allowed=path.startsWith('/v1/admin/') || (req.method==='GET' && (/^\/v1\/competitions(?:\/[a-f0-9-]{36})?$/.test(path)||path==='/v1/leaderboards'||path==='/me')) || (req.method==='POST' && path==='/auth/logout');
        requireRule(allowed,'Player phone session required',403);
      }
      requireRule(
        user.audience==='admin' || config.mode !== "production" || user.phoneVerified,
        "Verified phone required",
        403,
      );
      if(req.method==='POST' && path==='/v1/admin/auth/password') {
        await security.limit('admin-password',user.id,5,60);
        return send(200,await adminAuth.changePassword(user,body));
      }
      if (req.method === "POST" && path === "/auth/logout") {
        await store.logout(user.familyId);
        return send(200, { loggedOut: true });
      }
      if (req.method === "GET" && path === "/me") {
        const { familyId, ...profile } = user;
        return send(200, profile);
      }
      if (req.method === "POST" && path === "/me/profile")
        return send(200, await store.profile(user.id, body.pseudo));
      if (req.method === "GET" && path === "/wallet")
        return send(200, await store.wallet(user.id));
      if (req.method === 'GET' && path === '/v1/competitions')
        return send(200, await competitions.list(user));
      const adminRead=path.match(/^\/v1\/admin\/(audit|ledger|users)$/);
      if(req.method==='GET' && adminRead)
        return send(200,await administration.read(user,adminRead[1],Number(new URL(req.url,'http://localhost').searchParams.get('offset')??0)));
      if(req.method==='POST' && path==='/v1/admin/wallet/adjustments')
        return send(200,await administration.adjust(user,body));
      if(req.method==='GET' && path==='/v1/leaderboards')
        return send(200,await competitions.leaderboard(new URL(req.url,'http://localhost').searchParams.get('period')??'all'));
      const playRoute=path.match(/^\/v1\/competitions\/([^/]+)\/(play|answers)$/);
      if(playRoute) {
        if(req.method==='GET' && playRoute[2]==='play') return send(200,await competitions.play(user,playRoute[1]));
        if(req.method==='POST' && playRoute[2]==='answers') return send(200,await competitions.play(user,playRoute[1],body));
      }
      if (req.method === 'GET' && path === '/v1/admin/catalog')
        return send(200, await editorial.list(user));
      if(req.method==='GET' && path==='/v1/admin/catalog/statistics')
        return send(200,await editorial.statistics(user));
      if (req.method === 'POST' && path === '/v1/admin/categories')
        return send(200, await editorial.category(user,body));
      if (req.method === 'POST' && path === '/v1/admin/questions/import')
        return send(200, await editorial.import(user,body));
      if (req.method === 'POST' && path === '/v1/admin/questions')
        return send(201, await editorial.save(user,body));
      const questionRoute=path.match(/^\/v1\/admin\/questions\/([^/]+)(?:\/(history))?$/);
      if(questionRoute) {
        if(req.method==='GET' && questionRoute[2]) return send(200,await editorial.history(user,questionRoute[1]));
        if(req.method==='POST' && !questionRoute[2]) return send(200,await editorial.save(user,body,questionRoute[1]));
      }
      if (req.method === 'POST' && path === '/v1/admin/competitions')
        return send(201, await competitions.create(user, body));
      const competitionRoute = path.match(/^\/v1\/(admin\/)?competitions\/([^/]+)(?:\/(open|cancel|register))?$/);
      if (competitionRoute) {
        const [, admin, id, action] = competitionRoute;
        if (req.method === 'GET' && !admin && !action)
          return send(200, await competitions.list(user,id));
        if (req.method === 'POST' && !admin && action === 'register')
          return send(200, await competitions.register(user,id));
        if (req.method === 'POST' && admin && ['open','cancel'].includes(action))
          return send(200, await competitions[action](user,id));
      }
      if (req.method === "POST" && path === "/rooms") {
        await security.limit("room-create", user.id, 10, 3600);
        return send(201, await rooms.create(user, body));
      }
      const match = path.match(
        /^\/rooms\/([A-Z2-9]{6})(?:\/(join|ready|start|answers|next))?$/,
      );
      if (match) {
        const [, code, action] = match;
        if ((req.method === "GET" && !action)||(req.method === "POST" && action)) {
          const result=await rooms.execute(user,code,action??'state',body);await realtime.publish(code);return send(200,result);
        }
      }
      send(404, { error: "Route not found" });
    } catch (e) {
      const status = e.status ?? 503;
      if (!e.status)
        console.error(
          JSON.stringify({
            event: "dependency_failure",
            code: typeof e.code === "string" ? e.code : "unavailable",
          }),
        );
      if (status === 429) res.setHeader("Retry-After", "60");
      send(status, {
        error: e.status ? e.message : "Service temporarily unavailable",
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  const realtime=new Realtime({server,store,security,rooms,competitions,config});
  const ready=realtime.start();
  let reconciling;
  const competitionTimer=setInterval(()=>{
    if (reconciling) return;
    reconciling=competitions.reconcile().catch(()=>console.error(JSON.stringify({event:'competition_reconciliation_failed'}))).finally(()=>{reconciling=null;});
  },1000);
  competitionTimer.unref();
  const close=async()=>{clearInterval(competitionTimer);await reconciling;await realtime.close();await new Promise(resolve=>server.close(resolve));};
  return { server, auth, rooms, competitions, realtime, ready, close };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const config = loadConfig();
  const store = PostgresStore.connect(config.databaseUrl);
  // Migrations run explicitly, never with a privileged schema owner in the API startup path.
  await store.pool.query("SELECT 1 FROM schema_migrations LIMIT 1");
  const security = await RedisSecurity.connect(
    config.redisUrl,
    config.hashSecret,
  );
  const provider =
    config.provider === "twilio"
      ? new TwilioVerify(config.twilio)
      : new MockVerify({ mode: config.mode, phones: config.mockPhones });
  const { server,ready,close } = createApp({ store, security, provider, config });
  await ready;
  server.listen(config.port, config.host, () =>
    console.log(
      JSON.stringify({
        event: "listening",
        port: config.port,
        otpProvider: config.provider,
      }),
    ),
  );
  const shutdown = async () => {await close();await security.close();await store.close();process.exit(0);};
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
