import { requireRule } from "./rules.js";
const required = (env, key) => {
  const v = env[key];
  requireRule(typeof v === "string" && v.length > 0, `Missing ${key}`);
  return v;
};
export function loadConfig(env = process.env) {
  const mode = env.NODE_ENV ?? "development";
  const provider = env.OTP_PROVIDER ?? "twilio";
  requireRule(["twilio", "mock"].includes(provider), "Invalid OTP_PROVIDER");
  requireRule(
    mode !== "production" || provider === "twilio",
    "Mock OTP forbidden in production",
  );
  const hashSecret = required(env, "AUTH_HASH_SECRET");
  requireRule(
    hashSecret.length >= 32 && !hashSecret.includes("CHANGE_ME"),
    "AUTH_HASH_SECRET must be a random secret of at least 32 characters",
  );
  const config = {
    mode,
    provider,
    hashSecret,
    databaseUrl: required(env, "DATABASE_URL"),
    redisUrl: required(env, "REDIS_URL"),
    host: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? 3000),
    countries: (env.OTP_ALLOWED_COUNTRIES ?? "FR,TN,MA,DZ")
      .split(",")
      .map((s) => s.trim()),
    channels: (env.OTP_CHANNELS ?? "sms").split(",").map((s) => s.trim()),
    mockPhones: (env.MOCK_OTP_PHONES ?? "+12025550123,+12025550124").split(","),
    allowedOrigins: (env.ALLOWED_ORIGINS??"http://localhost:5173,http://127.0.0.1:5173").split(",").filter(Boolean),
    sendDailyLimit: Number(env.OTP_GLOBAL_DAILY_LIMIT ?? 1000),
  };
  requireRule(
    Number.isInteger(config.port) && config.port > 0 && config.port <= 65535,
    "Invalid PORT",
  );
  requireRule(
    Number.isSafeInteger(config.sendDailyLimit) && config.sendDailyLimit > 0,
    "Invalid OTP_GLOBAL_DAILY_LIMIT",
  );
  requireRule(
    config.channels.length > 0 &&
      config.channels.every((c) => ["sms", "whatsapp"].includes(c)),
    "Invalid OTP_CHANNELS",
  );
  if (provider === "twilio") {
    config.twilio = {
      accountSid: required(env, "TWILIO_ACCOUNT_SID"),
      authToken: required(env, "TWILIO_AUTH_TOKEN"),
      serviceSid: required(env, "TWILIO_VERIFY_SERVICE_SID"),
    };
    requireRule(
      /^AC[0-9a-fA-F]{32}$/.test(config.twilio.accountSid),
      "Invalid Twilio Account SID",
    );
    requireRule(
      /^VA[0-9a-fA-F]{32}$/.test(config.twilio.serviceSid),
      "Invalid Verify Service SID",
    );
  }
  return config;
}
