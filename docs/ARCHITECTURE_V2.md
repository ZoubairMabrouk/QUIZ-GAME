> Document conservé de l’étape 2. Pour l’état actuel, consulter `ETAPE_3.md` et `TEST_REPORT_V3.md`.

# Architecture de l’étape 2

## Stockage

PostgreSQL est l’autorité pour les comptes, le ledger et les parties. Redis contient les challenges OTP temporaires, les quotas et des verrous de vérification. La base n’est pas un cache des réponses clients ; elle conserve les questions choisies et leur correction côté serveur. Toute vue API des questions est filtrée explicitement.

Le backend reste modulaire en JavaScript ESM. La migration NestJS/TypeScript prévue dans le backlog n’est pas nécessaire pour ce lot PostgreSQL/OTP et n’est pas revendiquée comme terminée. Le module de données s’appuie sur `pg` ; toutes les instructions d’une transaction utilisent la même connexion.

## Concurrence des parties et du ledger

Une commande verrouille la ligne de sa salle avec `SELECT ... FOR UPDATE`. Les délais sont basés sur `clock_timestamp()` PostgreSQL pour que les instances API partagent la même référence. Les connexions et transactions doivent rester courtes : le JSONB de salle convient au MVP de petites salles, pas à un tournoi massif.

Les récompenses sont calculées lors de la clôture et les comptes sont verrouillés dans un ordre stable. Une clé d’idempotence utilise l’UUID interne de partie, jamais son code public. Toute erreur fait annuler ensemble le classement, les crédits et la transition de partie. Une nouvelle consultation pourra réessayer. Le ledger et le solde matérialisé évoluent dans la même transaction.

Le plafond reste 100 Silver/jour UTC. Une récompense dépassant le plafond est refusée intégralement, comme au lot 1. Les migrations empêchent UPDATE/DELETE sur le ledger via un trigger. Elles ne rendent pas le journal invulnérable au propriétaire de schéma : utiliser un rôle d’application non propriétaire et un rôle de migration distinct en production.

## Cycle OTP

La bibliothèque de numérotation vérifie le format E.164 et la plausibilité selon le plan de numérotation. Seule la validation OTP par Twilio établit le contrôle du numéro. Cela ne constitue pas une vérification d’identité civile ou d’âge. Le mock ne produit jamais `phoneVerified: true`.

Les clés Redis sensibles utilisent un HMAC du numéro ou de l’IP. Le téléphone et le SID fournisseur restent dans la valeur du challenge pendant sa durée de vie ; protéger Redis, son réseau, son disque et ses sauvegardes. Le code réel n’est pas conservé, renvoyé ou journalisé.

Le verrou par téléphone couvre demande et vérification ; sa libération compare le propriétaire. Le challenge actif est remplacé à chaque nouvelle demande. La consommation vérifie le verrou et le challenge en un script Lua, puis supprime l’état OTP. PostgreSQL possède également une contrainte unique sur l’identifiant de challenge consommé. Un crash après consommation Redis et avant création de session impose de demander un nouveau code. Il échoue en refusant l’accès ; il ne crée pas de contournement.

Le mode de Redis ciblé est une instance logique standard (éventuellement répliquée). Les scripts multiclés ne sont pas configurés pour Redis Cluster : le partitionnement par hash tags devra être conçu avant adoption du cluster.

## Sessions

Jetons opaques aléatoires de 256 bits, uniquement leurs empreintes SHA-256 en PostgreSQL. Accès de 15 minutes et refresh de 30 jours. Le refresh verrouille la session et sa famille ; l’ancien accès est invalidé à la rotation. Un ancien refresh réutilisé révoque toute sa famille. Le client doit sérialiser les renouvellements ; après une réponse perdue lors d’une rotation, se reconnecter par OTP.

La durée refresh de 30 jours se renouvelle à chaque rotation ; aucune durée maximale absolue de famille n’est imposée dans ce lot. Les comptes mock ne sont pas utilisables par les routes protégées en mode production.

## Exploitation

`/health` indique que le processus fonctionne ; `/ready` interroge PostgreSQL et Redis. Si Redis est indisponible, les routes protégées échouent sans passer outre les quotas. Les logs applicatifs ne contiennent ni numéro, ni code OTP, ni jeton fournisseur/session. Le débit HTTP actuel est 240/minute/IP ; tous les utilisateurs derrière un proxy partagent ce quota tant que la confiance envers le proxy n’est pas configurée.

Le Compose local utilise des mots de passe générés, des volumes, des checks de santé et des ports liés à loopback. Il utilise un rôle PostgreSQL propriétaire pour simplifier le développement ; ce choix est à séparer en production. TLS, reverse proxy, stockage chiffré, sauvegardes, supervision, budgets Twilio et purge périodique des anciennes sessions/challenges consommés/parties sont des travaux de déploiement encore à réaliser.

Les clés de quota Redis doivent être conservées (politique noeviction, AOF dans Compose). Une perte de Redis invalide les challenges en cours et remet les compteurs à zéro ; les plafonds de dépenses Twilio doivent donc aussi être configurés côté fournisseur.

## Compatibilité lot 1

Le protocole de salle reste proche du précédent, mais les sessions de développement sont remplacées par OTP. Le fichier SQLite du lot 1 n’est pas importé automatiquement, car ses pseudos ne sont liés à aucun numéro vérifié. Les règles de score et l’algorithme isolé de compétition sont conservés. La temporisation complète, les notifications de manche et le service de compétition restent des tâches futures.
