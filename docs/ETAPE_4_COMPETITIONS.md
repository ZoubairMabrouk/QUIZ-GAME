# Compétitions et administration — 23 octobre 2026

> Mise à jour du 24 octobre : le back-office utilise désormais un nom d'utilisateur et un mot de passe, avec le compte initial demandé créé par migration. Voir [ADMIN_AUTH.md](ADMIN_AUTH.md). Les références OTP ci-dessous concernent les joueurs ; l'ancienne connexion OTP du back-office est remplacée.

Source désormais lue : `C:\Users\User\Desktop\Cahier des charges.docx`, version 1.0 du 22 octobre 2026. Extraction textuelle de référence : `CAHIER_DES_CHARGES_SOURCE.txt`. Le document est une spécification produit ; ses recommandations ne remplacent pas les décisions explicites de l'utilisateur. Le téléphone OTP reste obligatoire pour une authentification réelle malgré les alternatives proposées en F1.1.

## Fonctionnement livré

Migration additive `004_competition_engine.sql`. Les compétitions ne sont plus annulées automatiquement au départ. Le serveur passe aux phases de jeu et reprend depuis PostgreSQL après redémarrage. Chaque mutation verrouille la ligne compétition sur la connexion qui écrit ; aucune écriture d'un ancien propriétaire n'est effectuée après libération de cette connexion. Cette architecture privilégie la correction fonctionnelle ; elle n'est pas dimensionnée ni mesurée pour 20 000 ou 100 000 connexions.

Les réponses sont normalisées en tables, jamais dans un snapshot JSONB de tous les joueurs. Délais de dix secondes et chronométrage après acquisition du verrou, selon PostgreSQL. Une réponse est unique par compétition/question/joueur ; même choix rejoué = même accusé, choix différent = 409. HTTP et WebSocket utilisent la même méthode. Aucune correction avant clôture persistée.

Phase 1 : mauvaises réponses éliminées, `ceil(90 % des bonnes)` conservées, temps de réponse puis temps cumulé puis réception serveur. Une égalité exacte restante utilise le tirage reproductible. Tous faux : question suivante sans élimination, jusqu'au plafond. L'utilisateur a choisi de **conserver strictement les 90 % sans accélération**, puis départager au plafond.

`phaseOneLimit` (défaut `min(29, questionLimit)`) borne la première phase ; `questionLimit` borne toute la banque figée. Au plafond de phase 1, classement cumulé et tirage pour conserver `max(1, floor(5 % des inscrits))`. Ce minimum d'un finaliste pour moins de vingt inscrits est un choix technique explicite : le seuil littéral de 5 % ne permettrait aucun vainqueur. Il reste à valider pour les concours réels. Au plafond global, le vainqueur est déterminé par temps cumulé puis tirage. Une absence compte dix secondes dans le cumul.

Les survivants de phase 1 reçoivent `milestoneGolden` (défaut 1), puis l'état `PALIER_ATTEINT`, puis `PHASE_2`. En finale les mauvaises réponses sortent ; si tous sont justes, au moins le plus lent sort. Un seul survivant gagne `winnerGolden` (défaut 5). Chaque récompense, le classement et la transition sont dans la même transaction, avec clé ledger stable. Les Golden ne sont pas achetables. Aucun cadeau physique/forfait n'est activé.

Une manche ayant des réponses manquantes attend au maximum vingt-quatre secondes **après sa limite de réponse** avant clôture. Cela autorise la resynchronisation sans autoriser de réponse après les dix secondes. C'est une interprétation provisoire conservatrice de la tolérance de reconnexion ; il ne s'agit pas d'une détection réseau précise de chaque appareil. La présence `last_seen_at` est conservée pour inspection mais ne prolonge jamais le délai.

Le tirage utilise une graine aléatoire de 256 bits générée au départ. SHA-256 de la graine est exposé avant les réponses ; à la fin, la graine est révélée. À temps cumulé égal, trier par ordre lexicographique du SHA-256 UTF-8 de `graine + ':' + UUID`. L'engagement permet de vérifier le tirage ; il ne remplace pas un audit externe de l'équité de l'organisateur.

## Transport et reprise

Routes Bearer OTP existantes, préfixe `/v1` :

