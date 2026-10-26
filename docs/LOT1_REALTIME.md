# Compétition et temps réel — lot 1

Appliquer `npm run migrate` pour installer 007 avant de démarrer les nouvelles instances. Aucun historique ni ledger n'est supprimé. Les règles de qualification restent dans competition-rules.js : plafond supérieur de 90 % des bonnes réponses, palier à max(1, floor(5 % du nombre initial)), phases séparées, all-wrong conservant les survivants. Le plafond phase_one_limit (29 par défaut, borné par question_limit) déclenche le classement cumulatif et le palier ; le plafond global termine au cumul puis tirage déterministe. L'engagement SHA-256 précède la révélation de la graine. Les gains et remboursements conservent leurs clés d'idempotence et leurs transactions.

## Concurrence et horloge

Les vues utilisent REPEATABLE READ READ ONLY, sans verrou de compétition ni écriture de présence. Une réponse prend FOR SHARE sur la compétition puis FOR UPDATE sur sa seule inscription ; les réponses de joueurs différents peuvent s'exécuter ensemble. Les transitions prennent FOR UPDATE sur la compétition : elles attendent les réponses déjà en transaction et empêchent toute nouvelle insertion une fois la correction publiée. Deux soumissions du même joueur se sérialisent : même choix = accusé idempotent, autre choix = 409.

