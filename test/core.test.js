import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { Rooms } from "../src/rooms.js";
import { scoreAnswer, advanceCompetition } from "../src/rules.js";
const score = (x = {}) =>
  scoreAnswer({
    correct: true,
    difficulty: 2,
    elapsedMs: 5000,
    durationMs: 10000,
    ...x,
  });
test("score formula, streak cap, wrong answers and exclusive deadline", () => {
  assert.equal(score().points, 225);
  assert.equal(score({ previousStreak: 1 }).points, 248);
  assert.equal(score({ previousStreak: 20 }).points, 338);
  assert.deepEqual(score({ correct: false }), { points: 0, streak: 0 });
  assert.equal(score({ elapsedMs: 10000 }).points, 0);
  assert.throws(() => score({ elapsedMs: -1 }));
  assert.throws(() => score({ difficulty: 6 }));
});
const players = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    correct: true,
    responseMs: 100 + i,
    cumulativeMs: 100 + i,
    receivedAt: 100 + i,
  }));
test("competition keeps fastest 90 percent of correct players", () => {
  const p = players(100);
  p[0].correct = false;
  const r = advanceCompetition({ players: p, initialCount: 100 });
  assert.equal(r.survivors.length, 90);
  assert.equal(r.survivors[0], "p1");
  assert.equal(r.eliminated.length, 10);
});
test("competition handles ceiling stall, all wrong, phase transition and final elimination", () => {
  assert.equal(
    advanceCompetition({ players: players(9), initialCount: 9 }).stalled,
    true,
  );
  assert.equal(
    advanceCompetition({
      players: players(5).map((p) => ({ ...p, correct: false })),
      initialCount: 100,
    }).replay,
    true,
  );
  assert.equal(
    advanceCompetition({ players: players(5), initialCount: 100 }).phase,
    2,
  );
  assert.equal(
    advanceCompetition({ players: players(2), initialCount: 100, phase: 2 })
      .survivors.length,
    1,
  );
  assert.throws(() =>
    advanceCompetition({
      players: [...players(1), ...players(1)],
      initialCount: 2,
    }),
  );
});
test("ledger persists, replays once, rejects conflicts, overdrafts and mutation", () => {
  const dir = mkdtempSync(join(tmpdir(), "quiz-"));
  let store = new Store(join(dir, "db"));
  const u = store.createUser("Alice");
  const entry = {
    userId: u.id,
    amount: 20,
    reason: "room_reward",
    refId: "room1",
    key: "r1",
  };
  try {
    assert.equal(store.post(entry).id, store.post(entry).id);
    assert.equal(store.balance(u.id), 20);
    assert.throws(() => store.post({ ...entry, amount: 21 }), /conflict/);
    assert.throws(
      () =>
        store.post({ ...entry, amount: -30, reason: "entry", key: "debit" }),
      /Insufficient/,
    );
    assert.equal(store.balance(u.id), 20);
    assert.throws(
      () => store.db.exec("UPDATE ledger SET amount=99"),
      /Immutable/,
    );
    assert.throws(() => store.db.exec("DELETE FROM ledger"), /Immutable/);
    store.close();
    store = new Store(join(dir, "db"));
    assert.equal(store.balance(u.id), 20);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
test("daily cap cannot be bypassed; next UTC day resets allowance", () => {
  const s = new Store();
  try {
    const u = s.createUser("Bob");
    const e = {
      userId: u.id,
      amount: 20,
      reason: "room_reward",
      refId: "room",
      key: "0",
    };
    for (let i = 0; i < 5; i++) s.post({ ...e, key: String(i) }, 1000);
    assert.throws(() => s.post({ ...e, key: "six" }, 1000), /cap/);
    s.post({ ...e, key: "next" }, 86400001);
    assert.equal(s.balance(u.id), 120);
  } finally {
    s.close();
  }
});
test("room guards, hidden answers, server timing, deadline and idempotent rewards", () => {
  const s = new Store();
  let now = 0;
  const rs = new Rooms(s, () => now);
  try {
    const a = s.createUser("Alice"),
      b = s.createUser("Bobby"),
      c = s.createUser("Carol");
    const { code } = rs.create(a, { questionCount: 1, durationMs: 1000 });
    assert.throws(() => rs.start(a, code), /ready/);
    assert.throws(() => rs.state(c, code), /membership/);
    rs.join(b, code);
    rs.ready(a, code, true);
    rs.ready(b, code, true);
    assert.throws(() => rs.start(b, code), /Host/);
    const state = rs.start(a, code);
    assert.equal(state.correctIndex, undefined);
    assert.equal(state.question.correctIndex, undefined);
    const q = rs.get(code).questions[0];
    now = 200;
    rs.answer(a, code, { questionId: q.id, choice: q.correctIndex });
    assert.throws(
      () => rs.answer(a, code, { questionId: q.id, choice: 0 }),
      /Already/,
    );
    assert.equal(rs.state(a, code).ranking[0].score, 0);
    assert.equal(rs.state(a, code).correctIndex, undefined);
    now = 1000;
    assert.throws(
      () => rs.answer(b, code, { questionId: q.id, choice: q.correctIndex }),
      /closed/,
    );
    const end = rs.state(a, code);
    assert.equal(end.status, "finished");
    assert.equal(end.ranking[0].id, a.id);
    assert.equal(s.balance(a.id), 20);
    rs.state(a, code);
    assert.equal(s.entries(a.id).length, 1);
  } finally {
    s.close();
  }
});
test("multiple rounds reset answers and allow only host advance after deadline", () => {
  const s = new Store();
  let now = 0;
  const rs = new Rooms(s, () => now);
  try {
    const a = s.createUser("Alpha"),
      b = s.createUser("Bravo");
    const { code } = rs.create(a, { questionCount: 2, durationMs: 1000 });
    rs.join(b, code);
    for (const u of [a, b]) rs.ready(u, code, true);
    rs.start(a, code);
    assert.throws(() => rs.advance(a, code), /not ready/);
    const first = rs.get(code).questions[0];
    now = 500;
    rs.answer(a, code, { questionId: first.id, choice: first.correctIndex });
    now = 1000;
    assert.equal(rs.state(a, code).status, "results");
    assert.equal(s.balance(a.id), 0);
    assert.throws(() => rs.advance(b, code), /Host/);
    const second = rs.advance(a, code);
    assert.equal(second.answered, false);
    assert.throws(
      () => rs.answer(a, code, { questionId: first.id, choice: 0 }),
      /Stale/,
    );
    now = 2000;
    assert.equal(rs.state(a, code).status, "finished");
    assert.equal(s.entries(a.id).length, 1);
  } finally {
    s.close();
  }
});
