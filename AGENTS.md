# Consignes pour les agents

## Revue de code GitHub

Lors d'une demande de revue ou de l'examen d'une pull request GitHub :

- Examine le diff complet et le contexte utile autour des changements, y compris les appels concernés, les tests et les contrats API.
- Recherche uniquement les défauts concrets introduits par le changement : régression, erreur de logique, risque de sécurité, perte ou corruption de données, comportement asynchrone incorrect ou test manquant qui masque un tel défaut.
- N'inclus pas de préférences de style, de simples suggestions ni de problèmes préexistants sans lien avec le diff. Ne déduis pas un problème sans preuve suffisante.
- Classe les constats par gravité décroissante et indique le fichier et les lignes exactes du diff, l'impact concret et les conditions nécessaires pour reproduire le problème.
- Si aucun défaut n'est établi, indique clairement qu'aucun constat n'a été trouvé ; ne fabrique pas de constat pour remplir la revue.
- Ne modifie pas les fichiers et ne corrige pas les constats pendant une revue, sauf demande explicite.
- Pour un examen lié à la sécurité, applique également [SECURITY.md](./SECURITY.md).

## Contexte du projet

- Le dépôt contient un backend Node.js ESM, un client Flutter et une interface d'administration React/Vite. Le backend utilise PostgreSQL comme source de vérité et Redis pour les OTP, quotas, verrous et la diffusion temps réel.
- Le protocole, les choix d'architecture et les limites opérationnelles sont documentés dans `docs/ETAPE_3.md`, `docs/LOT1_REALTIME.md` et `docs/ARCHITECTURE_V2.md`. Vérifie ces contrats avant de qualifier un changement de régression.
- Ne traite pas les fichiers de l'ancien serveur SQLite (`src/sqlite-server.js`, `src/store.js`, `src/rooms.js`) comme le chemin de production : `npm start` démarre le backend PostgreSQL/Redis.
- Ne considère pas les protections du mode de développement, les limites décrites comme travaux futurs ou le Compose local comme des garanties de production.

## Validation

Exécute les validations pertinentes au changement et rapporte celles qui n'ont pas pu être exécutées :

- Backend : `npm test` et, selon les fichiers touchés, `npm run test:migrations`, `npm run test:embedded` ou `npm run test:integration`.
- Administration : `npm run build --prefix admin`.
- Flutter : depuis `client`, `flutter analyze` et `flutter test` ; pour les changements de compilation Web, `flutter build web --no-web-resources-cdn`.
- Pour les commandes CI et leurs dépendances, consulte `.github/workflows/test.yml`. Ne prétends pas qu'une vérification a réussi si elle n'a pas été exécutée.
