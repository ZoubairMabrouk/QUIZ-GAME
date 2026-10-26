# Étape 3 — parcours Flutter et temps réel

## Lancer deux joueurs

1. À la racine : `node scripts/init-env.js`, puis `docker compose up --build -d`. Si `.env` existe déjà, le conserver. Vérifier `ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`.
2. Avec Flutter installé :

```bash
cd client
flutter pub get
flutter run -d chrome --web-port 5173 --dart-define=API_URL=http://localhost:3000
```

3. Ouvrir deux onglets sur le même client. En mode mock uniquement : joueur A `+12025550123`, joueur B `+12025550124`, code `000000`. La bannière indique explicitement qu'aucun SMS n'est envoyé.
4. Renseigner les pseudos, créer une salle avec A, copier son code et la rejoindre avec B. Les deux joueurs se déclarent prêts ; A lance la partie.
5. Chacun répond avant la fin du compte à rebours. Le serveur révèle ensuite la correction et les scores. A passe à la question suivante ; la dernière manche mène au classement final et au portefeuille crédité.

La configuration Twilio de l'étape 2 reste nécessaire pour les vrais numéros et les vrais SMS/WhatsApp. Les jetons sont conservés en mémoire : fermer/recharger l'application demande une nouvelle connexion OTP. Une interruption réseau dans l'application ouverte déclenche une reconnexion et restaure la réponse déjà enregistrée. Une requête de réponse ambiguë n'est pas rejouée automatiquement.

## Transport et cohérence

Les commandes passent par l'API HTTP authentifiée ; les changements de salle sont poussés par WebSocket `/ws`. Le premier message doit authentifier la connexion dans les cinq secondes :

```json
{"type":"auth","accessToken":"JETON_ACCES"}
```

Après `authenticated`, le client envoie `{"type":"subscribe","code":"ABC234"}`. Le serveur répond avec `{"v":1,"type":"room.state","state":{}}` où `state` contient la vue complète de la salle. Autres messages : `unsubscribe` et `ping` (avec `clientTime`) ; réponses `unsubscribed`, `pong` et `error` (`status`, `message`). Le jeton n'apparaît jamais dans l'URL.

Chaque vue contient une révision croissante, l'heure serveur, le délai restant et seulement la réponse personnelle du joueur. Les corrections restent masquées pendant la question. L'appartenance à la salle et la session sont vérifiées ; les origines Web sont limitées par `ALLOWED_ORIGINS`.

Redis Pub/Sub transmet les codes de salles entre instances. Chaque instance construit ensuite les vues personnalisées de ses abonnés. Un balayage toutes les 250 ms clôture les questions arrivées à échéance sous verrou PostgreSQL. L'écriture des récompenses et la clôture restent atomiques et idempotentes. Une resynchronisation toutes les cinq secondes répare les notifications perdues. Le compte à rebours Flutter est indicatif ; seul le serveur décide si une réponse est acceptée.

## Plateformes et tests

Sources Web, Android et iOS incluses. Pour l'émulateur Android, lancer en debug avec `--dart-define=API_URL=http://10.0.2.2:3000`. Le HTTP local est autorisé uniquement dans le manifeste Android debug. Pour une version distribuée, configurer une API HTTPS/WSS accessible, l'origine Web exacte et le reverse proxy qui transmet l'upgrade WebSocket. L'app iOS utilise la politique réseau sécurisée par défaut ; utiliser HTTPS pour l'API. Les signatures, certificats et magasins d'applications ne sont pas configurés.

```bash
# Backend
npm ci
npm test
# Avec PostgreSQL et Redis locaux :
node --env-file=.env scripts/test-services.js
# Ou PostgreSQL embarqué + Redis de test :
TEST_REDIS_URL=redis://127.0.0.1:6379 npm run test:embedded
# Flutter
cd client
flutter analyze
flutter test
flutter build web --no-web-resources-cdn --dart-define=API_URL=http://127.0.0.1:3000
```

Un scénario navigateur est fourni dans `test/browser/two-player.mjs`. Après compilation Web : installer Chromium via `npx playwright install chromium`, puis exécuter `TEST_REDIS_URL=redis://127.0.0.1:6379 npm run test:browser`. Il démarre une API de test PGlite sur 3000 et sert le client sur 5173 ; ces ports doivent être libres. Il utilise deux contextes, trois manches et une interruption réseau. Ce scénario ne remplace pas les tests sur deux appareils physiques.

## Périmètre restant

Pas encore de matchmaking, invitation par notification, reprise automatique après fermeture de l'application, gestion du départ de l'hôte, orchestration quotidienne ni banque de questions de production. Les parties sont manuelles et la banque de développement contient cinq questions. Aucun déploiement public ni envoi OTP réel n'a été effectué. Tester PostgreSQL natif, les builds mobiles et les conditions réseau réelles avant diffusion.
