import { createInterface } from "node:readline/promises";
const input = createInterface({ input: process.stdin, output: process.stdout });
const base = process.env.API_URL ?? "http://127.0.0.1:3000";
async function api(path, body, token) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}
try {
  const phone = (
    await input.question(
      "Votre numéro international (test local : +12025550123) : ",
    )
  ).trim();
  const channel =
    (await input.question("Canal sms ou whatsapp [sms] : ")).trim() || "sms";
  const consent =
    (
      await input.question(
        `Envoyer un code par ${channel} à ce numéro ? [oui/non] : `,
      )
    )
      .trim()
      .toLowerCase() === "oui";
  if (!consent) throw new Error("Envoi annulé");
  const challenge = await api("/auth/otp/request", { phone, channel, consent });
  const code = (
    await input.question("Code reçu (mode mock uniquement : 000000) : ")
  ).trim();
  const session = await api("/auth/otp/verify", {
    challengeId: challenge.challengeId,
    code,
  });
  console.log("Connexion réussie :", session.user);
  console.log(
    "Portefeuille :",
    await api("/wallet", null, session.accessToken),
  );
  await api("/auth/logout", {}, session.accessToken);
  console.log("Déconnexion réussie. Aucun jeton enregistré par ce script.");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  input.close();
}
