import { randomInt, randomUUID } from "node:crypto";
import { requireRule, integer, scoreAnswer } from "./rules.js";
import { questions, publicQuestion } from "./catalog.js";
export class Rooms {
  constructor(store, clock = () => performance.now()) {
    this.store = store;
    this.clock = clock;
    this.rooms = new Map();
  }
  create(user, { questionCount = 3, durationMs = 10000, maxPlayers = 8 } = {}) {
    integer(questionCount, 1, questions.length, "questionCount");
    integer(durationMs, 1000, 60000, "durationMs");
    integer(maxPlayers, 2, 50, "maxPlayers");
    requireRule(this.rooms.size < 1000, "Room capacity reached", 503);
    let code;
    do {
      code = Array.from(
        { length: 6 },
        () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(31)],
      ).join("");
    } while (this.rooms.has(code));
    const pool = [...questions];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const room = {
      id: randomUUID(),
      code,
      hostId: user.id,
      status: "lobby",
      durationMs,
      maxPlayers,
      questions: pool.slice(0, questionCount),
      index: -1,
      players: new Map(),
      answers: new Map(),
      rewards: [],
    };
    this.rooms.set(code, room);
    this.join(user, code);
    return this.state(user, code);
  }
  get(code) {
    const r = this.rooms.get(code);
    requireRule(r, "Room not found", 404);
    return r;
  }
  member(user, code) {
    const r = this.get(code);
    requireRule(r.players.has(user.id), "Room membership required", 403);
    return r;
  }
  join(user, code) {
    const r = this.get(code);
    if (r.players.has(user.id)) return this.state(user, code);
    requireRule(r.status === "lobby", "Room already started", 409);
    requireRule(r.players.size < r.maxPlayers, "Room full", 409);
    r.players.set(user.id, {
      ...user,
      ready: false,
      score: 0,
      streak: 0,
      totalMs: 0,
    });
    return this.state(user, code);
  }
  ready(user, code, ready) {
    requireRule(typeof ready === "boolean", "Invalid ready");
    const r = this.member(user, code);
    requireRule(r.status === "lobby", "Not in lobby", 409);
    r.players.get(user.id).ready = ready;
    return this.state(user, code);
  }
  start(user, code) {
    const r = this.member(user, code);
    requireRule(r.hostId === user.id, "Host only", 403);
    requireRule(r.status === "lobby", "Already started", 409);
    requireRule(
      r.players.size >= 2 && [...r.players.values()].every((p) => p.ready),
      "At least two ready players required",
      409,
    );
    this.next(r);
    return this.state(user, code);
  }
  next(r) {
    r.index++;
    r.status = "question";
    r.started = this.clock();
    r.answers = new Map();
  }
  answer(user, code, { questionId, choice }) {
    const r = this.member(user, code);
    this.tick(r);
    requireRule(r.status === "question", "Question closed", 409);
    requireRule(r.questions[r.index].id === questionId, "Stale question", 409);
    integer(choice, 0, 3, "choice");
    requireRule(!r.answers.has(user.id), "Already answered", 409);
    const elapsedMs = this.clock() - r.started;
    requireRule(elapsedMs < r.durationMs, "Question closed", 409);
    r.answers.set(user.id, { choice, elapsedMs });
    // Never reveal correctness/score until the deadline, even if all players answered.
    return { accepted: true, questionId };
  }
  tick(r) {
    if (r.status !== "question" || this.clock() - r.started < r.durationMs)
      return;
    const q = r.questions[r.index];
    for (const p of r.players.values()) {
      const a = r.answers.get(p.id);
      const result = scoreAnswer({
        correct: a?.choice === q.correctIndex,
        difficulty: q.difficulty,
        elapsedMs: a?.elapsedMs ?? r.durationMs,
        durationMs: r.durationMs,
        previousStreak: p.streak,
      });
      p.score += result.points;
      p.streak = result.streak;
      p.totalMs += a?.elapsedMs ?? r.durationMs;
    }
    r.status = "results";
    if (r.index === r.questions.length - 1) {
      r.status = "finished";
      this.reward(r);
    }
  }
  ranking(r) {
    return [...r.players.values()]
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.totalMs - b.totalMs ||
          a.id.localeCompare(b.id),
      )
      .map((p, i) => ({
        id: p.id,
        pseudo: p.pseudo,
        score: p.score,
        rank: i + 1,
      }));
  }
  reward(r) {
    for (const p of this.ranking(r)) {
      const amount = [20, 12, 8][p.rank - 1] ?? 3;
      try {
        this.store.post({
          userId: p.id,
          amount,
          reason: "room_reward",
          refId: r.id,
          key: `room:${r.id}:${p.id}`,
        });
        r.rewards.push({ userId: p.id, amount });
      } catch (e) {
        if (e.message === "Daily room reward cap reached")
          r.rewards.push({ userId: p.id, amount: 0, reason: "daily_cap" });
        else throw e;
      }
    }
  }
  advance(user, code) {
    const r = this.member(user, code);
    requireRule(r.hostId === user.id, "Host only", 403);
    this.tick(r);
    requireRule(r.status === "results", "Round not ready to advance", 409);
    this.next(r);
    return this.state(user, code);
  }
  state(user, code) {
    const r = this.member(user, code);
    this.tick(r);
    const q = r.questions[r.index];
    return {
      code: r.code,
      hostId: r.hostId,
      status: r.status,
      questionNumber: r.index + 1,
      questionCount: r.questions.length,
      durationMs: r.durationMs,
      remainingMs:
        r.status === "question"
          ? Math.max(0, Math.ceil(r.durationMs - (this.clock() - r.started)))
          : 0,
      players: [...r.players.values()].map(({ id, pseudo, ready }) => ({
        id,
        pseudo,
        ready,
      })),
      ranking: this.ranking(r),
      answered: r.answers.has(user.id),
      question: q ? publicQuestion(q) : null,
      ...(["results", "finished"].includes(r.status)
        ? { correctIndex: q.correctIndex, explanation: q.explanation }
        : {}),
      ...(r.status === "finished" ? { rewards: r.rewards } : {}),
    };
  }
}
