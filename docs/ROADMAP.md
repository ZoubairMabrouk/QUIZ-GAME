> Document conservé de l’étape 2. Pour l’état actuel, consulter `ETAPE_3.md` et `TEST_REPORT_V3.md`.

# Implémentation par étapes

Les cases cochées correspondent à du code vérifié dans cette archive. Les objectifs du cahier des charges restent la cible du projet ; aucune phase future n’est déclarée terminée.

## Lot 1 — Domaine et API locale

- [x] Calcul du score, séries et délais.
- [x] Algorithme isolé d’élimination et tests des cas limites.
- [x] Ledger local atomique, persistant et idempotent.
- [x] Parcours API : identités locales → lobby → partie → classement → récompenses.
- [x] Contrat API, tests et scénario de démonstration.

## Lot 2 — PostgreSQL, Redis et authentification OTP

- [x] PostgreSQL : migrations versionnées, comptes, sessions, portefeuille, ledger et salles.
- [x] Redis : challenges OTP expirants, quotas et verrous par téléphone.
- [x] Adaptateur Twilio Verify pour SMS et WhatsApp ; validation de propriété après OTP.
- [x] Rotation des sessions, révocation, absence de comptes de développement dans le serveur principal.
- [x] Salles persistantes et attribution transactionnelle des récompenses.
- [x] Docker Compose, Dockerfile, workflow CI et tests serveur PostgreSQL/Redis fournis.
- [x] Tests locaux sur PostgreSQL embarqué + Redis réel.
- [ ] Exécuter Docker Compose et la suite sur PostgreSQL serveur (environnement non disponible ici).
- [ ] Configurer les identifiants Twilio et l’expéditeur WhatsApp ; tester les livraisons réelles.
- [ ] Rôles et permissions d’administration, sauvegardes, supervision et déploiement TLS.
- [ ] Framework NestJS/TypeScript si retenu ; le code métier reste en ESM dans cette livraison.

Critère de sortie avant exposition publique : livraisons SMS/WhatsApp vérifiées, suite multi-connexion réussie et configuration de déploiement sécurisée. La présente archive livre le code et la configuration, sans déclarer ces validations externes terminées.

## Lot 3 — MVP jouable cross-plateforme

- [ ] Flutter : connexion, catalogue, création/rejoindre, lobby, jeu, résultats, portefeuille.
- [ ] WebSocket : événements versionnés, heartbeat, synchronisation des horloges, reconnexion.
- [ ] Tests E2E avec deux clients, réseau interrompu et réponses tardives.
- [ ] Back-office minimal : questions validées, import et retrait.

Critère de sortie : deux personnes terminent une partie sur des plateformes différentes ; les corrections ne fuient pas avant le délai.

## Lot 4 — Économie et monétisation

- [ ] Plafonds configurables, bonus quotidiens et anti-farming.
- [ ] Validation serveur des reçus sandbox et idempotence des webhooks.
- [ ] Publicités récompensées validées côté serveur, plafonds et consentement.

Critère de sortie : rejouer un reçu ou une notification ne produit jamais un double crédit.

## Lot 5 — Compétition quotidienne

- [ ] Finaliser les règles de stagnation, égalités, nombre maximal de questions et tous-faux.
- [ ] Planning, inscriptions atomiques, fermeture T−5 min, annulation/remboursement.
- [ ] Orchestrateur unique, phases, spectateurs et reprise durable.
- [ ] Attribution auditable des récompenses et partenaires en sandbox.

Critère de sortie : répétition complète du tournoi, y compris panne et remboursement, sans argent réel ni cadeaux réels pendant les essais.

## Lot 6 — Contenu et administration

- [ ] Banques utilisateur, modération, signalements, rôles et audit.
- [ ] Amis, historique, notifications, FR/AR/EN et RTL.
- [ ] Export et suppression des données avec politique de conservation du ledger.

## Lot 7 — Validation avant lancement

- [ ] Tests de charge : mesurer p95, synchronisation et reprise ; cible initiale 20 000 clients.
- [ ] Anti-triche, tests d’abus, pentest et accessibilité.
- [ ] Sauvegardes, restauration, supervision, alertes et procédures.
- [ ] Validation des règles concours, paiement, âge et cadeaux pour les pays retenus.
- [ ] Bêta fermée, validation des stores, déploiement progressif.

Les fournisseurs d’authentification/paiement, les comptes stores, les partenaires et l’hébergement seront nécessaires aux étapes d’intégration concernées. Aucun de ces accès n’est nécessaire pour lancer le lot 1.
