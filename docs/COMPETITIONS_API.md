# API compétition v1 — préparation locale

> Contrat de la première tranche, complété et remplacé pour le jeu par [ETAPE_4_COMPETITIONS.md](ETAPE_4_COMPETITIONS.md). Les compétitions démarrent maintenant ; elles ne sont plus systématiquement remboursées au départ.

Toutes les routes nécessitent le Bearer existant obtenu par OTP téléphone. Aucune session email/social ni mot de passe administrateur ajouté. Les routes d'administration relisent le rôle en PostgreSQL ; le rôle modérateur ne suffit pas.

| Méthode et route | Effet |
|---|---|
| GET /v1/competitions | 100 dernières compétitions et inscription personnelle |
| GET /v1/competitions/:uuid | Détail, nombre d'inscrits, heure serveur, reçu personnel |
| POST /v1/competitions/:uuid/register | Débit Silver + inscription atomiques, répétition idempotente |
| POST /v1/admin/competitions | Planification auditée |
| POST /v1/admin/competitions/:uuid/open | Ouvre avant T−5, corps `{}` |
| POST /v1/admin/competitions/:uuid/cancel | Annule et rembourse, corps `{}` |
| GET /v1/admin/catalog | Catalogue privé et catégories (administrateur/modérateur) |
| POST /v1/admin/categories | Crée/modifie `{slug,name}` |
| POST /v1/admin/questions | Crée une question |
| POST /v1/admin/questions/:uuid | Modifie avec `version` courante obligatoire |
| GET /v1/admin/questions/:uuid/history | Versions privées de la question |
| POST /v1/admin/questions/import | Import JSON `{questions:[...]}`, rapport par ligne |

Exemple de création :

```json
{"title":"Préparation locale","startsAt":"2026-10-24T18:00:00Z","timeZone":"Africa/Lagos","silverCost":0,"minimumPlayers":2,"categories":["science"]}
```

Choisir une date future à plus de dix minutes. Aucun paiement n'est demandé pour le scénario local à coût zéro. `gifts` et `rewards` non vides sont refusés (409). Statuts exposés actuellement : `PLANIFIEE`, `INSCRIPTIONS_OUVERTES`, `INSCRIPTIONS_CLOSES`, `ANNULEE`. Les autres statuts sont réservés au futur moteur.

Options de sélection : `language` (`fr` par défaut), `questionLimit` (30, 1–200), `difficulty` (facultatif, 1–5), `repetitionDays` (7, 0–365). Le gel T−10 exige assez de questions validées ; sinon annulation `insufficient_catalog` et remboursement. La fenêtre évite les questions figées récemment dans d'autres compétitions non annulées. Aucun snapshot ni correction n'est exposé par les routes publiques.

Une question contient `category`, `language`, `difficulty`, `status` (`draft`, `validated`, `retired`), `development`, `text`, `choices` (quatre chaînes distinctes), `correctIndex` (0–3), `explanation`, `source`. Un import invalide ne crée aucune question ; la réponse contient `imported:0` et `errors:[{row,error}]` (lignes à partir de 1). L'import CSV n'est pas encore fourni.

Réponses : 400 entrée invalide ; 401 session ; 403 rôle ; 404 identifiant inconnu ; 409 état incompatible, fermeture ou solde insuffisant ; 503 dépendance indisponible. `gameplay_enabled:false` signale la limite actuelle. L'inscription retourne `competition_id`, `user_id`, `paid_silver`, `registered_at`, `refunded_at`.

Aucun événement WebSocket compétition ajouté ; ne pas s'abonner avec le protocole de salle. Actualiser via HTTP. Les corrections ne sont pas exposées.

## Premier administrateur (PowerShell)

Créer un compte par le parcours OTP normal, obtenir son UUID par `GET /me`, puis exécuter localement avec l'accès base du gestionnaire :

```powershell
npm.cmd run migrate
node --env-file=.env scripts/grant-admin.js UUID_DU_COMPTE_EXISTANT
node --env-file=.env scripts/seed-catalog.js UUID_DU_COMPTE_EXISTANT
```

Le script n'invente pas de compte, ne génère aucun mot de passe et journalise la promotion en base. En production, il refuse un téléphone non vérifié. Protéger l'accès base ; ne pas exposer cette commande dans une route HTTP. Un compte mock est réservé au développement.

Le seed importe cinq questions explicitement marquées développement, une seule fois si aucune banque de développement n'existe. Il est interdit en production. Pour les essais avec cette petite banque, fixer `questionLimit` à 1 et `repetitionDays` à 0 ; le défaut de 30 exige une banque plus grande.

## Préserver le lancement local

Conserver `.env` et les volumes. Modifier `POSTGRES_PASSWORD` dans `.env` ne change pas le mot de passe du rôle dans un volume PostgreSQL déjà initialisé. Restaurer la configuration connue ou effectuer une rotation contrôlée du rôle avec un administrateur PostgreSQL puis mettre à jour les URL correspondantes ; ne pas supprimer le volume.

Web : `flutter run -d chrome --web-port 5173 --dart-define=API_URL=http://localhost:3000`, avec l'origine exacte dans `ALLOWED_ORIGINS`. Android émulateur : API `http://10.0.2.2:3000`. La politique CORS existante est conservée.

## Scénario accéléré de validation

`node --test test/embedded/competitions.test.js` exerce planification → inscriptions → fermeture → annulation/remboursement en avançant uniquement les dates des fixtures isolées. Ce n'est pas une démonstration jouable des deux phases. Pour PostgreSQL natif : définir `TEST_DATABASE_URL`, puis `node --test test/integration/competitions.test.js`. Un schéma aléatoire est créé et supprimé, aucune table applicative existante n'est touchée.
