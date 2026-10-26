import {catalogFixture} from './catalog-fixture.js';
import {bootstrapStaff} from '../../src/bootstrap-staff.js';
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { RedisSecurity } from "../../src/redis-security.js";
import { MockVerify, TwilioVerify } from "../../src/otp-provider.js";
import { createApp } from "../../src/server.js";
import { Auth } from "../../src/auth.js";
import { DurableRooms } from "../../src/durable-rooms.js";
export async function scenarios(t, store) {
  await store.migrate();
  await catalogFixture(store);
  assert.ok(
    process.env.TEST_REDIS_URL,
    "Set TEST_REDIS_URL to an isolated Redis instance",
  );
  const client = createClient({
    url: process.env.TEST_REDIS_URL,
    socket: { connectTimeout: 2000, reconnectStrategy: false },
  });
  client.on("error", () => {});
  await client.connect();
  const prefix = "quiz-test:" + randomUUID() + ":";
  const security = new RedisSecurity(
    client,
    "test-only-secret-with-at-least-32-characters",
    prefix,
  );
  const config = {
    mode: "test",
    tickMs:60000,
    countries: ["FR"],
    channels: ["sms", "whatsapp"],
    mockPhones: ["+12025550123", "+12025550124"],
    sendDailyLimit: 1000,
  };
  const provider = new MockVerify({ mode: "test", phones: config.mockPhones });
  let sends = 0;
  const send = provider.send.bind(provider);
  provider.send = async (...args) => {
    sends++;
    return send(...args);
  };
  const { server, auth,ready,close } = createApp({ store, security, provider, config });
  await ready;
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function api(path, { body, token } = {}) {
    const response = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  }
  let alice, bob;
  try {
    await store.migrate();
    await store.migrate();
    await t.test('explicit administrator bootstrap login, scope, role checks, rotation and password changes',async()=>{
      const login=(username,password)=>api('/v1/admin/auth/login',{body:{username,password}});
      assert.equal((await store.pool.query('SELECT * FROM admin_credentials')).rowCount,0);
      const password=randomUUID();
      await bootstrapStaff(store,{username:'zoubair',password,developmentOnly:true});
      await assert.rejects(bootstrapStaff(store,{username:'zoubair',password}));
      assert.equal((await login('zoubair','incorrect')).status,401);
      assert.equal((await login('unknown-admin','incorrect')).status,401);
      const initial=await login('zoubair',password);
      assert.equal(initial.status,200);assert.equal(initial.data.user.role,'administrator');
      assert.equal(initial.data.user.username,'zoubair');
      assert.equal(JSON.stringify(initial.data).includes('password'),false);
      const token=initial.data.accessToken;
      assert.equal((await api('/v1/admin/audit',{token})).status,200);
      assert.equal((await api('/v1/competitions',{token})).status,200);
      assert.equal((await api('/rooms',{token,body:{}})).status,403);
      assert.equal((await api('/wallet',{token})).status,403);
      assert.equal((await api('/v1/competitions/'+randomUUID()+'/register',{token,body:{}})).status,403);
      const {rows:[credential]}=await store.pool.query("SELECT * FROM admin_credentials WHERE username='zoubair'");
      assert.notEqual(credential.password_hash,password);assert.equal(credential.password_hash.length,128);
      config.mode='production';
      try{
        assert.equal((await login('zoubair',password)).status,401);
        assert.equal((await api('/v1/admin/audit',{token})).status,401);
        assert.equal((await api('/auth/refresh',{body:{refreshToken:initial.data.refreshToken}})).status,401);
      }finally{config.mode='test';}
      const rotated=await api('/auth/refresh',{body:{refreshToken:initial.data.refreshToken}});
      assert.equal(rotated.status,200);
      assert.equal((await api('/v1/admin/audit',{token})).status,401);
      assert.equal((await api('/v1/admin/audit',{token:rotated.data.accessToken})).status,200);
      await store.pool.query("UPDATE user_roles SET role='moderator' WHERE user_id=$1",[credential.user_id]);
      assert.equal((await api('/v1/admin/audit',{token:rotated.data.accessToken})).status,401);
      assert.equal((await login('zoubair',password)).status,401);
      await store.pool.query("UPDATE user_roles SET role='administrator' WHERE user_id=$1",[credential.user_id]);
      const active=await login('zoubair',password);assert.equal(active.status,200);
      const changedPassword=randomUUID();
      const changed=await api('/v1/admin/auth/password',{token:active.data.accessToken,body:{currentPassword:password,newPassword:changedPassword}});
      assert.equal(changed.status,200);
      assert.equal((await api('/v1/admin/audit',{token:active.data.accessToken})).status,401);
      assert.equal((await api('/v1/admin/audit',{token:rotated.data.accessToken})).status,401);
      await store.migrate();
      await client.del(security.key('admin-login-account','zoubair'));
      assert.equal((await login('zoubair',password)).status,401);
      config.mode='production';
      try{
        assert.equal((await login('zoubair',changedPassword)).status,200);
        assert.equal((await api('/v1/admin/audit',{token:changed.data.accessToken})).status,200);
      }finally{config.mode='test';}
      for(let i=0;i<5;i++)assert.equal((await login('rate-limited-user','incorrect')).status,401);
      assert.equal((await login('rate-limited-user','incorrect')).status,429);
    });
    await t.test(
      "OTP input, consent, resend limits, wrong code and one-time consumption",
      async () => {
        assert.equal(
          (
            await api("/auth/otp/request", {
              body: { phone: config.mockPhones[0], channel: "sms" },
            })
          ).status,
          400,
        );
        const requested = await api("/auth/otp/request", {
          body: { phone: config.mockPhones[0], channel: "sms", consent: true },
        });
        assert.equal(requested.status, 202);
        assert.equal(requested.data.code, undefined);
        const challengeId = requested.data.challengeId;
        assert.equal(
          (
            await api("/auth/otp/request", {
              body: {
                phone: config.mockPhones[0],
                channel: "whatsapp",
                consent: true,
              },
            })
          ).status,
          429,
        );
        assert.equal(sends, 1);
        assert.equal(
          (
            await api("/auth/otp/verify", {
              body: { challengeId, code: "999999" },
            })
          ).status,
          401,
        );
        const verified = await api("/auth/otp/verify", {
          body: { challengeId, code: "000000" },
        });
        assert.equal(verified.status, 200);
        alice = verified.data;
        assert.equal(alice.user.phoneVerified, false);
        assert.equal(
          JSON.stringify(alice).includes(config.mockPhones[0]),
          false,
        );
        assert.equal(
          (
            await api("/auth/otp/verify", {
              body: { challengeId, code: "000000" },
            })
          ).status,
          401,
        );
        assert.equal(
          (await api("/dev/sessions", { body: { pseudo: "bypass" } })).status,
          401,
        );
        const second = await api("/auth/otp/request", {
          body: {
            phone: config.mockPhones[1],
            channel: "whatsapp",
            consent: true,
          },
        });
        assert.equal(second.status, 202);
        bob = (
          await api("/auth/otp/verify", {
            body: { challengeId: second.data.challengeId, code: "000000" },
          })
        ).data;
      },
    );
    await t.test(
      "database sessions are hashed, refresh rotates and replay revokes family",
      async () => {
        assert.equal(
          (await api("/me", { token: alice.accessToken })).status,
          200,
        );
        const hashes = await store.pool.query(
          "SELECT access_hash,refresh_hash FROM sessions",
        );
        assert.ok(
          hashes.rows.every(
            (s) =>
              s.access_hash !== alice.accessToken &&
              s.refresh_hash !== alice.refreshToken,
          ),
        );
        const r = await api("/auth/refresh", {
          body: { refreshToken: alice.refreshToken },
        });
        assert.equal(r.status, 200);
        assert.equal(
          (await api("/me", { token: alice.accessToken })).status,
          401,
        );
        assert.equal(
          (await api("/me", { token: r.data.accessToken })).status,
          200,
        );
        assert.equal(
          (
            await api("/auth/refresh", {
              body: { refreshToken: alice.refreshToken },
            })
          ).status,
          401,
        );
        assert.equal(
          (await api("/me", { token: r.data.accessToken })).status,
          401,
        );
        // New login fixture represents a newly verified challenge, not an API bypass.
        alice = {
          ...(await store.completeLogin({
            challengeId: randomUUID(),
            phone: config.mockPhones[0],
            verified: false,
          })),
        };
      },
    );
    await t.test(
      "durable room survives service recreation and rewards commit once",
      async () => {
        const room = await api("/rooms", {
          token: alice.accessToken,
          body: { questionCount: 1, durationMs: 1000 },
        });
        assert.equal(room.status, 201);
        const root = "/rooms/" + room.data.code;
        assert.equal((await api(root, { token: bob.accessToken })).status, 403);
        await api(root + "/join", { token: bob.accessToken, body: {} });
        for (const u of [alice, bob])
          await api(root + "/ready", {
            token: u.accessToken,
            body: { ready: true },
          });
        const started = await api(root + "/start", {
          token: alice.accessToken,
          body: {},
        });
        assert.equal(started.status, 200);
        assert.equal(started.data.question.correctIndex, undefined);
        const state = (
          await store.pool.query("SELECT state FROM rooms WHERE code=$1", [
            room.data.code,
          ])
        ).rows[0].state;
        const answer = await api(root + "/answers", {
          token: alice.accessToken,
          body: {
            questionId: state.questions[0].id,
            choice: state.questions[0].correctIndex,
            elapsedMs: 0,
          },
        });
        assert.equal(answer.status, 200);
        assert.equal(
          (
            await api(root + "/answers", {
              token: alice.accessToken,
              body: { questionId: state.questions[0].id, choice: 0 },
            })
          ).status,
          409,
        );
        // Advance only the stored deadline, avoiding sleeps and nondeterministic scheduling.
        await store.pool.query(
          "UPDATE rooms SET state=jsonb_set(state,'{startedAt}',to_jsonb(0::bigint)) WHERE code=$1",
          [state.code],
        );
        const revived = new DurableRooms(store);
        const user = await store.authenticate(alice.accessToken);
        const [a, b] = await Promise.all([
          revived.execute(user, state.code, "state"),
          revived.execute(user, state.code, "state"),
        ]);
        assert.equal(a.status, "finished");
        assert.equal(b.status, "finished");
        assert.equal((await store.wallet(user.id)).silver, 20);
        assert.equal(
          (
            await store.pool.query("SELECT * FROM ledger WHERE user_id=$1", [
              user.id,
            ])
          ).rowCount,
          1,
        );
      },
    );
    await t.test(
      "wallet serializes competing debits, idempotence and rollback",
      async () => {
        const id = alice.user.id;
        const post = (key, amount) =>
          store.transaction((c) =>
            store.post(c, {
              userId: id,
              amount,
              reason: "test",
              refId: "test",
              key,
            }),
          );
        const result = await Promise.allSettled([
          post("debit-a", -15),
          post("debit-b", -15),
        ]);
        assert.equal(result.filter((x) => x.status === "fulfilled").length, 1);
        assert.equal((await store.wallet(id)).silver, 5);
        const [a, b] = await Promise.all([
          post("same-credit", 10),
          post("same-credit", 10),
        ]);
        assert.equal(a.id, b.id);
        assert.equal((await store.wallet(id)).silver, 15);
        await assert.rejects(post("same-credit", 11), /conflict/);
        await assert.rejects(
          store.pool.query("UPDATE ledger SET amount=999"),
          /Immutable/,
        );
        const before = (await store.wallet(id)).silver;
        await assert.rejects(
          store.transaction(async (c) => {
            await store.post(c, {
              userId: id,
              amount: 4,
              reason: "test",
              refId: "rollback",
              key: "rollback",
            });
            throw new Error("injected failure");
          }),
        );
        assert.equal((await store.wallet(id)).silver, before);
      },
    );
    await t.test(
      "Redis TTL, fifth failed check, cross-instance locking and expired codes",
      async () => {
        const phone = "+12025550199";
        const id = randomUUID();
        await security.locked(phone, (lock) =>
          security.saveChallenge(
            { id, phone, sid: "mock-expiry", channel: "sms", real: false },
            lock,
          ),
        );
        await client.expire(security.key("challenge", id), 0);
        await assert.rejects(
          auth.verify({ challengeId: id, code: "000000" }, "expired-ip"),
          (e) => e.status === 401,
        );
        const id2 = randomUUID();
        await security.locked(phone, (lock) =>
          security.saveChallenge(
            {
              id: id2,
              phone,
              sid: "mock-lockout",
              channel: "sms",
              real: false,
            },
            lock,
          ),
        );
        for (let i = 0; i < 5; i++)
          await assert.rejects(
            auth.verify({ challengeId: id2, code: "999999" }, "lockout-ip"),
            (e) => e.status === 401,
          );
        await assert.rejects(
          auth.verify({ challengeId: id2, code: "000000" }, "lockout-ip"),
          (e) => e.status === 429,
        );
        const security2 = new RedisSecurity(client, security.secret, prefix);
        await security.locked(phone, async () => {
          await assert.rejects(
            security2.locked(phone, async () => {}),
            (e) => e.status === 409,
          );
        });
      },
    );
    await t.test(
      "real provider adapter approval marks phone verified (provider HTTP simulated)",
      async () => {
        const sid = "VE" + "e".repeat(32);
        const adapter = new TwilioVerify(
          { accountSid: "ACtest", authToken: "test", serviceSid: "VAtest" },
          async (url) =>
            new Response(
              JSON.stringify(
                url.endsWith("VerificationCheck")
                  ? { status: "approved" }
                  : { status: "pending", sid },
              ),
              { status: 200 },
            ),
        );
        const realAuth = new Auth({
          store,
          security,
          provider: adapter,
          config,
        });
        const request = await realAuth.request(
          { phone: "+33612345678", channel: "sms", consent: true },
          "real-adapter-ip",
        );
        const attempts = await Promise.allSettled([
          realAuth.verify(
            { challengeId: request.challengeId, code: "123456" },
            "real-adapter-ip",
          ),
          realAuth.verify(
            { challengeId: request.challengeId, code: "123456" },
            "real-adapter-ip",
          ),
        ]);
        assert.equal(
          attempts.filter((a) => a.status === "fulfilled").length,
          1,
        );
        const result = attempts.find((a) => a.status === "fulfilled").value;
        assert.equal(result.user.phoneVerified, true);
        await store.profile(result.user.id, "VerifiedPlayer");
        const again = await store.completeLogin({
          challengeId: randomUUID(),
          phone: "+33612345678",
          verified: true,
        });
        assert.equal(again.user.id, result.user.id);
        assert.equal(again.user.pseudo, "VerifiedPlayer");
      },
    );
    await t.test(
      "PostgreSQL daily cap and room settlement rollback",
      async () => {
        const { user } = await store.completeLogin({
          challengeId: randomUUID(),
          phone: "+12025550125",
          verified: false,
        });
        for (let i = 0; i < 5; i++)
          await store.transaction((c) =>
            store.post(c, {
              userId: user.id,
              amount: 20,
              reason: "room_reward",
              refId: "cap",
              key: "cap-" + i,
            }),
          );
        const capped = await store.transaction((c) =>
          store.post(c, {
            userId: user.id,
            amount: 20,
            reason: "room_reward",
            refId: "cap",
            key: "cap-six",
          }),
        );
        assert.equal(capped.amount, 0);
        assert.equal((await store.wallet(user.id)).silver, 100);
        const engine = new DurableRooms(store);
        const a = await store.authenticate(alice.accessToken),
          b = await store.authenticate(bob.accessToken);
        const { code } = await engine.create(a, {
          questionCount: 1,
          durationMs: 1000,
        });
        await engine.execute(b, code, "join");
        for (const u of [a, b])
          await engine.execute(u, code, "ready", { ready: true });
        await engine.execute(a, code, "start");
        await store.pool.query(
          "UPDATE rooms SET state=jsonb_set(state,'{startedAt}',to_jsonb(0::bigint)) WHERE code=$1",
          [code],
        );
        const balances = await Promise.all([
          store.wallet(a.id),
          store.wallet(b.id),
        ]);
        const post = store.post.bind(store);
        let n = 0;
        store.post = async (...args) => {
          if (++n === 2) throw new Error("injected settlement failure");
          return post(...args);
        };
        try {
          await assert.rejects(engine.execute(a, code, "state"), /settlement/);
        } finally {
          store.post = post;
        }
        assert.equal(
          (
            await store.pool.query("SELECT state FROM rooms WHERE code=$1", [
              code,
            ])
          ).rows[0].state.status,
          "question",
        );
        assert.equal((await store.wallet(a.id)).silver, balances[0].silver);
        assert.equal((await store.wallet(b.id)).silver, balances[1].silver);
        assert.equal(
          (await engine.execute(a, code, "state")).status,
          "finished",
        );
      },
    );
    await t.test('competition HTTP routes enforce roles, register once and refund',async()=>{
      const token=alice.accessToken;
      const input={title:'HTTP event',startsAt:new Date(Date.now()+3600000).toISOString(),timeZone:'Africa/Lagos',silverCost:1,minimumPlayers:2,categories:['science']};
      assert.equal((await api('/v1/admin/competitions',{token,body:input})).status,403);
      await store.pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'administrator')",[alice.user.id]);
      const created=await api('/v1/admin/competitions',{token,body:input});
      assert.equal(created.status,201);
      const id=created.data.id;
      assert.equal((await api(`/v1/admin/competitions/${id}/open`,{token,body:{}})).status,200);
      const before=(await api('/wallet',{token})).data.silver;
      assert.ok(before>=1);
      for(let i=0;i<2;i++) assert.equal((await api(`/v1/competitions/${id}/register`,{token,body:{}})).status,200);
      assert.equal((await api('/wallet',{token})).data.silver,before-1);
      const state=await api(`/v1/competitions/${id}`,{token});
      assert.equal(state.data.participants,1);
      assert.equal(state.data.gameplay_enabled,true);
      assert.equal((await api(`/v1/admin/competitions/${id}/cancel`,{token:bob.accessToken,body:{}})).status,403);
      assert.equal((await api(`/v1/admin/competitions/${id}/cancel`,{token,body:{}})).status,200);
      assert.equal((await api('/wallet',{token})).data.silver,before);
      assert.equal((await api('/v1/competitions',{token})).status,200);
      assert.equal((await api('/v1/competitions/not-a-uuid',{token})).status,400);
      assert.equal((await api('/v1/admin/catalog',{token:bob.accessToken})).status,403);
      assert.equal((await api('/v1/admin/categories',{token,body:{slug:'science',name:'Science'}})).status,200);
      const imported=await api('/v1/admin/questions/import',{token,body:{questions:[{text:'bad'}]}});
      assert.equal(imported.status,200);assert.equal(imported.data.imported,0);assert.equal(imported.data.errors.length,1);
      assert.equal((await api('/v1/admin/ledger',{token:bob.accessToken})).status,403);
      const adjustment={userId:bob.user.id,currency:'silver',amount:7,reason:'Test adjustment',key:randomUUID()};
      const previous=(await api('/wallet',{token:bob.accessToken})).data.silver;
      for(let i=0;i<2;i++)assert.equal((await api('/v1/admin/wallet/adjustments',{token,body:adjustment})).status,200);
      assert.equal((await api('/wallet',{token:bob.accessToken})).data.silver,previous+7);
      assert.equal((await api('/v1/admin/wallet/adjustments',{token,body:{...adjustment,reason:'Conflicting reason'}})).status,409);
      assert.equal((await api('/v1/admin/audit',{token})).status,200);
    });
    await t.test(
      "logout revokes sessions and production denies mock account access",
      async () => {
        const logout = await api("/auth/logout", {
          token: bob.accessToken,
          body: {},
        });
        assert.equal(logout.status, 200);
        assert.equal(
          (await api("/me", { token: bob.accessToken })).status,
          401,
        );
        config.mode = "production";
        assert.equal(
          (await api("/me", { token: alice.accessToken })).status,
          403,
        );
        config.mode = "test";
      },
    );
  } finally {
    await close();
    const keys = await client.keys(prefix + "*");
    if (keys.length) await client.del(keys);
    await client.quit();
  }
}
