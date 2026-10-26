# Traçabilité F1–F11 — cahier du 22 octobre 2026

Lecture du DOCX fourni, mise à jour le 23 octobre 2026. « Partiel » signifie que le module ne satisfait pas encore tous ses sous-points ; un test isolé ne vaut pas recette intégrée. Les preuves ci-dessous sont les fichiers de test réellement exécutés (rapport `VALIDATION_COMPETITIONS.md`).

Mise à jour du 24 octobre : F11 inclut désormais une connexion administrateur par nom d'utilisateur/mot de passe et le compte initial demandé en migration 005. Les joueurs F1 conservent l'OTP. Voir [ADMIN_AUTH.md](ADMIN_AUTH.md) pour les sessions séparées, le changement de mot de passe et les validations.

| Exigence | État | Implémentation et preuves | Manques / dépendances |
|---|---|---|---|
| F1 Comptes/profil | Partiel | auth.js, postgres.js, Flutter ; auth.test.js, scenarios.js | F1.2 avatar/pays/langue/stats/badges, F1.3 amis/QR, F1.4 export/suppression, F1.5 âge. F1.1 : OTP téléphone prioritaire utilisateur, pas de contournement email/social. Twilio réel externe. |
| F2 Catalogue | Partiel | editorial.js, csv-questions.js, migrations 003 ; csv.test.js, competition-scenarios.js, engine-scenarios.js | F2.1–2 et F2.4 fournis pour QCM ; F2.3 ultérieur. F2.5 statistiques des réponses soumises en compétition uniquement. F2.6 fenêtre entre compétitions, pas encore historique personnel toutes salles/modes ; médias absents. |
| F3 Salles amicales | Partiel | durable-rooms.js, realtime.js, main.dart ; core.test.js, realtime-scenarios.js, widgets | F3.4–7 parcours intégré, F3.8 reconnexion fournie ; nom/catégorie/visibilité complets, lien/QR, expulsion, politique hôte, revanche/historique et plafond administrable à compléter. Score/correction différés pour empêcher la fuite. |
| F4 Contenu utilisateur | Absent / décision métier | Aucun parcours utilisateur intégré | Sous-catégories, banques privées/publiques, modération, signalements et notes absents. Récompenses de contenu utilisateur désactivées. |
| F5 Compétition | Partiel, parcours tokens intégré | competitions.js, competition-engine.js, competition-rules.js, migrations 002–004, Flutter play/leaderboards ; scénarios natifs et WebSocket, dont 40 inscrits/deux phases | F5.1–2, F5.4–5, F5.9–11 fournis pour tokens. F5.3 rappels absents. F5.6 et F5.8 : Golden configurables, cadeaux réels externes désactivés. Restriction appareil unique non implémentée ; charge, présence réseau et cadence quotidienne récurrente à compléter. |
| F6 Économie | Partiel | postgres.js, administration.js ; scenarios.js, engine-scenarios.js | F6.3 ledger, F6.6 remboursements et ajustements audités fournis. Bonus quotidien, solo/duels, plafonds administrables, réconciliation automatisée et publicité restent à faire. F6.2 Golden non achetables, échange en attente. |
| F7 Store/paiements | Dépendance externe / absent | Aucun achat réussi simulé | Fournisseurs, reçus, signatures, remboursements, factures à intégrer en sandbox avant activation. |
| F8 Publicité | Dépendance externe / absent | Aucun crédit publicitaire exposé | SDK, validation serveur, quotas, CMP et politique mineurs requis ; aucune pub ajoutée pendant les manches. |
| F9 Cadeaux | Dépendance externe / décision métier | Paramètres cadeaux réels explicitement refusés | Catalogue, stocks, réservations, identité/âge, partenaires, réclamation et expiration absents ; pas de conformité juridique revendiquée. |
| F10 Notifications/social/support | Absent | Aucun centre ni adaptateur activé | FCM/APNs/email, centre in-app, rappels persistants, invitations, support et signalements à intégrer. |
| F11 Administration | Partiel, back-office utilisable | admin/ React TypeScript, administration.js, editorial.js, grant-admin.js ; compilation TypeScript/Vite et tests d'autorisation HTTP | Questions, compétitions, audit/ledger, liste utilisateurs et ajustements fournis. Sanctions, modération UGC, cadeaux, publicité, KPI et tests navigateur complets restent à faire. |

## Ordre de poursuite

1. Durcir M5 : tests de processus tué/reprise réelle (au-delà de l'injection transactionnelle), attestation appareil, arbitrage précis de présence/reconnexion, mesures du fan-out et des transactions, cadence récurrente et rappels.
2. Finaliser F2/F3 : anti-répétition personnelle, catalogue des salles, gestion hôte, invitation/QR, historique et revanche, plafonds administrables.
3. F1/F4/F10 : profil/social, export/suppression et conservation du ledger, âge, langues/traductions, banques et modération, centre et adaptateurs de notifications.
4. F6/F9 : bonus quotidien, réconciliation et historique paginé côté joueur, cadeaux avec stocks/éligibilité/remise.
5. F7/F8 : contrats fournisseurs, sandbox, vérification des reçus et signatures, limites et activation seulement après validation.

Les recommandations d'architecture du document ne justifient pas une réécriture du backend ESM fonctionnel. Les objectifs de performance, disponibilité, sécurité, conformité et publication sont des critères à vérifier, pas des résultats acquis.
