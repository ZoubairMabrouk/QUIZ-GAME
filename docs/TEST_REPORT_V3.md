# Validation de l'étape 3

## Vérifications exécutées

- `npm test` : 13 tests réussis (moteur, règles, ledger, configuration, fournisseurs OTP simulés et régression HTTP).
- `npm run test:embedded` : 13 scénarios dans deux suites (15 entrées au total), avec PGlite et un vrai Redis. Les cinq nouveaux scénarios vérifient deux instances API/WebSocket, deux joueurs, les notifications inter-instances, les réponses masquées, la reconnexion, la clôture automatique sans polling HTTP, l'unicité des récompenses, les origines refusées, l'accès hors salle et une session révoquée.
- Flutter 3.47.7 / Dart 3.13.5 : analyse statique et huit tests API/widgets, incluant le parcours téléphone/OTP, la rotation unique du refresh token, les écrans de salle/question/correction/fin sur une largeur de 360 pixels et le rejet des états anciens.

- `flutter build web --no-web-resources-cdn` : compilation réussie, y compris le contrôle de compatibilité Wasm. Avertissement de police Cupertino non embarquée (aucune icône Cupertino utilisée par le client).

## Limites de validation

PGlite sérialise ses accès ; ces tests ne prouvent pas la concurrence PostgreSQL multi-connexion. La suite PostgreSQL natif et Redis ainsi que le workflow CI sont fournis mais n'ont pas été exécutés sur GitHub. Aucun SMS/WhatsApp réel n'a été envoyé. Aucun APK/IPA n'a été compilé ou signé.

Le scénario Playwright à deux contextes est fourni, mais n'a pas pu être exécuté : les téléchargements Chromium et Chromium Headless Shell ont retourné des archives invalides dans cet environnement. Les tests de widgets ne remplacent pas la validation sur deux navigateurs ou deux appareils physiques.
