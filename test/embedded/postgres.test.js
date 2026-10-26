import test from "node:test";
import { embeddedStore } from "../helpers/embedded-store.js";
import { scenarios } from "../helpers/scenarios.js";
test("PostgreSQL embedded engine + real Redis + HTTP (not a TCP PostgreSQL load test)", async (t) => {
  const store = await embeddedStore();
  try {
    await scenarios(t, store);
  } finally {
    await store.close();
  }
});
