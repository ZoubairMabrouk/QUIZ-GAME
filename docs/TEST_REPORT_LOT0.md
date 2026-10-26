# Validation du lot 0 — 26 octobre 2026

Réussis dans cette session :

- `npm test` : 18 tests.
- `npm run test:migrations` : 4 tests, moteur PostgreSQL embarqué PGlite, migrations et authentification, plus vrai HTTP avec adaptateur Redis de test.
- `node --test test/embedded/competitions.test.js` : 12 entrées dont 11 sous-tests ; inscription, remboursement, questions gelées, délais, phases et gains.
- `npm run build --prefix admin` : TypeScript et Vite.
- `node test/browser/admin-login.mjs` : navigateur Edge, API simulée.

Échoués pour dépendance indisponible :

- `node --env-file=.env scripts/test-services.js` : 3 scénarios refusés avant exécution fonctionnelle, ECONNREFUSED sur PostgreSQL 127.0.0.1:55432. La concurrence native, Redis et les scénarios multi-instance ne sont donc pas validés dans cette session.
- `docker compose ps` : moteur Docker inaccessible/absent ; aucun conteneur lancé et aucune migration appliquée à la base locale.

Non exécutés : suites Flutter, recette visuelle, mesures de fluidité sur appareil, tests navigateur joueur et suite embarquée complète nécessitant Redis.

Environnement : Node 22.13.1 présent, alors que package.json exige Node >=24. Les résultats locaux ne remplacent pas l'exécution sur la version requise. La CI utilise Node 24 et PostgreSQL/Redis natifs.

Périmètre livré : corrections du lot 0 et inventaire initial Flutter. Les lots 1 à 4 et la refonte Flutter ne sont pas livrés par ce correctif.
