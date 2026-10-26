# Suivi compétition — 23 octobre 2026

> Historique de la première tranche. Le DOCX a depuis été fourni et lu ; le moteur, le back-office et le parcours Flutter ont été ajoutés. État actuel : [ETAPE_4_COMPETITIONS.md](ETAPE_4_COMPETITIONS.md), [traçabilité exacte F1–F11](EXIGENCES_F1_F11.md). Les limites ci-dessous décrivent l'état antérieur.

## Sources et limites

Demande jointe lue intégralement. `Cahier des charges.docx` absent du dépôt et de son répertoire parent. Aucun `AGENTS.md` trouvé dans le dépôt. README, ETAPE_3, ROADMAP, DECISIONS, ARCHITECTURE_V2 et TEST_REPORT_V3 consultés. Les identifiants F1–F11 ne figurent pas dans ces sources : leur correspondance exacte reste à établir depuis le DOCX. Ne pas inventer cette numérotation.

## Traçabilité provisoire par domaine

| Domaine (numéro F à confirmer) | État intégré | Fichiers / preuves |
|---|---|---|
| Authentification téléphone | Implémentée, livraison réelle externe | src/auth.js, otp-provider.js, postgres.js ; test/auth.test.js |
| Profil/social | Partiel : pseudo, pas amis ni badges | postgres.js, client/lib/main.dart |
| Salles M3 | Partiel : parcours jouable, paramètres avancés absents | durable-rooms.js, realtime.js ; test/helpers/realtime-scenarios.js |
| Catalogue | Partiel : catalogue persistant, versions, import JSON, gel ; CSV et statistiques absents | editorial.js, migration 003 ; competition-scenarios.js |
| Compétition M5 | Partiel : planification, ouverture, inscription, fermeture, annulation et remboursement | competitions.js, migration 002 ; test/helpers/competition-scenarios.js |
| Portefeuille | Partiel : ledger et soldes transactionnels | postgres.js ; test/helpers/scenarios.js |
| Cadeaux | Absent ; décision métier et fournisseurs | Désactivés lors de la création de compétition |
| Administration | Partiel : rôles et API compétition audités | user_roles, admin_audit ; scripts/grant-admin.js ; interface React absente |
| Contenu utilisateur | Absent | Politique de récompenses non activée |
| Notifications | Absentes | Adaptateurs et centre à réaliser |
| Paiements/publicité | Absents, dépendances externes | Aucun achat ou crédit publicitaire simulé |

## Tranche réalisée

- Migration additive 002 ; ne modifie pas les lignes existantes.
- Planification UTC avec offset obligatoire et fuseau IANA validé. Coût et minimum configurables, catégories enregistrées. Récompenses/cadeaux refusés explicitement.
- Rôles lus en base dans la transaction ; un modérateur ne peut pas administrer les compétitions.
- Inscription unique par clé composée ; verrou de compétition puis ledger et inscription dans une seule transaction. Rejouer l'inscription renvoie le reçu existant, même après annulation, avec `refunded_at`.
- Fermeture stricte T−5 min selon l'horloge PostgreSQL, même si le balayage est retardé.
- Réconciliation chaque seconde, jusqu'à 100 compétitions par passage ; annulation au minimum insuffisant. À l'heure du départ, annulation `gameplay_not_enabled` si le moteur reste indisponible.
- Annulation, remboursement et transition atomiques ; clés ledger stables, comptes parcourus dans l'ordre des UUID. Une panne annule toute la transaction ; un processus redémarré peut reprendre.
- Pas de bail Redis pour cette tranche : le verrou PostgreSQL est détenu sur la connexion qui écrit. Aucune opération différée d'un ancien propriétaire. Cela ne constitue pas encore l'orchestrateur des manches.
- Liste et inscription Flutter via l'API réelle, actualisation manuelle, erreurs et états d'inscription/remboursement. Pas encore de salle d'attente synchronisée, de jeu compétition ou de résultats.
- Catalogue persistant : catégories, QCM à quatre choix distincts, difficulté, FR/EN/AR, explication, source, états brouillon/validé/retiré et marqueur développement. Import JSON entièrement refusé si une ligne est invalide, avec rapport par ligne ; contrôle de version lors d'une modification. Historique protégé contre modification/suppression.
- À T−10, sélection des questions validées par catégorie/langue/difficulté et fenêtre anti-répétition entre compétitions non annulées. Sélection sérialisée par verrou transactionnel, snapshots immuables. Annulation/remboursement `insufficient_catalog` si la banque ne fournit pas le nombre demandé. Le choix actuel est déterministe par UUID ; une sélection équilibrée/aléatoire reste à ajouter.

## Backlog par dépendances

1. Récupérer le DOCX et confirmer la correspondance F1–F11 et les ambiguïtés d'élimination.
2. Compléter le catalogue : import CSV, statistiques de réponses, interface éditoriale et sélection équilibrée. Le socle persistant et le gel T−10 sont réalisés.
3. Moteur persistant par question/participant, délais serveur, clôture atomique, tirage auditable, politique configurable de stagnation et plafond. Ne pas stocker les participants massifs dans un JSONB de salle.
4. Orchestration avec fencing, événements/outbox, réconciliation incrémentale ; tests de panne et multi-instance. Tolérance 24 secondes sans réponse après correction.
5. Palier, finale et gains atomiques ; éligibilité aux cadeaux seulement après âge, téléphone et stocks intégrés.
6. Parcours Flutter complet et back-office React/TypeScript utilisant le même OTP ; tests mobiles/RTL et recette accélérée.
7. Écarts M3 puis profil/social, contenu utilisateur, économie/cadeaux, notifications ; contrats fournisseurs désactivés pour paiements/publicités.

## Décisions provisoires

La formule de score existante n'est pas modifiée. L'algorithme isolé d'élimination n'est pas utilisé comme un tournoi fonctionnel. Pas de sélection figée fictive, de cadeau attribué sans contrôle, ni de statut de tournoi terminé sans partie. Le module de préparation rembourse au départ tant que le moteur n'est pas intégré. Cette limite doit être levée avant toute ouverture réelle aux joueurs.

Les objectifs de charge ne sont pas mesurés. Aucune conformité juridique ou stores revendiquée.

Rapport des commandes réellement exécutées et de leurs limites : [VALIDATION_COMPETITIONS.md](VALIDATION_COMPETITIONS.md).
