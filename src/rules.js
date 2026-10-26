export class RuleError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function requireRule(condition, message, status = 400) {
  if (!condition) throw new RuleError(message, status);
}
export function integer(value, min, max, label) {
  requireRule(
    Number.isSafeInteger(value) && value >= min && value <= max,
    `Invalid ${label}`,
  );
  return value;
}
// The first correct answer starts a streak; the second receives +10%.
// Deadline is exclusive. Round only the final score to the nearest integer.
export function scoreAnswer({
  correct,
  difficulty,
  elapsedMs,
  durationMs,
  previousStreak = 0,
}) {
  integer(difficulty, 1, 5, "difficulty");
  integer(durationMs, 1, 120000, "duration");
  integer(previousStreak, 0, Number.MAX_SAFE_INTEGER, "streak");
  requireRule(
    Number.isFinite(elapsedMs) && elapsedMs >= 0,
    "Invalid elapsed time",
  );
  if (!correct || elapsedMs >= durationMs) return { points: 0, streak: 0 };
  return {
    points: Math.round(
      (100 * difficulty + 50 * (1 - elapsedMs / durationMs)) *
        (1 + Math.min(previousStreak, 5) / 10),
    ),
    streak: previousStreak + 1,
  };
}
// Inputs are authoritative server records, never client-supplied timings.
export function advanceCompetition({ players, initialCount, phase = 1 }) {
  integer(initialCount, 1, 1000000, "initialCount");
  requireRule([1, 2].includes(phase), "Invalid phase");
  requireRule(
    Array.isArray(players) &&
      players.length > 0 &&
      players.length <= initialCount,
    "Invalid players",
  );
  requireRule(
    new Set(players.map((p) => p.id)).size === players.length,
    "Duplicate player",
  );
  for (const p of players) {
    requireRule(
      typeof p.id === "string" && p.id.length > 0,
      "Invalid player ID",
    );
    requireRule(typeof p.correct === "boolean", "Invalid correctness");
    for (const k of ["responseMs", "cumulativeMs", "receivedAt"]) {
      requireRule(Number.isFinite(p[k]) && p[k] >= 0, `Invalid ${k}`);
    }
  }
  const compare = (a, b) =>
    a.responseMs - b.responseMs ||
    a.cumulativeMs - b.cumulativeMs ||
    a.receivedAt - b.receivedAt ||
    a.id.localeCompare(b.id);
  const correct = players.filter((p) => p.correct).sort(compare);
  // Explicit supported fallback from specification: replay if everyone is wrong.
  if (!correct.length)
    return {
      survivors: players.map((p) => p.id),
      eliminated: [],
      phase,
      replay: true,
      stalled: true,
    };
  const count =
    phase === 1
      ? Math.ceil(correct.length * 0.9)
      : Math.max(1, Math.min(correct.length, players.length - 1));
  const survivors = correct.slice(0, count).map((p) => p.id);
  return {
    survivors,
    eliminated: players
      .filter((p) => !survivors.includes(p.id))
      .map((p) => p.id),
    phase: survivors.length <= initialCount * 0.05 ? 2 : phase,
    replay: false,
    stalled: survivors.length === players.length,
  };
}
