> Historique du lot 1. Les choix actuels PostgreSQL/Redis/OTP sont décrits dans ARCHITECTURE_V2.md.

# Décisions du premier lot

## D01 — Commencer par le domaine, indépendamment du framework

Node.js 24 ESM, modules séparés et API HTTP native permettent d’exécuter ce premier lot sans téléchargement de dépendances. Les fonctions métier restent réutilisables derrière NestJS. Flutter reste la cible iOS/Android/Web du cahier des charges. Aucun choix de framework mobile n’est remplacé par cette livraison.

## D02 — SQLite local, PostgreSQL pour la suite

SQLite avec WAL et BEGIN IMMEDIATE permet de vérifier un vrai ledger persistant et transactionnel. Aucun solde modifiable n’est exposé aux clients : il est calculé depuis le journal. Les déclencheurs interdisent UPDATE et DELETE dans le journal pour le code applicatif courant ; un administrateur de base conserve naturellement le contrôle du schéma. L’idempotence compare tout le contenu d’une écriture, pas seulement sa clé. Les identifiants internes des parties sont des UUID, indépendants des codes d’invitation réutilisables.

Le portage PostgreSQL devra verrouiller le compte pendant chaque mouvement, vérifier le plafond dans la même transaction et intégrer les récompenses via un outbox durable. Les contraintes SQL ne remplacent pas les permissions du rôle applicatif.

## D03 — Score et clôture

Le score est arrondi une fois à l’entier le plus proche. La première bonne réponse n’a pas de bonus de série ; la deuxième reçoit +10 %, jusqu’à +50 %. Le délai est exclusif : une réponse à exactement T + durée est refusée. Le temps fourni par un client est ignoré. Pas de compensation de latence à ce stade.

Le cahier demande un score immédiat et l’absence de fuite de la bonne réponse avant clôture. Nous retenons la clôture pour publier les scores/corrections : cela réduit le partage des corrections pendant la manche. L’accusé de réception est immédiat.

## D04 — Élimination et blocages à résoudre avant tournoi réel

Le calcul ceil(0,9 × nombre de réponses justes) est conservé. Avec neuf joueurs ou moins répondant tous juste, personne ne sort. L’affirmation de 29 questions du cahier est une approximation continue qui ne garantit pas la terminaison avec des arrondis entiers. Le moteur signale `stalled`; il n’applique pas silencieusement une autre règle.

Si tout le monde répond faux, le moteur demande de rejouer une question, solution autorisée par le cahier. En finale, il élimine les mauvaises réponses, puis au moins un joueur s’ils sont tous justes. Les égalités de temps sont ordonnées par temps cumulé, réception serveur et ID stable pour rendre ce premier moteur reproductible. Le tirage au sort final auditable prescrit dans le document n’est pas encore implémenté.

Avant le lot compétition, décider du plafond de questions, de l’accélération d’élimination, du traitement répété de « tous faux » et du tirage au sort. Aucun service de tournoi avec cadeaux ne repose encore sur cette fonction.

## D05 — Récompenses et plafonds

Plafond local retenu : 100 Silver par jour UTC, non configurable dans ce lot. Si une récompense dépasse le solde disponible du plafond, elle est entièrement refusée avec `daily_cap`, sans crédit partiel. La politique doit ensuite être paramétrable. Seules les questions de développement officielles existent ; les banques utilisateur et leurs récompenses sont exclues de ce lot.

## D06 — Authentification locale

`/dev/sessions` crée une identité jetable et un jeton opaque. Aucun compte de production n’est revendiqué. La récupération du compte, les fournisseurs OAuth, les rôles et la vérification téléphone doivent précéder toute exposition réseau. Limitation simple à 240 requêtes/minute/IP ; ce réglage local devra être remplacé par des quotas distribués adaptés au mode temps réel.
