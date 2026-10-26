# Architecture technique

Ce document décrit le système cible, qui n'est pas encore développé. Les prototypes du dossier `prototypes/` simulent le serveur dans le navigateur : la logique de jeu y est la même que celle visée côté serveur.

## Principes

1. **Le serveur fait autorité sur tout** : il génère la grille, valide les mots, attribue les points et diffuse l'état. Le client affiche et transmet des saisies, rien de plus.
2. **Les solutions ne quittent jamais le serveur.** Le client reçoit la structure de la grille (cases, définitions, jumelles, cases du mot mystère) et seulement les lettres déjà trouvées.
3. **Chaque droit est vérifié par l'API** (joueur, modérateur, admin). L'interface ne fait que masquer les boutons.
4. **Rien n'est effacé pour de bon** : les suppressions sont logiques et toutes les actions d'administration sont tracées.

## Stack envisagée

| Couche | Choix | Rôle |
| --- | --- | --- |
| Client | HTML/CSS/JS léger, puis PWA | Interface PC et mobile, clavier intégré sur mobile |
| Temps réel | Node.js + Socket.IO (ou Colyseus) | Salons, diffusion de l'état, chronomètre de la dernière chance |
| API | Node.js (Fastify ou Express) | Définitions, modération, administration, thèmes |
| État des salons | Redis | Parties en cours, limite de fréquence, reconnexion |
| Données | PostgreSQL | Définitions, thèmes, joueurs, parties, journal |
| Hébergement | VPS Debian, reverse proxy en HTTPS | Le HTTPS est obligatoire pour la PWA et les WebSockets sécurisés (`wss://`) |

## Temps réel : messages d'une partie

### Client → serveur

| Message | Contenu | Contrôles côté serveur |
| --- | --- | --- |
| `room:create` | pseudo, réglages (thèmes, mode, score de départ, pénalités, délai de dernière chance) | — |
| `room:join` | code, pseudo | salon existant, 8 joueurs au maximum, pseudo unique dans le salon |
| `game:start` | — | réservé au créateur du salon |
| `word:submit` | id du mot, lettres tapées | une tentative par seconde ; mot encore libre ; joueur pas encore verrouillé par la dernière chance |
| `mystery:submit` | lettres tapées | grille remplie à 80 % ou plus ; une seule proposition par joueur |

### Serveur → clients

| Message | Contenu |
| --- | --- |
| `room:state` | joueurs, réglages, statut du salon |
| `game:grid` | structure de la grille, **sans les solutions** |
| `word:found` | id du mot, joueur, lettres révélées, jumelles et combos déclenchés, points |
| `word:wrong` | envoyé au seul joueur concerné : la pénalité |
| `mystery:result` | juste ou faux, points |
| `final:start` | mode Dernière chance : joueur qui a trouvé, heure de fin, joueurs attendus |
| `game:over` | raison, classement, détail des scores, grille complète **avec** les solutions |

**Conflits** : si deux joueurs valident le même mot presque en même temps, le premier message traité gagne. Le second reçoit « déjà trouvé », sans pénalité.

**Reconnexion** : un téléphone coupe la connexion dès que l'onglet passe en arrière-plan. À la reconnexion, le serveur renvoie l'état complet : grille, lettres trouvées, scores et chronomètre.

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
- Durée : de 0,3 à 0,8 s sur un PC.
- Pour aller plus loin : des grilles pré-générées en tâche de fond, et une banque de mots courants bien plus large.

## Sécurité et limites

- Une tentative de mot par seconde et par joueur, appliquée par le serveur via Redis.
- Codes de salon aléatoires et non séquentiels, et expiration des salons inactifs.
- Échappement de tout texte venant des joueurs : pseudos, définitions, explications, noms de thèmes.
- Les solutions ne transitent jamais vers le client avant la fin de la partie.
