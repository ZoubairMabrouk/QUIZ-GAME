# Activation SMS et WhatsApp

## Fournisseur retenu

Twilio Verify gère l’envoi et la vérification. L’application ne génère ni ne stocke le code OTP réel. L’adaptateur se trouve dans `src/otp-provider.js` et pourra être remplacé sans changer les comptes ou les salles.

1. Créer le compte Twilio et un service Verify.
2. Récupérer Account SID, Auth Token et Verify Service SID. Les conserver côté serveur uniquement.
3. Activer SMS et les permissions géographiques nécessaires. En compte d’essai, le fournisseur impose des restrictions sur les destinataires ; les vérifier dans la console.
4. Pour WhatsApp : enregistrer un expéditeur associé à votre compte WhatsApp Business (WABA), l’associer à un Messaging Service et sélectionner ce service dans la configuration WhatsApp du service Verify. Suivre la validation et les modèles d’authentification requis par Twilio/Meta.
5. Renseigner `.env`, passer `OTP_PROVIDER=twilio`, puis recréer le conteneur API.
6. Lancer `npm run demo`, choisir votre propre numéro et le canal, puis saisir le code reçu. Cette opération réelle est à effectuer après configuration ; les tests automatiques n’envoient rien.

Le choix SMS/WhatsApp est explicite. Aucun repli automatique vers SMS n’est déclenché : il pourrait occasionner un deuxième envoi et doit être une action voulue du joueur. Une nouvelle demande sur l’autre canal est possible après le délai de renvoi, sous réserve des quotas communs.

## API

Demande : `POST /auth/otp/request`

```json
{"phone":"+33612345678","channel":"sms","consent":true}
```

Réponse 202 : `challengeId`, `expiresIn: 300`, `resendAfter: 60`, `channel`. Aucun code dans la réponse. Une demande acceptée par le fournisseur ne prouve pas encore la livraison du message.

Vérification : `POST /auth/otp/verify`

```json
{"challengeId":"UUID renvoyé par la demande","code":"code reçu"}
```

Réponse : profil masqué, `accessToken`, `refreshToken`, dates d’expiration. Fournir `Authorization: Bearer <accessToken>` pour le portefeuille et les salles. Les numéros sont uniques : un joueur déjà inscrit retrouve son compte et son pseudo.

Renouvellement : `POST /auth/refresh` avec `{"refreshToken":"..."}`. Remplacer atomiquement les deux jetons côté client ; ne jamais relancer une requête de rotation avec un ancien refresh. Le rejeu révoque la famille, y compris son dernier jeton.

Déconnexion : `POST /auth/logout`, corps `{}`, jeton d’accès courant. Pour un futur client Flutter, utiliser le stockage sécurisé de la plateforme. Pour un client Web, concevoir un échange via cookies HttpOnly/Secure avec protection CSRF avant publication ; cette livraison fournit l’API bearer et le script CLI, pas cette couche navigateur.

## Limites configurées

- Code valide localement pendant 5 minutes, même si le fournisseur propose une durée supérieure.
- 60 secondes entre demandes du même numéro, tous canaux confondus.
- 5 demandes par numéro/heure ; 20 par adresse IP/heure.
- 5 essais de code par challenge ; 15 par numéro/heure ; 50 par IP/10 minutes.
- Budget d’envois global : `OTP_GLOBAL_DAILY_LIMIT` (1000 par défaut), fenêtre de 24 heures démarrant au premier essai.
- Les essais infructueux consomment le quota ; les budgets Redis ne remplacent pas les limites de dépenses et mécanismes anti-fraude du fournisseur.

## Vérifications réelles restant à faire

Tester SMS et WhatsApp sur les opérateurs/pays retenus, livraison tardive, compte d’essai, quotas fournisseur, erreur d’expéditeur WhatsApp et reprise après indisponibilité. Aucune capacité de livraison réelle n’a été déclarée validée dans cette archive.

## Documentation officielle consultée

- https://www.twilio.com/docs/verify/api/verification
- https://www.twilio.com/docs/verify/api/verification-check
- https://www.twilio.com/docs/verify/whatsapp/byo

Consultation : 22 octobre 2026. La configuration de votre compte et les exigences des opérateurs doivent être vérifiées lors de l’activation.
