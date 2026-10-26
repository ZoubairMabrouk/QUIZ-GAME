# Administration : bootstrap explicite

Les migrations ne créent plus de compte ni de mot de passe connu. Les joueurs conservent la connexion téléphone/OTP et la validation réelle en production.

Configurer DATABASE_URL et injecter QUIZ_STAFF_PASSWORD (12 à 1024 caractères) depuis votre gestionnaire de secrets, sans placer le secret dans les arguments de commande. Puis :

```powershell
npm.cmd run migrate
npm.cmd run bootstrap:staff -- zoubair
Remove-Item Env:QUIZ_STAFF_PASSWORD
npm.cmd start
npm.cmd run dev --prefix admin
```

`zoubair` est un exemple choisi explicitement. Il n'existe aucun mot de passe par défaut. Le bootstrap crée une identité staff, un rôle administrateur et une trace d'audit dans une transaction. Il refuse un nom existant et ne réinitialise ni compte, ni mot de passe, ni session. Les secrets ne sont pas journalisés. Le changement de mot de passe authentifié révoque toutes les anciennes sessions admin.

Ports : Flutter 5173 (`flutter run -d chrome --web-port 5173`), admin 5174, API 3000. Le proxy Vite /api cible http://127.0.0.1:3000. Les origines localhost et 127.0.0.1 sur 5173 et 5174 figurent dans les valeurs par défaut et .env.example. Mettre à jour ALLOWED_ORIGINS dans un .env déjà existant si nécessaire ; le fichier existant n'est pas écrasé.

## Migrations compatibles

005 est corrigée sur place : suppression du seed et du NOT NULL du téléphone, avec contrainte conditionnelle imposant le téléphone aux players. Format et unicité sont conservés. Cette correction permet de franchir 005 sur une base neuve ou arrêtée après 004 ; 006 seule n'aurait pas résolu ce blocage.

006 corrige aussi les installations ayant déjà enregistré 005. Le runner utilise une transaction et un verrou consultatif. Une ancienne exécution échouée via le runner est annulée et peut être relancée. Tous les comptes existants, rôles, credentials et révocations restent conservés. Les credentials development_only restent refusés en production avant changement du mot de passe. Aucun renommage automatique zoubai/zoubair sur les comptes existants.

## API et tests

POST /v1/admin/auth/login reçoit username/password et exige le rôle administrator actuel. L'audience admin interdit le portefeuille et les parties joueur. POST /v1/admin/auth/password vérifie currentPassword, remplace le hash scrypt et révoque les anciennes sessions. Redis impose les limites de connexion.

`npm run test:migrations` utilise PostgreSQL PGlite et le vrai serveur HTTP : base neuve, mise à niveau 004, 005 enregistrée, contrainte téléphone, bootstrap, refus de remplacement, connexion, droits et révocation. Redis est remplacé par un adaptateur de test : cela ne valide ni ses limites ni la concurrence native. `scripts/test-services.js` couvre ces dépendances réelles. Voir TEST_REPORT_LOT0.md pour cette session ; les anciens rapports restent historiques.
