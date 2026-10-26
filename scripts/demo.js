// Run against `npm start` in another terminal. Creates two disposable local accounts.
const base = process.env.API_URL ?? "http://127.0.0.1:3000";
const api = async (path, token, body) => {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data;
};
const suffix = Date.now().toString(36);
const a = await api("/dev/sessions", null, { pseudo: "Alice_" + suffix });
const b = await api("/dev/sessions", null, { pseudo: "Bob_" + suffix });
const room = await api("/rooms", a.token, {
  questionCount: 1,
  durationMs: 1000,
});
const root = "/rooms/" + room.code;
await api(root + "/join", b.token, {});
for (const u of [a, b]) await api(root + "/ready", u.token, { ready: true });
const state = await api(root + "/start", a.token, {});
console.log("Question:", state.question.text, state.question.choices);
for (const [i, u] of [a, b].entries())
  await api(root + "/answers", u.token, {
    questionId: state.question.id,
    choice: i,
  });
await new Promise((r) => setTimeout(r, 1100));
console.log("Résultat:", await api(root, a.token));
console.log("Portefeuille Alice:", await api("/wallet", a.token));
