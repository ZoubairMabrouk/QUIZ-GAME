import { PostgresStore } from "../src/postgres.js";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const store = PostgresStore.connect(process.env.DATABASE_URL);
try {
  await store.migrate();
  console.log("Migrations applied");
} finally {
  await store.close();
}
