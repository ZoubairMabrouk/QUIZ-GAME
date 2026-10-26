import test from "node:test";
import assert from "node:assert/strict";
import { TwilioVerify, MockVerify } from "../src/otp-provider.js";
import { loadConfig } from "../src/config.js";
import { Auth } from "../src/auth.js";
const config = {
  countries: ["FR", "TN"],
  channels: ["sms", "whatsapp"],
  mockPhones: ["+12025550123"],
  sendDailyLimit: 1000,
};
test("production configuration rejects mock, missing secrets and invalid channels", () => {
  const env = {
    DATABASE_URL: "postgres://localhost/quiz",
    REDIS_URL: "redis://localhost",
    AUTH_HASH_SECRET: "a".repeat(64),
    OTP_PROVIDER: "mock",
  };
  assert.equal(loadConfig(env).provider, "mock");
  assert.throws(
    () => loadConfig({ ...env, NODE_ENV: "production" }),
    /forbidden/,
  );
  assert.throws(
    () => loadConfig({ ...env, AUTH_HASH_SECRET: "short" }),
    /secret/,
  );
  assert.throws(
    () => loadConfig({ ...env, OTP_CHANNELS: "email" }),
    /CHANNELS/,
  );
});
test("phone parsing checks international format, numbering plan and enabled country", () => {
  const auth = new Auth({ provider: { real: true }, config });
  assert.equal(auth.normalizePhone("+33612345678"), "+33612345678");
  assert.throws(() => auth.normalizePhone("0612345678"), /international/);
  assert.throws(() => auth.normalizePhone("+33000000000"), /Invalid/);
  assert.throws(() => auth.normalizePhone("+12025550123"), /Country/);
});
test("mock is explicit, never marks ownership real and refuses unlisted numbers", async () => {
  assert.throws(
    () => new MockVerify({ mode: "production", phones: [] }),
    /forbidden/,
  );
  const p = new MockVerify({ mode: "test", phones: config.mockPhones });
  assert.equal(p.real, false);
  assert.equal(await p.check(await p.send("+12025550123"), "000000"), true);
  assert.equal(await p.check("mock-test", "123456"), false);
  await assert.rejects(p.send("+33612345678"), /not allowed/);
});
test("Twilio uses correct forms for SMS/WhatsApp and checks verification SID", async () => {
  const calls = [];
  const sid = "VE" + "a".repeat(32);
  const client = new TwilioVerify(
    {
      accountSid: "AC" + "b".repeat(32),
      authToken: "test-secret",
      serviceSid: "VA" + "c".repeat(32),
    },
    async (url, options) => {
      calls.push({ url, options });
      return new Response(
        JSON.stringify(
          url.endsWith("VerificationCheck")
            ? { status: "approved" }
            : { status: "pending", sid },
        ),
        { status: 200 },
      );
    },
  );
  for (const channel of ["sms", "whatsapp"])
    assert.equal(await client.send("+33612345678", channel), sid);
  assert.equal(calls[1].options.body.get("Channel"), "whatsapp");
  assert.equal(calls[0].options.body.get("To"), "+33612345678");
  assert.equal(await client.check(sid, "123456"), true);
  assert.equal(calls[2].options.body.get("VerificationSid"), sid);
  assert.ok(calls[2].options.signal);
  assert.equal(client.real, true);
});
test("Twilio errors are sanitized; missing/expired verification is denied", async () => {
  const opts = {
    accountSid: "ACtest",
    authToken: "private",
    serviceSid: "VAtest",
  };
  const expired = new TwilioVerify(
    opts,
    async () => new Response("{}", { status: 404 }),
  );
  assert.equal(await expired.check("sid", "123456"), false);
  const error = new TwilioVerify(
    opts,
    async () =>
      new Response("private provider details +33612345678", { status: 500 }),
  );
  await assert.rejects(
    error.send("+33612345678", "sms"),
    (e) => e.status === 502 && !e.message.includes("336"),
  );
  const pending = new TwilioVerify(
    opts,
    async () => new Response('{"status":"pending"}', { status: 200 }),
  );
  assert.equal(await pending.check("sid", "123456"), false);
});
