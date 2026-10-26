# Validation — 23 octobre 2026

## Mise à jour après lecture du DOCX et ajout du moteur

État actuel : `npm.cmd test` **18 tests réussis** ; `node --env-file=.env scripts/test-services.js` **29 entrées réussies** (trois suites, 26 scénarios) sur PostgreSQL 17 natif et Redis ; `node --test test/embedded/competitions.test.js` **12 entrées réussies** ; `flutter.bat analyze` sans anomalie ; `flutter.bat test` **10 tests réussis** ; compilation Flutter Web réussie ; `npm.cmd run build --prefix admin` (TypeScript + Vite) réussie. Avertissement de police Cupertino absent, déjà connu.

Le test natif de quarante inscrits joue deux questions distinctes (phase 1 puis finale), attribue deux gains de palier et un gain final, puis vérifie les statistiques. Les scénarios supplémentaires vérifient la stagnation stricte à 90 %, tous faux, plafond, temps cumulé et tirage reproductible, corrections cachées, rejet tardif pendant la tolérance de reconnexion, transaction annulée lors d'une panne de gain, reprise par une nouvelle instance de service, événements compétition sur deux instances et déduplication HTTP/WebSocket. Les nouveaux widgets couvrent question, accusé, correction, spectateur et résultat à 360 px en RTL. Cela ne remplace pas un test E2E navigateur ou physique avec le backend réel.

Échecs intermédiaires corrigés : inférence SQL du type d'un paramètre `CASE` (cast explicite integer), déclaration de type Vite pour l'import CSS. Les suites concernées ont ensuite réussi.

Une relance Flutter parallèle a ensuite expiré au chargement (aucun test exécuté, problème de finalisation de fichiers temporaires). La relance finale **`flutter.bat test --concurrency=1` a réussi ses dix tests**. L'analyse statique finale n'a signalé aucune anomalie. Le dernier accusé de réponse comporte une révision pour empêcher un ancien état réseau de masquer le choix accepté.

Aucune migration sur les tables applicatives existantes, aucun volume effacé, aucun compte de production modifié. Les tests de panne injectent une erreur dans la transaction et recréent le service : pas de processus système réellement tué, pas de partition réseau simulée. Le script interactif `competition-demo.js` est fourni mais n'a pas été exécuté sur les comptes existants. Le back-office est compilé et ses routes sont testées ; son parcours navigateur n'a pas été exécuté.

Les limites et absences **actuelles** sont dans [EXIGENCES_F1_F11.md](EXIGENCES_F1_F11.md) et [ETAPE_4_COMPETITIONS.md](ETAPE_4_COMPETITIONS.md). Les sections suivantes conservent le rapport de la première tranche ; notamment leur mention d'un moteur et back-office absents est désormais historique.

## Exécuté et réussi

| Commande | Résultat |
|---|---|
| `npm.cmd ci` | 25 dépendances installées, audit sans vulnérabilité signalée |
| `npm.cmd test` | 13 tests réussis |
| `node --test test/embedded/competitions.test.js` | 8 entrées réussies (une suite, sept scénarios) |
| `node --env-file=.env scripts/test-services.js` | 24 entrées réussies (trois suites, 21 scénarios), PostgreSQL 17 natif et Redis réels |
| `flutter.bat analyze` | Aucune anomalie |
| `flutter.bat test` | 9 tests réussis, dont inscription compétition à 360 px sous Directionality RTL |
| `flutter.bat build web --no-web-resources-cdn --dart-define=API_URL=http://127.0.0.1:3000` | Build Web réussi ; avertissement de police Cupertino absente (aucune icône Cupertino utilisée) |

Les tests natifs créent des schémas PostgreSQL isolés puis les suppriment. Les tests Redis utilisent un préfixe aléatoire. Aucun volume effacé, aucune migration appliquée aux tables de l'API déjà en cours d'exécution, aucun administrateur créé dans les données existantes et aucun fournisseur réel appelé.

Les nouveaux scénarios couvrent : rôles administrateur/modérateur, entrées, inscription concurrente et répétée, solde insuffisant sans inscription, fermeture selon horloge base, remboursement unique, rollback d'une panne simulée puis reprise avec nouvelle instance de service, catalogue/import/version, gel immuable T−10, banque insuffisante et absence de correction dans les détails publics. Les routes HTTP sont exercées via une vraie API avec Redis. Les tests multi-instance WebSocket concernent les salles existantes, pas encore les compétitions.

## Échecs rencontrés et corrigés

- `npm` PowerShell bloqué par ExecutionPolicy : utilisation de `npm.cmd`, sans modifier la politique système.
- Installation initiale refusée par le sandbox : relancée avec autorisation, réussie.
- Première exécution Flutter : méthode de test de taille d'écran incorrecte ; corrigée, suite complète ensuite réussie.
- Première tentative de commande Node inline : guillemets PowerShell incompatibles ; utilisation du script `scripts/test-services.js` étendu, suite réussie.

## Limites

Node local 22.13.1 (le projet cible 24+), Flutter 3.32.5 / Dart 3.8.1. Validation à reproduire sur les versions cibles de CI. Aucun test de charge, APK/IPA, navigateur Playwright, téléphone physique, OTP Twilio réel ou livraison fournisseur exécuté pendant ce lot. RTL testé en direction de mise en page ; traduction arabe et localisation complètes non implémentées.

Le moteur de compétition, les phases, les gains, le spectateur, la reconnexion compétition, le back-office React et la recette accélérée jouable des deux phases ne sont pas livrés. Les compétitions de préparation sont annulées/remboursées au départ tant que ce moteur n'existe pas. Les tests ne prouvent donc pas le critère de recette complète demandé.

Voir COMPETITIONS_PROGRESS.md pour la traçabilité provisoire et les tâches restantes. La numérotation exacte F1–F11 reste invérifiable sans le DOCX absent.
