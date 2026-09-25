# Synchronisation du compte

La connexion au même compte Prior active la synchronisation navigateur/native. Les données anonymes restent locales jusqu'à leur rattachement au compte. Les opérations de synchronisation vérifient le compte après chaque réponse réseau pour éviter d'appliquer une réponse à une autre session.

| Données | Persistance et synchronisation |
| --- | --- |
| Tâches et habitudes | SQLite natif/localStorage navigateur, outbox existante, historique paginé PostgreSQL |
| Espaces, projets, dossiers, notes | Stockage local et snapshots PostgreSQL avec dates de modification |
| Calendriers personnels et événements | Documents par calendrier/événement, patches de champs, outbox persistante |
| Répétitions, exceptions, couleurs, verrous | Champs des événements ou préférences d'import séparées |
| Imports Google et abonnements ICS | Configuration synchronisée ; événements sources en lecture seule, cache par appareil |
| Fichiers ICS importés | Texte ICS sauvegardé dans un document synchronisé |
| Masquages et règles de titre | Préférences synchronisées, sans écriture chez le fournisseur |
| Pièces jointes des notes | IndexedDB local, envoi authentifié PostgreSQL, métadonnées synchronisées, téléchargement à l'ouverture (8 Mio par fichier) |
| Discussions IA | Historique serveur, file locale durable avec identifiants de chat/message idempotents |
| Modèle IA, fournisseur, raisonnement | Documents du compte |
| Clés API et recherche web | Route settings existante, marqueur local d'envoi en attente ; une suppression sur le serveur ne réimporte pas une ancienne clé locale. La clé OpenRouter des recommandations Aujourd'hui est facultative et utilise la clé principale si elle est vide |
| Langue, panneaux et navigation des notes | Préférences du compte |
| Profil, collaboration, comptes mail/Google | Routes serveur existantes |

Les jetons de session, accès Codex natif, permissions système, téléchargements, diagnostics et caches restent propres à l'appareil. Une opération externe (envoi mail, appel IA, connexion OAuth) nécessite toujours une connexion ; ce document ne promet pas leur exécution hors ligne.

## Convergence et reprise

Les tâches et habitudes conservent leur protocole existant : snapshots complets dans l'outbox, UUID de mutation idempotents et révisions PostgreSQL. Les pulls paginés incluent les suppressions. Tant qu'une tâche a une mutation locale en attente, les snapshots distants ne l'écrasent pas. La migration des données antérieures à l'outbox est marquée par compte après acceptation de tous les lots. Les espaces/projets/dossiers/notes restent dans leurs tables relationnelles ; leurs snapshots fusionnent les éléments par `updatedAt` avec tombstones, sans remplacer un workspace par celui d'un appareil vide.

`POST /v1/account-data/sync` accepte jusqu'à 100 mutations par lot. Chaque mutation a un UUID et un patch JSON par document. L'écriture serveur et les accusés de réception sont transactionnels, sérialisés par compte ; les reprises ne rejouent pas les mutations déjà confirmées. La réponse contient les documents et les suppressions. Le client conserve les changements ajoutés pendant la requête et les réapplique après la réponse.

Deux modifications de champs différents d'un même événement se combinent. Pour le même champ, la dernière mutation reçue par le serveur gagne. Les séries et leurs listes d'exceptions sont des champs indivisibles. Les suppressions d'événements et calendriers gardent un tombstone : une vieille copie hors ligne ne les recrée pas. Une nouvelle entité reçoit un nouvel identifiant. Les règles et préférences d'import ont un état activé/désactivé pour permettre leur réactivation.

La synchronisation démarre à la connexion, sur les modifications locales, au retour en ligne/au premier plan, sur notification temps réel et périodiquement lorsque l'app est visible. Une panne conserve l'outbox. Les calendriers et préférences se synchronisent avant les tâches : une erreur de tâche ne bloque plus ces documents. Les préférences reçues s'appliquent même si le workspace échoue. Les logs et l'interface signalent les sections encore en attente et ne déclarent pas un succès complet si une section a échoué. La vue « Plus » sur téléphone permet de relancer la synchronisation. Les snapshots de workspace inchangés ne provoquent plus une boucle de notifications entre appareils.

Lors d'un changement de compte, les réponses réseau et les écritures SQLite sont vérifiées contre l'identifiant de compte qui a lancé le cycle. Les clés de recommandations sont conservées lorsque d'anciennes versions du client enregistrent leurs paramètres sans ce champ ; une chaîne vide explicite les efface.

## Incident de synchronisation des tâches planifiées

La lecture PostgreSQL de `task_changes.scheduled_date` et `follow_up_date` (`DATE`) dans des champs Go `*string` pouvait faire échouer tout le pull. L'ancien ordre du cycle empêchait alors le transfert des calendriers et des espaces. Le pull convertit désormais ces colonnes en texte ISO et chaque domaine poursuit son cycle indépendamment. Le curseur des tâches n'avance qu'après l'application des données reçues ; une panne laisse les mutations locales en attente ou récupérables au prochain pull.

Les pièces jointes sont immuables par UUID et accessibles uniquement à leur propriétaire. Les anciens blobs locaux sont repris lors du prochain envoi. La suppression d'une note conserve actuellement ses blobs serveur ; la collecte des fichiers orphelins et le stockage objet pour gros fichiers restent à prévoir.

## Déploiement et tests

Déployer l'API avec les migrations additives/idempotentes `021_account_documents.sql` et `022_recommendation_settings.sql` avant d'utiliser la nouvelle synchronisation en production. Un ancien serveur retourne 404 sur les routes des documents : les changements restent locaux en attente. La release client et le déploiement Coolify sont indépendants.

Les tests clients couvrent la reprise réseau, les changements en cours d'envoi, les comptes, la migration, les caches, les filtres, la suppression de clés et les messages en attente. Les tests PostgreSQL créent des schémas isolés et vérifient aussi les dates de tâches planifiées et la compatibilité des anciens clients avec la nouvelle clé. Exécution locale explicite : `PRIOR_TEST_DATABASE_URL=... go test ./internal/store -v`. La CI utilise son propre PostgreSQL éphémère. Aucun test par computer use.
