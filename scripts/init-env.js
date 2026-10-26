import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const pg = randomBytes(24).toString("hex"),
  redis = randomBytes(24).toString("hex"),
  secret = randomBytes(32).toString("hex");
const content = `# Local development only. Never commit this file.
NODE_ENV=development
HOST=127.0.0.1
PORT=3000
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
POSTGRES_PASSWORD=${pg}
REDIS_PASSWORD=${redis}
DATABASE_URL=postgres://quiz:${pg}@127.0.0.1:55432/quiz
REDIS_URL=redis://:${redis}@127.0.0.1:56379
AUTH_HASH_SECRET=${secret}
OTP_PROVIDER=mock
OTP_CHANNELS=sms,whatsapp
OTP_ALLOWED_COUNTRIES=FR,TN,MA,DZ
OTP_GLOBAL_DAILY_LIMIT=1000
MOCK_OTP_PHONES=+12025550123,+12025550124
# Configure these only to activate real messages (OTP_PROVIDER=twilio):
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=
`;
try {
  writeFileSync(".env", content, { flag: "wx", mode: 0o600 });
  console.log(
    ".env created with random local secrets. Mock OTP only; code 000000.",
  );
} catch (e) {
  if (e.code === "EEXIST") {
    console.error(".env already exists; left unchanged.");
    process.exitCode = 1;
  } else throw e;
}
