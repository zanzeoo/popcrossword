# Journal des décisions

Les choix faits pendant la conception, dans l'ordre où ils ont été pris. Le document de référence reste [conception.md](conception.md).

## Concept et mode de jeu

| Décision | Détail |
| --- | --- |
| Mode **compétition** d'abord | Les modes coopération et grille du jour sont reportés. |
| **Salons privés** uniquement | Rejoints par un code. Pas de grille partagée par des milliers de joueurs pour l'instant. |
| **Pseudo** sans compte | Pour la première version. |
| **2 à 8 joueurs** par salon | La grille reste en 10 × 13 même à 8 : les parties sont plus courtes et plus nerveuses. |
| **Temps de résolution** enregistré | Pour chaque partie. |
| Variante **« Dernière chance »** | Dès que le mot mystère est trouvé, chaque autre joueur a un seul essai (mot de la grille ou mot mystère), avec un compte à rebours, puis la partie s'arrête. |

## Grille

| Décision | Détail |
| --- | --- |
| **10 × 13** en portrait | Tient sur un téléphone sans défilement horizontal. |
| Thèmes mélangés, **dosage par curseurs** | Le total fait toujours 100 %. |
| Ajout du thème **jeux vidéo** | Aux côtés des films, dessins animés, musique, personnages et sagas. |
| **Chiffres exclus** des réponses | Une grille de lettres seulement (pas de R2D2 ni de K2000). |
| **Tirets autorisés** | Affichés comme un trait entre deux cases, sans case dédiée. |
| Moins de cases vides | Mots adjacents autorisés quand chaque suite de lettres formée est un mot, flèches coudées sur les bords, et une banque de mots courants élargie. |
| Définitions **factuelles** autorisées | À côté des jeux de mots (« Auteur du Seigneur des anneaux »). |

## Saisie et score

| Décision | Détail |
| --- | --- |
| Validation **par mot entier** | Pas lettre par lettre. |
| On tape le mot **en entier** | Lettres déjà trouvées comprises : plus simple et plus rapide qu'une saisie limitée aux trous. |
| **Pénalités** pour les erreurs | Score de départ identique pour tous, et score jamais négatif. |
| **Limite de fréquence** | Une tentative par seconde, appliquée par le serveur et invisible pour le joueur. |
| Barème selon la **longueur** et la **difficulté** | Fond rouge pour les définitions difficiles. Barème définitif à revoir. |
| Bonus **« mot vierge »** | Une lettre venant d'un croisement ou d'une jumelle le supprime. |
| **Scores en direct** et **récapitulatif** | Avec la possibilité de **revoir la grille** en fin de partie. |

## Cases jumelles et mot mystère

| Décision | Détail |
| --- | --- |
| **2 paires** de jumelles par grille | Révéler une case révèle l'autre. Les deux lettres peuvent être différentes. |
| Repérage par **symbole en filigrane** | ★ et ◆. Les couleurs ont été abandonnées, car trop faciles à confondre. |
| **Prime** et **combo** | Pour celui qui déclenche la paire. |
| Jumelles **dans des mots différents** | Et jamais sur le mot mystère. |
| Mot mystère **dans le thème** | Proposable **à partir de 80 %** de grille remplie, avec une proposition par joueur. |
| Saisie dédiée du mot mystère | Le clavier bascule vers ses cases. Ajoutée après un retour de test : la première version, avec un champ de texte, prêtait à confusion. |

## Plateforme et interface

| Décision | Détail |
| --- | --- |
| Validation du concept **sur PC d'abord** | Puis adaptation au mobile. |
| Mobile : **clavier intégré** | Les cases n'affichent que les flèches, et la définition s'affiche dans un bandeau. |
| Mobile : **ligne d'info** au-dessus de la grille | Plutôt que des notifications qui masquaient des cases. |
| **8 couleurs** de joueurs | Distinctes de la sélection, des erreurs et des cases de définition. |
| Prototype hébergé sur un **VPS Debian** | En HTTPS. |

## Définitions de la communauté et administration

| Décision | Détail |
| --- | --- |
| **Éditeur de définitions** pour les joueurs | Réponse de 2 à 10 lettres, définition de 40 caractères maximum, thème, difficulté sur 4 niveaux et explication. |
| **Modération** avant publication | Validation, ou refus avec un commentaire. |
| **Base de données serveur** nécessaire | PostgreSQL, voir [architecture.md](architecture.md). |
| Rôle **admin** | Il consulte toute la base, la filtre et l'exporte. |
| L'admin **crée et gère les thèmes** | Création, renommage, activation, suppression d'un thème vide. |
| L'admin **modifie et supprime** toute définition | Suppression **logique** et restaurable, avec un journal des actions. |
