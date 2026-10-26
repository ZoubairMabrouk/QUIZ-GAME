import { randomInt, randomUUID } from "node:crypto";
import { questions, publicQuestion } from "./catalog.js";
import { integer, requireRule, scoreAnswer } from "./rules.js";
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export class DurableRooms {
  constructor(store) {
    this.store = store;
  }
  async now(c) {
    return Number(
      (await c.query("SELECT EXTRACT(EPOCH FROM clock_timestamp())*1000 AS ms"))
        .rows[0].ms,
    );
  }
  async create(
    user,
    { questionCount = 3, durationMs = 10000, maxPlayers = 8 } = {},
  ) {
    integer(questionCount, 1, questions.length, "questionCount");
    integer(durationMs, 1000, 60000, "durationMs");
    integer(maxPlayers, 2, 50, "maxPlayers");
    const pool = structuredClone(questions);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Array.from(
        { length: 6 },
        () => alphabet[randomInt(alphabet.length)],
      ).join("");
      const room = {
        id: randomUUID(),
        code,
        hostId: user.id,
        status: "lobby",
        durationMs,
        maxPlayers,
        index: -1,
        revision: 0,
        questions: pool.slice(0, questionCount),
        players: [this.player(user)],
        answers: {},
        rewards: [],
      };
      const { rowCount } = await this.store.pool.query(
        "INSERT INTO rooms(id,code,state) VALUES($1,$2,$3) ON CONFLICT(code) DO NOTHING",
        [room.id, code, room],
      );
      if (rowCount) return this.view(room, user, 0);
    }
    requireRule(false, "Room code allocation failed", 503);
  }
  player(user) {
    return {
      id: user.id,
      pseudo: user.pseudo,
      ready: false,
      score: 0,
      streak: 0,
      totalMs: 0,
    };
  }
  async execute(user, code, action, body = {}) {
    return this.store.transaction(async (c) => {
      const {
        rows: [row],
      } = await c.query("SELECT state FROM rooms WHERE code=$1 FOR UPDATE", [
        code,
      ]);
      requireRule(row, "Room not found", 404);
      const r = row.state;
      const now = await this.now(c);
      const member = r.players.find((p) => p.id === user.id);
      requireRule(member || action === "join", "Room membership required", 403);
      await this.tick(c, r, now);
      let accepted;
      if (action === "join" && !member) {
        requireRule(r.status === "lobby", "Room already started", 409);
        requireRule(r.players.length < r.maxPlayers, "Room full", 409);
        r.players.push(this.player(user));
      } else if (action === "ready") {
        requireRule(r.status === "lobby", "Not in lobby", 409);
        requireRule(typeof body.ready === "boolean", "Invalid ready");
        member.ready = body.ready;
      } else if (action === "start") {
        this.host(r, user);
        requireRule(r.status === "lobby", "Already started", 409);
        requireRule(
          r.players.length >= 2 && r.players.every((p) => p.ready),
          "At least two ready players required",
          409,
        );
        this.next(r, now);
      } else if (action === "answers") {
        requireRule(r.status === "question", "Question closed", 409);
        requireRule(
          r.questions[r.index].id === body.questionId,
          "Stale question",
          409,
        );
        integer(body.choice, 0, 3, "choice");
        requireRule(!r.answers[user.id], "Already answered", 409);
        r.answers[user.id] = {
          choice: body.choice,
          elapsedMs: Math.max(0, now - r.startedAt),
        };
        accepted = { accepted: true, questionId: body.questionId };
      } else if (action === "next") {
        this.host(r, user);
        requireRule(r.status === "results", "Round not ready to advance", 409);
        this.next(r, now);
      }
      r.revision=(r.revision??0)+1;
      await c.query(
        "UPDATE rooms SET state=$1,updated_at=now() WHERE code=$2",
        [r, code],
      );
      return accepted ?? this.view(r, user, now);
    });
  }
  async snapshot(user,code) {
    const {rows:[row]}=await this.store.pool.query("SELECT state,EXTRACT(EPOCH FROM clock_timestamp())*1000 AS ms FROM rooms WHERE code=$1",[code]);
    requireRule(row,'Room not found',404);requireRule(row.state.players.some(p=>p.id===user.id),'Room membership required',403);
    return this.view(row.state,user,Number(row.ms));
  }
  async settle(code) {
    return this.store.transaction(async c=>{
      const {rows:[row]}=await c.query('SELECT state FROM rooms WHERE code=$1 FOR UPDATE',[code]);
      if(!row)return false;const r=row.state,previous=r.status;await this.tick(c,r,await this.now(c));
      if(r.status===previous)return false;r.revision=(r.revision??0)+1;
      await c.query('UPDATE rooms SET state=$1,updated_at=now() WHERE code=$2',[r,code]);return true;
    });
  }
  host(r, user) {
    requireRule(r.hostId === user.id, "Host only", 403);
  }
  next(r, now) {
    r.index++;
    r.status = "question";
    r.startedAt = now;
    r.answers = {};
  }
  ranking(r) {
    return [...r.players]
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
  async tick(c, r, now) {
    if (r.status !== "question" || now < r.startedAt + r.durationMs) return;
    const q = r.questions[r.index];
    for (const p of r.players) {
      const a = r.answers[p.id];
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
    r.status = r.index === r.questions.length - 1 ? "finished" : "results";
    if (r.status === "finished") {
      // Consistent wallet lock order avoids deadlocks for overlapping player groups.
      for (const p of this.ranking(r).sort((a, b) =>
        a.id.localeCompare(b.id),
      )) {
        const entry = await this.store.post(c, {
          userId: p.id,
          amount: [20, 12, 8][p.rank - 1] ?? 3,
          reason: "room_reward",
          refId: r.id,
          key: `room:${r.id}:${p.id}`,
        });
        r.rewards.push({
          userId: p.id,
          amount: entry.amount,
          ...(entry.amount === 0 ? { reason: "daily_cap" } : {}),
        });
      }
    }
  }
  view(r, user, now) {
    const q = r.questions[r.index];
    return {
      code: r.code,
      revision: r.revision??0,
      selectedChoice: r.answers[user.id]?.choice??null,
      hostId: r.hostId,
      status: r.status,
      questionNumber: r.index + 1,
      questionCount: r.questions.length,
      durationMs: r.durationMs,
      serverTime: now,
      remainingMs:
        r.status === "question"
          ? Math.max(0, Math.ceil(r.startedAt + r.durationMs - now))
          : 0,
      players: r.players.map(({ id, pseudo, ready }) => ({
        id,
        pseudo,
        ready,
      })),
      ranking: this.ranking(r),
      answered: !!r.answers[user.id],
      question: q ? publicQuestion(q) : null,
      ...(["results", "finished"].includes(r.status)
        ? { correctIndex: q.correctIndex, explanation: q.explanation }
        : {}),
      ...(r.status === "finished" ? { rewards: r.rewards } : {}),
    };
  }
}
