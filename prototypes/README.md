# Prototypes

Deux prototypes jouables, chacun dans **un seul fichier HTML autonome** : pas de dépendance, pas de build, pas de serveur de jeu. Ils servent à valider les règles et l'interface avant de développer le vrai serveur.

Ce qui est **simulé** :

- **Les adversaires** : jusqu'à 7 joueurs virtuels, qui trouvent des mots et se trompent parfois, à une vitesse réglable.
- **La base de données** : le stockage local du navigateur (`localStorage`). Ce qui est proposé ou modifié sur un navigateur ne se retrouve donc pas sur un autre.

## Lancer

```bash
cd prototypes
python3 -m http.server 8080
```

- PC : <http://localhost:8080/pc/>, ou un double-clic sur `pc/index.html`.
- Mobile : <http://IP-DU-PC:8080/mobile/> depuis un téléphone connecté au même Wi-Fi.

## Contenu

| Fonction | PC | Mobile |
| --- | --- | --- |
| Salon : pseudo, 1 à 7 adversaires, vitesse, dosage des thèmes, mode, score de départ et pénalités | ✓ | ✓ |
| Grille 10 × 13 générée à chaque partie (flèches simples et coudées) | ✓ | ✓ |
| Saisie du mot entier, pénalités, limite de fréquence | ✓ | ✓ |
| Cases jumelles ★ ◆, combos, bonus mot vierge | ✓ | ✓ |
| Mot mystère (à partir de 80 %, saisie dédiée) | ✓ | ✓ |
| Modes Classique et Dernière chance | ✓ | ✓ |
| Récapitulatif et revue de la grille | ✓ | ✓ |
| Éditeur de définitions et modération | ✓ | — |
| Administration : base complète, modification, suppression, thèmes | ✓ | — |
| Rôles de test (joueur, modérateur, admin) | ✓ | — |

## Commandes

**PC (clavier physique)**

| Touche | Action |
| --- | --- |
| A à Z | Écrire dans le mot sélectionné |
| Entrée | Valider le mot, ou la proposition de mot mystère |
| Retour arrière | Effacer |
| Tab / Maj+Tab | Mot suivant / précédent |
| Espace | Changer de sens sur la case courante |
| ← → | Déplacer le curseur dans le mot |
| Échap | Quitter la saisie du mot mystère |

**Mobile** : on touche une case ou une définition pour sélectionner un mot ; toucher à nouveau change de sens. On écrit avec le clavier intégré, et les flèches ‹ › du bandeau passent d'un mot à l'autre.

**Menu de test** (☰ sur mobile, « Tests » sur PC) : remplir la grille à 80 %, mettre les adversaires en pause, terminer la partie, revenir au salon.

## Organisation du code

Chaque fichier contient, dans l'ordre :

1. **Le style** (CSS) et la structure des écrans : salon, partie, récapitulatif, et, sur PC uniquement, l'éditeur, la modération et l'administration.
2. **La banque de mots** (`BANK_RAW`) : `[réponse, thème, définition, difficile?]`.
3. **Le générateur de grille** (`buildOnce`, `generateGrid`, `pickMystery`, `pickTwins`).
4. **Les règles** : `claimWord` (points, jumelles, combos, croisements), `submit`, `submitMystery`, la dernière chance (`startFinal`, `useFinal`) et les adversaires (`botTick`).
5. **L'affichage** (`render*`) et les événements.
6. **Sur PC** : l'éditeur (`checkDef`, `submitDef`), la modération (`renderModo`), l'administration (`allRows`, `saveRow`, `deleteRow`, thèmes).

La version mobile reprend **la même logique de jeu** que la version PC. Seul l'affichage diffère : bandeau de définition, clavier intégré, ligne d'info, pastilles de scores.

## Limites connues

- **Environ 20 cases vides par grille** : la banque ne compte qu'environ 500 définitions.
- **Barème provisoire** : Difficile et Expert comptent ×2, Facile et Moyen ×1.
- **Les définitions validées de la communauté** ont 3 fois plus de chances d'apparaître, pour les voir vite en test.
- **Les couleurs vert et olive** des joueurs sont assez proches.
- **Le mobile n'a pas encore** d'éditeur ni d'administration.

## Correspondance avec le schéma SQL

| Prototype | Base (`db/schema.sql`) |
| --- | --- |
| Thème `commun` | `mot_courant` |
| Statuts `pending`, `approved`, `rejected` | `en_attente`, `validee`, `refusee` |
| Statut `deleted` | `supprimee_le` non nul (suppression logique) |
| Clé locale `motscultes.definitions.v1` | Table `definitions` (source `communaute`) |
| Clé locale `motscultes.builtinEdits.v1` | Lignes `definitions` de source `integree` modifiées, et `journal` |
