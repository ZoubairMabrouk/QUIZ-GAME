# Quiz Game — étape 3 : WebSocket + Flutter

Administration : connexion par nom d'utilisateur/mot de passe et compte initial créé par migration. Voir [les identifiants locaux et les commandes](docs/ADMIN_AUTH.md). Les joueurs conservent la connexion téléphone/OTP.

Module compétition et back-office ajoutés : [installation, API, décisions et démo accélérée](docs/ETAPE_4_COMPETITIONS.md), [traçabilité F1–F11](docs/EXIGENCES_F1_F11.md). Le moteur persistant, les phases, les gains Golden et le parcours Flutter sont intégrés. Les cadeaux réels, paiements et autres écarts restent explicitement documentés.

Backend Node.js 24 avec PostgreSQL, Redis et connexion par numéro de téléphone + OTP SMS ou WhatsApp. Cette version reprend le moteur de jeu du lot 1 et rend les salles persistantes. Cette livraison ajoute le transport WebSocket authentifié et le parcours Flutter complet à deux joueurs (Web, sources Android et iOS). Voir `docs/ETAPE_3.md`.

## Démarrage local avec Docker Desktop

Dans le dossier extrait `quiz-game`, avec Node.js 24+ et Docker Compose :

```bash
node scripts/init-env.js
docker compose up --build -d
```

Le script crée `.env` avec des secrets locaux aléatoires et refuse d’écraser un fichier existant. Compose démarre PostgreSQL et Redis, applique les migrations, puis démarre l’API. Les volumes conservent les données après redémarrage. Pour consulter les journaux : `docker compose logs api migrate`. Arrêt sans suppression des données : `docker compose down`.

Vérifier http://127.0.0.1:3000/ready puis lancer :

```bash
npm run demo
```

Le mode local par défaut est explicitement `mock` : utiliser `+12025550123` ou `+12025550124` et le code `000000`. Aucun message n’est envoyé. Ces comptes restent `phoneVerified: false`. Un autre numéro est refusé. Le mode mock est interdit avec `NODE_ENV=production`.

## Activer les vrais SMS et WhatsApp

Créer un service **Twilio Verify**, puis renseigner uniquement dans le fichier local `.env` ou dans le gestionnaire de secrets du déploiement :

```dotenv
OTP_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_VERIFY_SERVICE_SID=VA...
OTP_CHANNELS=sms,whatsapp
OTP_ALLOWED_COUNTRIES=FR,TN,MA,DZ
```

Ne pas envoyer les secrets dans une conversation et ne pas les committer. Pour commencer par SMS seul, choisir `OTP_CHANNELS=sms`. Activer les pays concernés dans les paramètres du service Verify. WhatsApp nécessite l’expéditeur WhatsApp Business et le Messaging Service configurés dans l’onglet WhatsApp du service Verify ; voir `docs/OTP_SETUP.md`.

Après modification, recréer l’API pour relire l’environnement :

```bash
docker compose up -d --force-recreate api
npm run demo
```

Le script demande le numéro, le canal, le consentement et le code reçu. Un numéro n’est marqué vérifié qu’après une réponse `approved` de Twilio. La validation du format seule ne prouve pas qu’un numéro est actif ou appartient au joueur.

**Les identifiants fournisseur ne sont pas inclus. Aucun SMS ou WhatsApp réel n’a été envoyé pendant la réalisation.**

## Tester le code

```bash
npm ci
npm test
```

Pour tester avec les services Compose sur votre machine :

```bash
node --env-file=.env scripts/test-services.js
```

Cette commande utilise les URL locales de `.env`. Les tests PostgreSQL créent un schéma isolé puis le suppriment ; ils n’effacent pas les tables applicatives. Redis utilise un préfixe de test aléatoire et ne fait jamais de `FLUSHDB`. Aucun appel Twilio réel n’est effectué par les tests.

Autre option, sans serveur PostgreSQL mais avec un Redis de test accessible : définir `TEST_REDIS_URL`, puis `npm run test:embedded`. Cette suite utilise PGlite, moteur PostgreSQL embarqué, et ne valide pas la concurrence d’un serveur PostgreSQL multi-connexion. Le workflow CI exécute la suite standard avec PostgreSQL 17 et Redis 7 ; il est fourni, non exécuté sur GitHub dans cette livraison.

## Architecture et garanties

- PostgreSQL : comptes uniques par téléphone, sessions hachées, familles de sessions, portefeuille, ledger, parties JSONB et migrations versionnées.
- Redis : OTP expirant après 5 minutes, délai de renvoi de 60 secondes, verrous temporaires et quotas par numéro/IP/global.
- Sessions : accès 15 minutes, refresh 30 jours, rotation ; réutiliser un ancien refresh révoque sa famille de sessions.
- Ledger : transactions et verrous du compte, clés d’idempotence, aucune mutation UPDATE/DELETE autorisée par les triggers applicatifs.
- Parties : verrou de ligne PostgreSQL ; classement, écritures de récompense et sauvegarde de la partie dans une seule transaction.
- Les corrections de question ne sont exposées qu’après le délai serveur.
- Aucune route `/dev/sessions` dans le nouveau serveur.

Le code de l’étape 1 est conservé uniquement comme référence de tests (`src/sqlite-server.js`, `src/store.js`, `src/rooms.js`). Le serveur lancé par `npm start` utilise exclusivement PostgreSQL/Redis et OTP. Les sessions et comptes de développement SQLite ne sont pas importés : ils n’ont pas de téléphone vérifié.

## Exécution Node hors Docker

Démarrer les deux dépendances : `docker compose up -d postgres redis`. Puis :

```bash
npm ci
npm run migrate
npm start
```

Ne pas démarrer simultanément l’API Docker et l’API locale sur le même port.

## Limites de cette étape

WebSocket avec Redis Pub/Sub ; les manches sont clôturées par le serveur même sans consultation HTTP. Pas encore d’orchestration quotidienne. Cinq questions de développement. Pas de mesure de charge, d’audit de sécurité ni de certification de conformité.

Le Compose est destiné au développement, exposé sur loopback. Avant exposition publique : TLS, rôles PostgreSQL distincts pour migration/API, permissions minimales, secrets gérés, limites au reverse proxy, sauvegardes, supervision et tests de charge. Ne pas faire confiance arbitrairement à `X-Forwarded-For` : l’application l’ignore actuellement. Voir `docs/ARCHITECTURE_V2.md` pour les limites opérationnelles et les décisions de sécurité.
