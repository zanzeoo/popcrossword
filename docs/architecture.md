# Architecture technique

Ce document décrit le système en place sur le VPS. La racine du site aiguille vers le client PC (`client/pc/`) ou mobile (`client/mobile/`, une PWA) ; les deux partagent leur logique dans `client/shared/core.js` et ne diffèrent que par l'affichage. Les prototypes hors ligne restent servis sous `/proto/`. `GET /api/themes` donne les thèmes actifs et leur nombre de mots, pour les curseurs du salon.

## Principes

1. **Le serveur fait autorité sur tout** : il génère la grille, valide les mots, attribue les points et diffuse l'état. Le client affiche et transmet des saisies, rien de plus.
2. **Les solutions ne quittent jamais le serveur.** Le client reçoit la structure de la grille (cases, définitions, jumelles, cases du mot mystère) et seulement les lettres déjà trouvées.
3. **Chaque droit est vérifié par l'API** (joueur, modérateur, admin). L'interface ne fait que masquer les boutons.
4. **Rien n'est effacé pour de bon** : les suppressions sont logiques et toutes les actions d'administration sont tracées.

## Stack envisagée

| Couche | Choix | Rôle |
| --- | --- | --- |
| Client | HTML/CSS/JS sans build ; PWA sur mobile | Interface PC et mobile, clavier intégré sur mobile. Le service worker ne met en cache que l'interface, jamais l'API ni le temps réel |
| Temps réel | Node.js + Socket.IO (ou Colyseus) | Salons, diffusion de l'état, chronomètre de la dernière chance |
| API | Node.js (Fastify ou Express) | Définitions, modération, administration, thèmes |
| État des salons | Mémoire du process + Redis | État en mémoire, sauvegardé dans Redis ; limite de fréquence ; jetons de reconnexion |
| Données | PostgreSQL | Définitions, thèmes, joueurs, parties, journal |
| Hébergement | VPS Debian, reverse proxy en HTTPS | Le HTTPS est obligatoire pour la PWA et les WebSockets sécurisés (`wss://`) |

## Temps réel : messages d'une partie

Implémenté dans `server/src/rooms/` : `rooms.js` (salons et messages), `rules.js` (règles du prototype : score, jumelles, combos, mot mystère, dernière chance), `store.js` (Redis), `persist.js` (enregistrement en base). Tests : `npm test`.

Chaque message client reçoit un accusé : `{ ok: true, ... }` ou `{ ok: false, error, message }`, où `error` est un code stable (`pseudo_pris`, `trop_rapide`, `deja_trouve`…) et `message` un texte prêt à afficher.

### Client → serveur

| Message | Contenu | Contrôles côté serveur |
| --- | --- | --- |
| `room:create` | pseudo, réglages (facultatifs) | pseudo de 1 à 12 caractères ; réglages valides. Renvoie le code et un **jeton de session** |
| `room:join` | code, pseudo | salon existant et en attente, 8 joueurs au maximum, pseudo unique dans le salon. Renvoie un jeton |
| `room:resume` | jeton | reconnexion : renvoie l'état complet (`room:state`, puis `game:grid` ou `game:over`) |
| `room:settings` | réglages partiels | créateur seulement, salon en attente |
| `room:leave` | — | en attente, libère la place (le créateur passe la main) ; en partie, le joueur reste au classement |
| `game:start` | — | créateur seulement, 2 joueurs au minimum |
| `word:submit` | `word` (index), `letters` | une tentative par seconde (Redis) ; mot encore libre ; joueur pas verrouillé par la dernière chance |
| `mystery:submit` | `letters` | grille remplie à 80 % ou plus ; une seule proposition par joueur ; bonne longueur |

Réglages : `mode` (`classique` ou `derniere_chance`), `startScore` (0-1000), `penWord` et `penMyst` (0-500), `lastTime` (5-120 s), `weights` (thème actif → poids de 0 à 100).

### Serveur → clients