| Méthode et route | Usage |
|---|---|
| GET `/competitions` et `/competitions/:id` | Liste/historique et détail ; graine cachée |
| GET `/competitions/:id/play` | Vue personnelle : attente, question, réponse propre, correction après clôture, spectateur, rang, gains et résultat |
| POST `/competitions/:id/answers` | `{questionNo,choice}` avec choix 0–3 |
| GET `/leaderboards?period=all\|week\|month` | Hall of Fame et victoires dans la semaine/mois calendaire UTC |
| POST `/admin/competitions` | Paramètres existants + `phaseOneLimit`, `milestoneGolden`, `winnerGolden` |
| GET `/admin/catalog/statistics` | Réussite et temps moyen par question/version, réponses soumises dans les manches clôturées uniquement |
| POST `/admin/questions/import` | JSON existant ou `{format:"csv",csv:"..."}` |
| GET `/admin/audit`, `/admin/ledger`, `/admin/users` | Réservés administrateur ; pagination `?offset=0`, cent entrées |
| POST `/admin/wallet/adjustments` | `{userId,currency,amount,reason,key}` ; rôle, audit, idempotence et refus de découvert |

CSV : `category,language,difficulty,status,text,choice1,choice2,choice3,choice4,correctIndex,explanation,source`, colonne `development` optionnelle (`true/false`). Guillemets échappés, virgules et retours à la ligne dans les champs acceptés. Import refusé sans mutation si les validations échouent. Taille HTTP globale inchangée : 16 Kio ; fractionner les gros imports.

WebSocket `/ws`, après `auth` :

```json
{"type":"competition.subscribe","id":"UUID"}
{"type":"competition.answer","id":"UUID","questionNo":0,"choice":2}
{"type":"competition.unsubscribe"}
```

Réponses versionnées : `competition.state` (vue personnelle initiale), `competition.answer.accepted`, `competition.updated` (id, révision, état). Les changements légers sont lus depuis `competition_events`, outbox écrite dans la transaction. Chaque instance conserve son curseur et diffuse uniquement aux abonnés concernés ; un client récupère sa vue par HTTP. La consultation Flutter toutes les cinq secondes répare une notification perdue et la reconnexion récupère la réponse déjà enregistrée. Pas de fan-out de snapshots de salle à toute la compétition. La boucle actuelle interroge PostgreSQL une fois/seconde/instance ; prévoir une diffusion bus et une lecture groupée avant passage à grande échelle. Les délais de diffusion ne sont pas déclarés conformes aux objectifs du cahier.

## Back-office React/TypeScript

```powershell
npm.cmd ci --prefix admin
npm.cmd run dev --prefix admin
# Contrôle de compilation
npm.cmd run build --prefix admin
```

Interface sur `http://127.0.0.1:5173`, proxy local `/api` vers l'API 3000. Le port est le même que le client Flutter Web de développement : arrêter celui-ci ou choisir un autre port et ajouter l'origine correspondante dans `ALLOWED_ORIGINS`. La connexion administrateur utilise le nom d'utilisateur et le mot de passe ; jetons en mémoire, refresh sérialisé. Le compte initial est créé par la migration 005, sans supprimer les comptes existants. Voir [ADMIN_AUTH.md](ADMIN_AUTH.md).

Fonctions : catalogue et catégories, édition JSON validée, historique, import CSV/JSON, statistiques ; planification et supervision manuelle ; ouverture et annulation/remboursement ; utilisateurs (liste sans téléphone), ledger, audit et ajustements audités. Les sanctions, stocks cadeaux et KPI avancés restent absents. Les modérateurs ont accès au catalogue, jamais aux ajustements et à l'administration compétition.

## Démo locale accélérée

Conserver les volumes et `.env`. Appliquer la migration via le processus habituel :

```powershell
docker compose up --build -d
# Ou, pour l'API Node locale avec PostgreSQL/Redis existants :
npm.cmd run migrate
npm.cmd start
```

Créer les comptes dans Flutter par OTP mock explicite, récupérer l'UUID du futur administrateur depuis `/me`, puis :

```powershell
node --env-file=.env scripts/grant-admin.js UUID_ADMIN
node --env-file=.env scripts/seed-catalog.js UUID_ADMIN
node --env-file=.env scripts/competition-demo.js UUID_ADMIN
```

Le dernier script crée uniquement une nouvelle compétition gratuite de démonstration, attend deux inscriptions normales, puis avance son départ à quinze secondes. Il est refusé en production et hors `OTP_PROVIDER=mock`. Entrer dans la compétition depuis chaque client Flutter. Chaque réponse reste limitée à dix secondes. À deux inscrits, un seul finaliste est possible : la finale peut se résoudre immédiatement. Le test natif à quarante inscrits vérifie une finale avec une question distincte.

Le script de démo n'a pas été lancé sur les comptes existants pendant ce travail. Les tests automatisés utilisent des schémas isolés et ne modifient pas les tables applicatives en cours d'utilisation.
