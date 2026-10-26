import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/sqlite-server.js";
test("HTTP: auth, two-player game, answer redaction, reward and input errors", async () => {
  let now = 0;
  const { server, store, rooms } = createApp({ clock: () => now });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function api(path, { token, body, method } = {}) {
    const r = await fetch(base + path, {
      method: method ?? (body ? "POST" : "GET"),
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json() };
  }
  try {
    assert.equal((await api("/wallet")).status, 401);
    const a = (await api("/dev/sessions", { body: { pseudo: "Alice" } })).data;
    const b = (await api("/dev/sessions", { body: { pseudo: "Bobby" } })).data;
    assert.equal(
      (await api("/dev/sessions", { body: { pseudo: "alice" } })).status,
      409,
    );
    assert.equal(
      (await api("/rooms", { token: a.token, body: { durationMs: -1 } }))
        .status,
      400,
    );
    const room = (
      await api("/rooms", {
        token: a.token,
        body: { questionCount: 1, durationMs: 1000 },
      })
    ).data;
    const root = "/rooms/" + room.code;
    assert.equal((await api(root, { token: b.token })).status, 403);
    await api(root + "/join", { token: b.token, body: {} });
    for (const u of [a, b])
      await api(root + "/ready", { token: u.token, body: { ready: true } });
    const started = (await api(root + "/start", { token: a.token, body: {} }))
      .data;
    assert.equal(started.question.correctIndex, undefined);
    const q = rooms.get(room.code).questions[0];
    now = 200;
    const answer = (
      await api(root + "/answers", {
        token: a.token,
        body: { questionId: q.id, choice: q.correctIndex, elapsedMs: 0 },
      })
    ).data;
    assert.deepEqual(answer, { accepted: true, questionId: q.id });
    now = 1000;
    const end = (await api(root, { token: a.token })).data;
    assert.equal(end.status, "finished");
    assert.ok(end.ranking[0].score > 0);
    assert.equal((await api("/wallet", { token: a.token })).data.silver, 20);
    assert.equal((await api("/wallet", { token: b.token })).data.silver, 12);
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
  }
});
