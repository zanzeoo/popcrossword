# Document de conception — Mots Cultes

Document de référence des règles et de l'interface. Les valeurs chiffrées (points, pénalités, délais) sont celles des prototypes ; elles seront ajustées après les tests.

## 1. Concept

Un jeu de mots fléchés multijoueur en ligne, en compétition, dont les réponses portent sur la pop culture des années 80, 90 et 2000.

- **Thèmes** : films, dessins animés, musique, jeux vidéo, personnages fictifs, sagas et lore. Ils sont mélangés dans chaque grille, avec un dosage réglable, et un admin peut en créer de nouveaux.
- **Plateforme** : navigateur web, sans installation. Le jeu doit être **pleinement jouable sur mobile**. Le prototype a commencé par le PC, plus simple pour valider le concept.
- **Principe** : plusieurs joueurs remplissent la même grille en temps réel ; chacun marque des points pour les mots qu'il trouve.
- **Identité** : des définitions à jeux de mots, des répliques détournées et des références, à côté de définitions plus factuelles (« Auteur du Seigneur des anneaux » → TOLKIEN).

## 2. Salon et déroulement d'une partie

Le seul mode de la première version est la **compétition en temps réel, en salon privé**.

1. Un joueur choisit un **pseudo** (pas de compte) et crée un salon. Il reçoit un **code à 4 caractères** à partager.
2. Les autres joueurs saisissent leur pseudo et rejoignent le salon avec ce code : **jusqu'à 8 joueurs**. Le créateur peut aussi lancer la partie seul.
3. Le créateur règle le salon :
   - le **dosage des thèmes**, par curseurs dont le total fait toujours 100 % ;
   - le **mode de jeu** : Classique ou Dernière chance ;
   - le **score de départ** et les **pénalités**.
4. Il lance la partie : tous reçoivent la même grille au même moment.
5. Chaque mot est attribué au **premier joueur qui le valide**, et il apparaît rempli pour tout le monde.
6. En fin de partie, un **récapitulatif** s'affiche, avec la possibilité de **revoir la grille**.

Le **temps de résolution** de chaque partie est enregistré.

### Modes de fin de partie

| Mode | Fin de la partie |
| --- | --- |
| **Classique** | Quand toutes les cases lettres sont remplies. |
| **Dernière chance** | Dès qu'un joueur trouve le mot mystère, chacun des autres a droit à **un seul essai** : un mot de la grille, ou le mot mystère s'il n'a pas encore utilisé sa proposition. Un compte à rebours se lance (20 s par défaut, réglable). La partie s'arrête quand tout le monde a joué ou quand le temps est écoulé. |

Pendant la dernière chance, un bandeau orange indique qui a trouvé le mot mystère, le temps restant et les joueurs encore attendus. Une fois son essai joué, le joueur ne peut plus rien saisir.

## 3. La grille

Format unique : **10 colonnes × 13 rangées, en portrait**.

| Élément | Règle |
| --- | --- |
| Largeur | 10 colonnes : la grille tient sur un écran de téléphone sans défilement horizontal. |
| Longueur des mots | 2 à 10 lettres. |
| Cases de définition | Une ou deux définitions par case, chacune avec sa flèche. |
| Flèches coudées | Sur la première ligne et la première colonne, la définition peut être placée à côté du mot (→ puis ↓, ou ↓ puis →), comme dans les mots fléchés classiques. |
| Mots qui se touchent | Deux mots parallèles peuvent être collés, à condition que chaque suite de lettres ainsi formée soit elle-même un mot, avec sa propre définition. |
| Cases vides | Les trous restants sont foncés. Il en reste environ 20 par grille avec la banque actuelle ; il faudra une banque de plusieurs milliers de mots pour une grille sans trou. |
| Thèmes | Mélangés selon le dosage du salon. Les mots courants (« Mot courant ») servent au remplissage et ne comptent pas dans les pourcentages. |

### Conventions d'écriture

- Réponses en **majuscules, sans accents**. Les espaces sont supprimés (RETOURVERSLEFUTUR).
- Les **tirets** sont autorisés : ils s'affichent comme un trait épais entre deux cases, sans occuper de case, et le joueur ne les tape pas (SPIDER-MAN = 9 cases).
- Les réponses contenant des **chiffres** (R2D2, K2000) sont **exclues**.

### Générateur (prototype)

- La banque contient environ 500 définitions : environ 180 de pop culture et 330 mots courants.
- La pop culture est placée en premier, en respectant le dosage des thèmes, puis les mots courants comblent les trous.
- Le générateur fait plusieurs essais et garde la grille la plus dense.
- Il place ensuite le mot mystère et les deux paires de jumelles.
- Résultat moyen : environ 81 cases lettres sur 130, et 35 mots dont 18 de pop culture.

## 4. Saisie et validation

- **Validation par mot entier**, jamais lettre par lettre. Le joueur tape le mot **en entier, lettres déjà posées comprises** : le curseur parcourt toutes les cases du mot.
- Dans le mot sélectionné, les lettres déjà posées s'affichent en filigrane. Une lettre tapée qui contredit une lettre connue s'affiche en rouge, ce qui permet de corriger avant de valider.
- Un mot incomplet n'est pas soumis et ne coûte rien.
- **Limite de fréquence** : une tentative par seconde, invisible pour le joueur, pour bloquer les scripts.

