# Consignes de revue de sécurité

Applique ces vérifications aux changements de code, de configuration, de migrations et de dépendances. Concentre les constats sur les vulnérabilités exploitables introduites par le diff ; ne signale pas une faiblesse théorique sans chemin d'attaque concret.

## Points de contrôle spécifiques au projet

- **Authentification et sessions** : vérifie les contrôles d'autorisation sur chaque route et commande, la séparation des audiences joueur et administration, le stockage des empreintes de jetons plutôt que des jetons en clair, leur expiration, leur rotation et la révocation des familles. Une validation de format de téléphone ne prouve pas sa possession ; seul le résultat OTP approuvé le fait.
- **OTP et secrets fournisseur** : vérifie les quotas par téléphone/IP/global, les délais d'envoi, l'expiration et l'usage unique des codes, les protections contre les courses et le fait que les codes, numéros, jetons et identifiants fournisseur ne soient ni exposés au client ni écrits dans les logs. Le mode mock ne doit pas authentifier de joueur en production.
- **WebSocket et temps réel** : vérifie l'authentification initiale et son délai, le contrôle d'appartenance à la salle à chaque abonnement/commande, la validation des origines et des messages, ainsi que l'absence de jeton dans les URL ou les logs. Les vues poussées ne doivent révéler ni réponses privées d'autres joueurs ni corrections avant leur publication par le serveur.
- **PostgreSQL et migrations** : recherche l'injection SQL, les contrôles d'accès incomplets, les changements non atomiques et les courses sur les sessions, salles, récompenses ou soldes. Les mutations de portefeuille, ledger, classement et partie doivent respecter les transactions, verrous, idempotence et contraintes existantes. Ne suppose pas que les triggers remplacent un rôle SQL d'application aux privilèges minimaux.
- **Redis et limites** : vérifie les TTL, les opérations atomiques et la propriété des verrous ; une panne ou une donnée absente ne doit pas contourner l'authentification, les quotas ou les règles métier. N'assume pas que Redis Cluster est compatible avec les scripts multi-clés existants sans vérification.
- **Configuration et déploiement** : recherche les secrets committés, les valeurs par défaut dangereuses, l'exposition involontaire de ports ou de données et la confiance indue envers les en-têtes proxy. Les paramètres Compose locaux ne constituent pas une configuration de production.
- **Client, administration et données** : vérifie la validation des entrées côté serveur, l'encodage des sorties, les permissions d'administration et l'exposition minimale des données personnelles. Considère les fichiers importés, notamment CSV, comme non fiables.
- **Dépendances et CI** : évalue si un changement de dépendance ou de workflow introduit une vulnérabilité, expose des secrets ou exécute du code non fiable avec des permissions excessives. Distingue le risque avéré d'une simple absence d'outil d'analyse.

Pour les garanties actuelles et les limites connues, consulte `docs/ARCHITECTURE_V2.md`, `docs/ETAPE_3.md`, `docs/ADMIN_AUTH.md` et `docs/LOT1_REALTIME.md`. Ne présente pas comme vulnérabilité nouvelle un élément déjà documenté comme limitation, sauf si le changement l'aggrave ou crée un nouveau chemin d'exploitation.

## Format des constats

Présente d'abord les vulnérabilités, de la gravité la plus élevée à la plus faible. Pour chacune, donne :

1. **Gravité** : critique, élevée, moyenne ou faible, proportionnelle à l'impact et aux préconditions.
2. **Emplacement** : chemin et lignes concernés dans le diff.
3. **Problème et impact** : explique le chemin d'exploitation et les conséquences de façon concise.
4. **Preuve** : précise les préconditions et le comportement du code qui rendent le constat vérifiable.
5. **Correction attendue** : indique le changement minimal permettant de supprimer le risque.

Ne révèle jamais de secrets dans le rapport. Ne recommande pas de tester une vulnérabilité sur un système tiers ou en production. Si aucun problème n'est établi, indique qu'aucun constat de sécurité n'a été identifié et précise les vérifications pertinentes effectuées.