PostgreSQL échantillonne clock_timestamp à la réception applicative : après réception complète et validation du JSON HTTP, avant authentification ; pour WebSocket, avant la file de traitement du socket. Il s'agit du premier instant observable par la base, incluant l'attente éventuelle du pool, pas d'une mesure du moment où un paquet touche la carte réseau. Aucune date fournie par le client n'est lue pour le score. Le timestamp doit être dans [début, échéance[ et ne peut être futur. Un message reçu à temps peut finir de s'insérer après l'échéance uniquement si la manche n'a pas encore été révélée. Un retry après révélation peut confirmer une réponse déjà persistée ; il n'en crée jamais une nouvelle.

Les réponses privées incrémentent answer_revision sur l'inscription, sans invalider tous les snapshots publics. Les clients comparent (révision publique, révision personnelle, heure serveur), puis font avancer leur chrono avec une horloge monotone. L'ordre d'arrivée réseau ne départage jamais les snapshots de même révision.

## Livraison et réparation

Il n'existe plus de curseur global max(id). Chaque socket suit la révision de sa compétition ; les événements sont lus par (competition_id, revision), ordre protégé par le verrou de cette compétition. Deux compétitions peuvent donc committer leurs BIGSERIAL dans n'importe quel ordre sans perte. Aucun sondage d'événements n'est effectué en l'absence d'abonné. Les lots de rattrapage contiennent au plus 100 événements et se poursuivent au passage suivant.

Une reconnexion envoie afterRevision, reçoit un snapshot complet et reprend les événements suivants. Sans curseur (nouvel écran ou redémarrage client), le snapshot courant est la réparation autoritative. Les IDs sont transportés, les notifications de révision sont dédupliquées côté Flutter. Le transport reste au moins une fois : la reprise peut répéter un événement, jamais ses gains. La conservation des événements n'a pas de purge dans ce lot.

Réparation serveur toutes les 5 secondes : vérification des révisions publiques/personnelles avant construction d'un snapshot compétition. Les snapshots salle inchangés ne sont plus renvoyés. Le client commun effectue une réparation HTTP de secours toutes les 30 secondes et dès reprise de l'application/reconnexion. Les invalidations rapprochées sont regroupées avec une recharge finale si une requête était déjà en vol. Les canaux salle Redis restent des accélérateurs ; la réparation repose sur PostgreSQL. Les autres instances n'ont pas besoin d'un curseur local persistant pour reconstruire l'état.

## Présence et délai de 24 secondes

Chaque abonnement compétition obtient une connexion UUID générée par le serveur et un bail PostgreSQL de 15 secondes, renouvelé par les pongs WebSocket (ping serveur toutes les 5 secondes). Fermeture et désabonnement enregistrent la déconnexion ; la mort d'un processus laisse le bail expirer. Plusieurs connexions sont agrégées : une connexion encore vivante suffit à considérer le compte présent.

Une réponse manquante ne prouve pas une panne. À l'échéance, si le dernier heartbeat est antérieur à celle-ci, la clôture peut attendre au plus une fenêtre de bail pour confirmer la présence. Un nouveau pong permet de clore normalement malgré l'inactivité. Une fermeture observée ou un bail expiré donne une grâce de reprise bornée au plus tard à échéance +24 s. Cette grâce retarde uniquement la correction. Elle ne prolonge jamais la fenêtre de réponse. Une nouvelle connexion vivante met fin à l'attente réseau. Le système ne prétend pas distinguer une coupure volontaire d'une panne physique.

## Récurrence, rappels et incidents

POST /v1/admin/competitions accepte daily:true. La première date conserve son offset explicite ; les occurrences suivantes gardent l'heure locale de cette première date dans timeZone. Le calcul utilise AT TIME ZONE PostgreSQL, y compris ses règles de résolution des heures locales ambiguës ou inexistantes. La prochaine occurrence est créée jusqu'à 24 h en avance, avec inscriptions ouvertes. La récurrence conserve ses paramètres éditoriaux et économiques. Révoquer le rôle administrateur désactive la génération ; POST /v1/admin/competition-schedules/:id avec enabled:false l'arrête explicitement. Les occurrences déjà créées doivent être annulées séparément.

Les tâches de récurrence/rappel tournent au plus toutes les 30 secondes par instance ; unicité et verrou de schedule rendent les reprises idempotentes. Après longue interruption, les occurrences manquées sont auditées et la prochaine date est recalculée sans générer des parties historiques. Les rappels T−1 h et T−5 min sont persistés par (compétition, utilisateur, type), rattrapés avant le départ et consultables dans Flutter. Ce lot livre une boîte in-app : aucun push ni email externe n'est annoncé.

Un retard de plus de 120 secondes par rapport à la transition attendue (ou au départ) constitue un incident prolongé. La reprise annule la compétition non terminée, rembourse chaque frais d'entrée une seule fois et écrit un audit système (actor_id NULL) avec motif prolonged_incident. Les Golden déjà gagnés restent acquis ; aucune mutation du ledger ni reprise d'un cadeau livré. Les compétitions terminées restent intactes. Le contrôleur ne promet pas une détection pendant que tous les processus et la base sont indisponibles : il applique la politique à la reprise.

## Historique, pagination et compte/appareil

GET /v1/competitions, GET /v1/leaderboards?period=all|week|month, GET /v1/me/competitions et GET /v1/me/competition-notifications acceptent limit (1–100, défaut 50) et offset (0–1000000), et renvoient nextOffset. L'historique est limité au compte authentifié, avec rang, frais, remboursement et Golden issus du ledger. Les écrans Flutter proposent la pagination. L'ordre est déterministe ; une pagination par offset peut se décaler si de nouveaux éléments sont ajoutés entre pages.

Une seule réponse par compte/question est garantie en base, sur tous les appareils et toutes les instances. Les abonnements compétition sont limités à cinq baux vivants par compte, sous verrou utilisateur en base ; les connexions de salle gardent leur limite locale de cinq sockets par compte et instance. Ce sont des limites de session, pas une preuve d'appareil. Aucun identifiant client, navigateur ou empreinte falsifiable n'est traité comme une identité matérielle. Un seul compte par appareil physique nécessiterait une politique et une attestation fournisseur distinctes, non livrées ici.

Les deux clients utilisent realtime_client.dart : timeout connexion 8 s, heartbeat applicatif 5 s, détection de silence 15 s, backoff exponentiel 0,5–15 s avec jitter, renouvellement de session avant expiration, fermeture en arrière-plan et reconnexion/réparation à la reprise. Les réponses ne sont jamais rejouées automatiquement par le transport.