| Message | Destinataires | Contenu |
| --- | --- | --- |
| `room:state` | salon | code, statut (`lobby`, `starting`, `playing`, `over`), créateur, réglages, joueurs (couleur, connecté ou non) |
| `game:grid` | chaque joueur | structure de la grille **sans les solutions**, lettres déjà révélées, mots trouvés, scores, dernière chance, état du joueur |
| `word:found` | salon | mot, joueur, points, bonus vierge, jumelles, combos, lettres révélées, scores |
| `word:wrong` | le joueur seul | pénalité et nouveau score |
| `room:scores` | salon | scores après une pénalité |
| `mystery:result` | salon | joueur, juste ou faux, points (la proposition elle-même n'est pas diffusée) |
| `final:start` | salon | joueur qui a trouvé, heure de fin, joueurs attendus |
| `final:update` | salon | joueur qui vient de jouer son essai, joueurs encore attendus |
| `game:over` | salon | raison, durée, classement avec le détail des scores, grille complète **avec** les solutions |

**Conflits** : si deux joueurs valident le même mot presque en même temps, le premier message traité gagne. Le second reçoit `deja_trouve`, sans pénalité.

**Reconnexion** : le client garde le jeton de session (valable 6 h) et l'envoie avec `room:resume` à chaque reconnexion.

**Redémarrage du service** : chaque salon est sauvegardé dans Redis à chaque changement et rechargé au démarrage ; le compte à rebours de la dernière chance est réarmé.

**Ménage** : un salon sans joueur connecté depuis 30 min est supprimé, ainsi qu'un récapitulatif de plus de 2 h.

**Origine** : le serveur refuse les connexions WebSocket venant d'une autre origine que `PUBLIC_ORIGIN` (par défaut `https://popcrossword.zanzeoo.fr`).

## API REST : définitions et administration

| Méthode et route | Rôle minimum | Effet |
| --- | --- | --- |
| `POST /api/definitions` | joueur | proposer une définition (statut `en_attente`) |
| `GET /api/definitions/mine` | joueur | ses propositions et leurs statuts |
| `GET /api/moderation?statut=en_attente` | modérateur | file de modération |
| `POST /api/moderation/:id/valider` | modérateur | valider, éventuellement en changeant la difficulté |
| `POST /api/moderation/:id/refuser` | modérateur | refuser avec un commentaire |
| `GET /api/admin/definitions` | admin | toute la base, avec recherche, filtres et pagination |
| `PATCH /api/admin/definitions/:id` | admin | modifier une définition |
| `DELETE /api/admin/definitions/:id` | admin | suppression logique |
| `POST /api/admin/definitions/:id/restaurer` | admin | annuler une suppression |
| `GET/POST/PATCH/DELETE /api/admin/themes` | admin | gérer les thèmes |
| `GET /api/admin/export.csv` | admin | exporter la sélection |

Chaque modification ou suppression faite par un modérateur ou un admin écrit une ligne dans la table `journal` : qui, quoi, quand, et les valeurs avant et après.

## Base de données

Le schéma proposé se trouve dans [`../db/schema.sql`](../db/schema.sql). Ses tables principales :

- `joueurs` : pseudo et rôle (`joueur`, `moderateur`, `admin`).
- `themes` : nom et état actif. « Mot courant » est un thème système.
- `definitions` : réponse, texte, thème, difficulté, explication, statut, auteur, modérateur et commentaire, plus `supprimee_le` pour la suppression logique. La banque intégrée des prototypes y sera importée avec la source `integree`.
- `parties` et `participations` : durée, mode, mot mystère et scores détaillés.
- `stats_definitions` : apparitions et taux de réussite, pour recalibrer la difficulté.
- `journal` : traçabilité des actions de modération et d'administration.

### Migration depuis les prototypes

L'écran de modération du prototype PC exporte les propositions en JSON, et l'administration exporte la base en CSV. Un script d'import permettra d'amorcer PostgreSQL avec la banque intégrée (environ 500 définitions) et les propositions faites pendant les tests.

## Génération des grilles

- Elle se fait côté serveur, au lancement de la partie, à partir des définitions validées, non supprimées et dont le thème est actif.
- Elle respecte le dosage des thèmes choisi dans le salon.
- Algorithme du prototype :
  1. placement glouton par croisements, la pop culture d'abord ;
  2. une passe qui bouche les trous ;
  3. des mots adjacents autorisés quand chaque suite de lettres formée est un mot de la banque ;
  4. des flèches coudées sur les bords ;
  5. 30 essais, en gardant la grille la plus dense.
- Durée : de 0,3 à 0,8 s sur un PC, de 0,7 à 1,2 s sur le VPS (2 cœurs).
- Implémentation : `server/src/game/generator.js` (port à l'identique du prototype). Le calcul tourne dans un thread permanent (`grid.js`, `worker.js`) pour ne pas bloquer les salons ; les demandes simultanées sont traitées l'une après l'autre. `publicGrid()` produit la version envoyée aux joueurs, sans les solutions.
- Vérification : `npm run grid-preview -- 20` génère 20 grilles avec la banque en base, contrôle leur cohérence et affiche la dernière.
- Pour aller plus loin : des grilles pré-générées en tâche de fond, et une banque de mots courants bien plus large.

## Sécurité et limites

- Une tentative de mot par seconde et par joueur, appliquée par le serveur via Redis.
- Codes de salon aléatoires et non séquentiels, et expiration des salons inactifs.
- Échappement de tout texte venant des joueurs : pseudos, définitions, explications, noms de thèmes.
- Les solutions ne transitent jamais vers le client avant la fin de la partie.
