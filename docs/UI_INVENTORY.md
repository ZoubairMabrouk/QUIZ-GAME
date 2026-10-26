# Inventaire initial Flutter — 26 octobre 2026

Inventaire du code, avant refonte. Ce document ne constitue pas une recette visuelle.

| Parcours actuel | Source | Travail attendu |
| --- | --- | --- |
| Connexion OTP | main.dart, `_login` | Pays, validation proche du champ, autofill/paste, consentement, expiration et renvoi |
| Accueil et portefeuille | main.dart, `_home` | Destination dédiée, chargement distinct de zéro, reprise et prochaine compétition |
| Créer/rejoindre une salle | main.dart, `_room` | Création guidée, catégories, visibilité et liens profonds |
| Lobby et joueurs | main.dart, `_lobby`, `_players` | QR, présence réseau, hôte, expulsion et prêt accessibles |
| Question et réponse | main.dart, `_question` | Séparer confirmation/correction, isoler le chrono, reprise réseau |
| Classement et résultats salle | main.dart, `_ranking`, `_finished` | Podium accessible, gains confirmés et revanche |
| Catalogue/inscription compétition | competitions_page.dart | Coût, fuseau, fermeture, confirmation et insuffisance de solde |
| Manche compétition | competition_play_page.dart | État typé, réseau séparé, attente, élimination, spectateur et finale |
| Classements | leaderboards_page.dart | Pagination et filtres accessibles |
| Profil, récompenses, communauté et notifications | Pas de page dédiée dans client/lib | Construire avec les API autoritatives correspondantes |

Navigation cible : Accueil / Jouer / Compétitions / Récompenses / Profil, barre mobile puis navigation latérale tablette/Web. Préserver la destination après connexion et gérer le retour navigateur.

Extraire progressivement thème, couleurs sémantiques violet/indigo/or, typographie, espacements, boutons, champs, cartes et états communs. Prévoir thèmes clair/sombre/système, FR/EN/AR et RTL complet. Réutiliser api.dart et game_controller.dart en renforçant les modèles et la séparation réseau/présentation.

Recette requise pour chaque écran : chargement, vide, erreur, succès, réseau perdu et reprise ; largeurs 360/390/768/1024/1440 ; texte 200 %, clavier, lecteur d'écran et cibles 48 px. Animations réduites via préférence système et déduplication des célébrations sur les résultats serveur. Aucune validation de contraste ou de 60 fps n'a encore été effectuée.
