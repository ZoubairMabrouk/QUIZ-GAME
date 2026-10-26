import { spawnSync } from "node:child_process";
if (!process.env.DATABASE_URL || !process.env.REDIS_URL)
  throw new Error("Run with node --env-file=.env scripts/test-services.js");
const r = spawnSync(
  process.execPath,
  ["--test", "test/integration/services.test.js", "test/integration/realtime.test.js", "test/integration/competitions.test.js"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      TEST_DATABASE_URL: process.env.DATABASE_URL,
      TEST_REDIS_URL: process.env.REDIS_URL,
    },
  },
);
process.exit(r.status ?? 1);