## 5. Score

| Élément | Valeur dans le prototype |
| --- | --- |
| Score de départ, identique pour tous | 100 points |
| Lettre d'un mot trouvé | 10 points |
| Définition Difficile ou Expert | Points du mot × 2 |
| Bonus « mot vierge » | +20 |
| Prime de case jumelle | +20 par jumelle révélée |
| Mot mystère juste | +100 |
| Mot faux | −10 |
| Mot mystère faux | −30 |

- Le **score ne descend jamais sous zéro**.
- Le score de départ et les deux pénalités se règlent dans le salon.
- **Bonus « mot vierge »** : il s'applique quand aucune lettre du mot n'était posée. Une lettre posée par un croisement, ou révélée par une jumelle, le supprime.
- **Croisement** : quand une validation complète un autre mot, ce mot est attribué au même joueur, sans bonus vierge.
- Les **définitions difficiles** ont un fond rouge dans leur case et dans le panneau de définition.
- **Le barème est à revoir**, en particulier pour les quatre niveaux de difficulté : Facile, Moyen, Difficile, Expert.

### Affichage des scores

- **Scores en direct** : sur PC, un classement en colonne ; sur mobile, des pastilles sur une ou deux rangées de 4.
- **Fil de la partie** : qui a trouvé quoi, les erreurs, les jumelles et le mot mystère.
- **Récapitulatif** de fin de partie :
  - la raison de la fin, le temps et le nombre de mots trouvés ;
  - le mot mystère et les joueurs qui l'ont trouvé ;
  - pour chaque joueur : score de départ, mots, bonus vierge, primes jumelles, combos et croisements, mot mystère et pénalités ;
  - la grille finale, colorée par joueur ;
  - la répartition réelle des thèmes comparée à celle demandée.

## 6. Cases jumelles

Chaque grille contient **2 paires** de cases jumelles. Quand l'une est révélée, sa jumelle se révèle aussi.

- **Repérage** : un symbole en filigrane dans le fond de la case, ★ pour une paire et ◆ pour l'autre, sans couleur. Le rouge est réservé aux définitions difficiles.
- **Contenu** : chaque case cache sa propre lettre, qui peut être différente de celle de sa jumelle.
- **Déclenchement** : quand un joueur valide un mot contenant une jumelle, l'autre case de la paire apparaît dans son propre mot.
- **Prime** : le joueur qui déclenche la paire reçoit la prime.
- **Combo** : si la lettre révélée complète un mot, ce mot et ses points vont au même joueur. Un double combo est possible, puisqu'une case appartient parfois à un mot horizontal et à un mot vertical.
- **Placement** : les deux jumelles d'une paire ne partagent aucun mot, ne sont pas trop proches, et ne tombent jamais sur une case du mot mystère.

## 7. Mot mystère

Des cases cerclées et numérotées, réparties dans la grille, forment un mot mystère de pop culture. C'est le plus gros bonus de la partie.

- Ses lettres n'ont pas besoin d'être contiguës.
- Ses cases se remplissent au fil des mots trouvés.
- Il devient **proposable à partir de 80 % de grille remplie**.
- **Une seule proposition par joueur** : +100 si elle est juste, −30 si elle est fausse.
- **Saisie dédiée** : le bouton « Proposer » fait basculer le clavier vers le mot mystère, avec les lettres déjà connues en filigrane. Entrée valide, Échap annule sans consommer la proposition.
- Le résultat, juste ou faux, reste affiché dans la carte du mot mystère.

## 8. Définitions de la communauté

Les joueurs proposent des définitions. Elles passent en modération, et seules les définitions validées entrent dans les grilles.

| Champ | Règle |
| --- | --- |
| Réponse | 2 à 10 lettres après normalisation : majuscules, et suppression des accents, espaces, tirets et apostrophes. Pas de chiffres. |
| Définition | 40 caractères maximum, et ne doit pas contenir la réponse. Un aperçu en direct montre une case seule et une case partagée, avec une alerte si le texte est coupé. |
| Thème | Un des thèmes actifs, ou « Mot courant ». |
| Difficulté | Facile, Moyen, Difficile ou Expert. |
| Explication | 10 à 280 caractères. Elle est montrée aux modérateurs, puis aux joueurs dans la revue de fin de partie, avec le pseudo de l'auteur. |

- **Doublons** : un doublon exact (même mot, même définition) est bloqué. Une nouvelle définition pour un mot existant est acceptée comme variante.
- **Cycle de vie** : En attente → Validée ou Refusée. Un refus s'accompagne d'un commentaire, que l'auteur voit. Le modérateur peut ajuster la difficulté avant de valider, ou repasser une définition en attente.
- **Prototype** : les définitions validées par la communauté ont 3 fois plus de chances d'apparaître, pour les repérer vite pendant les tests. Un export et un import JSON permettront d'amorcer la vraie base.

## 9. Rôles et administration

