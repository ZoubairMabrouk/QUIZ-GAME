> Document conservé de l’étape 2. Pour l’état actuel, consulter `ETAPE_3.md` et `TEST_REPORT_V3.md`.

# Vérification de l’étape 2

Date : 22 octobre 2026. Environnement local : Node.js 24.19.0, PGlite 0.5.11 (moteur PostgreSQL embarqué) et Redis 6.2.14 réel lancé pour les tests.

## Exécuté avec succès

- `npm test` : 13 tests réussis, aucun échec. Inclut les régressions du lot 1, la configuration, la validation des numéros et le contrat HTTP de l’adaptateur Twilio avec réponses simulées.
- `npm run test:embedded` avec Redis réel : 8 scénarios internes réussis, plus leur test conteneur (9 tests dans le compteur Node), aucun échec.
- Initialisation `.env` : création des secrets locaux et refus d’écraser une configuration existante.
- Syntaxe JSON du contrat OpenAPI, YAML Compose/CI et cohérence de version du lockfile : vérifiées.

## Scénarios d’intégration couverts

1. Consentement, limites de renvoi, code faux, code à usage unique, absence de code dans la réponse et mode mock non vérifié.
2. Hachage des jetons, rotation, révocation lors du rejeu d’un refresh.
3. Partie retrouvée après recréation du service de salle, corrections masquées et récompenses attribuées une seule fois.
4. Débits concurrents soumis au backend de test, idempotence, journal immuable et annulation de transaction.
5. Expiration Redis, refus après cinq essais faux et verrou commun entre deux instances du composant Redis.
6. Parcours avec l’adaptateur Twilio et HTTP fournisseur simulé : passage à téléphone vérifié uniquement après approval ; deux vérifications simultanées ne créent qu’une session.
7. Plafond du ledger PostgreSQL ; erreur injectée au deuxième crédit de récompense : rollback des crédits et du changement d’état, puis reprise réussie.
8. Déconnexion et refus d’un compte mock par les routes protégées en mode production.

## Limites de la vérification

PGlite exécute le SQL PostgreSQL réel dans un moteur embarqué à connexion unique. Son adaptateur de test sérialise les transactions. Les résultats ne prouvent donc pas le comportement des verrous d’un serveur PostgreSQL multi-connexion ou la capacité multi-instance sous charge.

La suite `test/integration/services.test.js` est fournie pour PostgreSQL serveur et Redis, avec schéma/préfixe isolés. Le workflow GitHub Actions utilise PostgreSQL 17 et Redis 7. Ni ce workflow hébergé, ni Docker Compose, ni cette suite contre un serveur PostgreSQL TCP n’ont été exécutés ici : Docker et le service PostgreSQL ne sont pas disponibles dans cet environnement.

Aucun appel Twilio réel et aucun SMS/WhatsApp réel. L’activation et les essais de livraison nécessitent un compte Verify configuré, des identifiants et, pour WhatsApp, un expéditeur opérationnel. Aucun test de charge, test mobile, audit de sécurité ou déploiement public n’a été effectué.
