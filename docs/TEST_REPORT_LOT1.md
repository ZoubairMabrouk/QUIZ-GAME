# Validation du lot 1 — 26 octobre 2026

Réussis sur le code modifié :

| Commande | Résultat |
| --- | --- |
| npm test | 18 tests réussis |
| node --test test/embedded/competitions.test.js test/embedded/event-delivery.test.js | 17 entrées réussies, dont 15 sous-tests compétition |
| node --test test/embedded/realtime-competition.test.js | 1 test réussi, vrais WebSockets sur deux API puis redémarrage d'une instance |
| npm run test:migrations | 4 tests réussis avec migration 007, dont HTTP réel |
| Flutter analyze --no-pub | Aucune anomalie |
| Flutter test --no-pub | 13 tests réussis |
| npm run build --prefix admin | TypeScript et Vite réussis |
| node test/browser/admin-login.mjs | Connexion/déconnexion navigateur réussie, API simulée |

Couverture ajoutée : réponses privées sans invalidation publique, grâce sur fermeture/expiration du bail, absence de grâce pour simple inactivité confirmée, limite de connexions par compte entre services, récurrence et changement d'heure Europe/Paris, rappels persistants dédupliqués et privés, désactivation de récurrence, annulation d'incident et remboursement unique après reprise, historique privé/paginé, événements dont un ID inférieur devient visible plus tard, déduplication et reprise d'instance. Le scénario WebSocket vérifie aussi la réparation après notification manquée et la restauration du choix déjà enregistré.

Les tests Flutter vérifient le tri des snapshots de même révision avec heure serveur/révision personnelle, le jitter borné et le déclenchement d'une réparation après arrière-plan. Les tests widget existants de jeu et inscription restent verts. Ils ne constituent pas une simulation complète d'une coupure mobile sur appareil physique.

Échec restant lié à l'environnement : `node --env-file=.env scripts/test-services.js` échoue dans ses trois scénarios à la connexion PostgreSQL (`ECONNREFUSED 127.0.0.1:55432`). La suite native n'a pas validé les règles ou la concurrence dans cette session. Des tests natifs supplémentaires sont intégrés dans test/helpers/native-reliability.js : vue sous verrou exclusif, réponse d'un autre joueur pendant un verrou d'inscription, et ordre réel de commits différent de celui des séquences. Ils devront passer dans la CI PostgreSQL/Redis avant de conclure à la validation native multi-instance.

PGlite est un moteur PostgreSQL embarqué avec connexion sérialisée. Les deux instances API du test WebSocket partagent ce moteur ; le transport Redis et les limiteurs y sont remplacés par un adaptateur local. Ces réussites prouvent les parcours et le protocole, pas le débit, les verrous natifs ni le comportement de Redis en panne.

Environnement : Node 22.13.1 (le projet exige >=24), Flutter 3.32.5/Dart 3.8.1 du SDK local. L'analyse et les tests Flutter ont utilisé directement flutter_tools.snapshot pour accéder au cache SDK. La CI reste configurée avec les versions du dépôt. Aucun déploiement ni migration de la base applicative locale n'a été effectué.

Non exécutés : charge native, panne réseau réelle multi-machine, mesure de débit/latence et recette sur appareil physique. Les politiques opérationnelles et limites de garantie sont détaillées dans LOT1_REALTIME.md.