| Action | Joueur | Modérateur | Admin |
| --- | --- | --- | --- |
| Proposer une définition | Oui | Oui | Oui |
| Valider ou refuser une proposition | Non | Oui | Oui |
| Consulter toute la base (recherche, filtres, export CSV) | Non | Non | Oui |
| Modifier ou supprimer n'importe quelle définition | Non | Non | Oui |
| Créer, renommer, activer, désactiver ou supprimer un thème | Non | Non | Oui |

Côté serveur, chaque droit est vérifié par l'API : masquer un bouton ne protège rien. Dans le prototype, le rôle est un « profil de test » choisi dans le salon.

### Base complète (admin)

- Toutes les définitions, intégrées ou de la communauté, quel que soit leur statut.
- Recherche dans la réponse, la définition, l'auteur et l'explication. Filtres par thème, difficulté, source et statut.
- Thème modifiable directement dans le tableau, et export CSV de la sélection.
- **Modifier** : réponse, texte, thème, difficulté et explication, plus le statut pour une proposition de la communauté. Les contrôles sont les mêmes que dans l'éditeur. Une définition intégrée modifiée garde sa version d'origine, avec un bouton pour y revenir.
- **Supprimer** : la suppression se confirme en deux clics et reste réversible. La définition sort des grilles mais reste visible avec le filtre « Supprimée », d'où on peut la restaurer.
- Chaque modification note qui l'a faite et quand.

### Thèmes (admin)

- Créer un thème : il démarre vide et à 0 % dans le salon. Il se remplit par les propositions des joueurs ou en y déplaçant des mots existants.
- Renommer n'importe quel thème. Activer ou désactiver un thème : un thème inactif disparaît du salon et de la génération. Il faut toujours au moins un thème actif.
- Supprimer un thème créé, seulement s'il est vide. « Mot courant » reste fixe.

## 10. Interface

### PC

- La grille occupe la gauche de l'écran ; les définitions sont écrites dans les cases, et le survol affiche le texte complet.
- Le panneau de droite réunit les scores, la définition sélectionnée avec ses badges, le mot mystère, le fil de la partie et une légende.
- **Clavier** :
  - lettres pour écrire, Entrée pour valider, Retour arrière pour effacer ;
  - Tab et Maj+Tab pour le mot suivant ou précédent ;
  - Espace pour changer de sens, flèches pour déplacer le curseur ;
  - Échap pour quitter la saisie du mot mystère.
- Un clic sur une case vide place le curseur exactement à cet endroit.

### Mobile

- **Clavier AZERTY intégré** au jeu, à la place du clavier natif : la mise en page reste stable, sans autocorrection ni majuscules automatiques.
- Les cases de définition n'affichent que leurs **flèches**. La définition complète apparaît dans un **bandeau** au-dessus du clavier, avec les boutons mot précédent et mot suivant.
- Une **ligne d'info** au-dessus de la grille affiche les événements de la partie sans jamais masquer de case. Les retours du joueur (raté, bien joué) restent affichés au moins 1,8 s.
- Le **menu ☰** donne accès au fil de la partie, à une fiche « Légende et règles » et aux raccourcis de test.
- Testé sur 390 × 844 (iPhone) et 360 × 740 (petit Android), sans défilement.
- À venir : application installable sur l'écran d'accueil (PWA), en plein écran.

### Couleurs des joueurs

Il y a 8 couleurs, choisies pour ne pas se confondre avec la sélection (jaune), les erreurs (rouge) ni les cases de définition (beige) : bleu, orange, vert, magenta, violet, turquoise, graphite et olive.

Le vert et l'olive restent assez proches. Une piste : afficher l'initiale du joueur dans un coin de la case.

## 11. Contenu et droits

- Une grille ne se remplit pas seulement avec des noms propres : il faut aussi des mots courants, définis dans le même esprit.
- La banque est écrite ou relue à la main. Un LLM peut proposer des brouillons, mais tout est relu.
- Citer des titres et des noms dans le texte ne pose pas de problème. En revanche, pas d'images, d'affiches ni d'extraits sonores protégés comme indices.

## 12. Questions ouvertes et évolutions

**À trancher**

- [ ] Barème définitif, en particulier les coefficients des quatre niveaux de difficulté.
- [ ] Mot mystère : bonus identique pour tous ceux qui le trouvent, ou dégressif selon l'ordre ?
- [ ] Validation automatique dès la dernière lettre tapée, à tester avec les pénalités.

**Décidé**

- [x] Chiffres dans les réponses : exclus.
- [x] Nombre de joueurs par salon : 8 au maximum, avec une grille 10 × 13 inchangée.
- [x] Identification : simple pseudo, sans compte, pour l'instant.

**Évolutions futures**

- Mode coopération sur la même grille.
- Grille du jour commune, jouée en solo et classée au score et au temps.
- Grilles thématiques (une saga, une décennie) et niveaux de difficulté.
- Autres formats de grille : petit (8 × 10) et grand (ordinateur et tablette).
- Initiale du joueur dans les cases trouvées.
- Statistiques par définition (taux de réussite, temps moyen) pour recalibrer la difficulté.
