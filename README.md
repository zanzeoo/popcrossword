# PopCrossword — Mots Cultes

Jeu de **mots fléchés multijoueur** en ligne, consacré à la **pop culture des années 80, 90 et 2000** : films, dessins animés, musique, jeux vidéo, personnages fictifs, lore des grandes sagas.

Plusieurs joueurs remplissent **la même grille en temps réel**, dans un salon privé rejoint par un code. Chaque mot rapporte des points au premier qui le valide. Le jeu tourne dans le navigateur et doit être **pleinement jouable sur mobile**.

> « Mots Cultes » est un nom de travail, pas encore définitif.

## État du projet

Le projet est en **phase de prototypage**. Les règles du jeu sont arrêtées pour une première version, et deux prototypes jouables valident le concept **sans serveur** : les adversaires sont simulés, et la base de données est remplacée par le stockage du navigateur.

| Élément | État |
| --- | --- |
| Règles du jeu (mode compétition) | Arrêtées, voir [docs/conception.md](docs/conception.md) |
| Prototype PC | Jouable : jeu complet, éditeur de définitions, modération, administration |
| Prototype mobile | Jouable : jeu complet ; l'éditeur et l'administration restent sur PC |
| Serveur temps réel et base de données | Conçus, pas encore développés : voir [docs/architecture.md](docs/architecture.md) |

## Essayer les prototypes

Chaque prototype tient dans **un seul fichier HTML**, sans dépendance ni build.

- **PC** : ouvrir [`prototypes/pc/index.html`](prototypes/pc/index.html) dans un navigateur (un double-clic suffit).
- **Mobile** : servir le dossier, puis ouvrir la page depuis un téléphone connecté au même Wi-Fi.

```bash
cd prototypes
python3 -m http.server 8080
# PC     : http://localhost:8080/pc/
# mobile : http://<ip-du-pc>:8080/mobile/
```

Détails, raccourcis clavier et limites : [prototypes/README.md](prototypes/README.md).

## Le jeu en bref

- **Grille 10 × 13** en portrait, environ 35 mots, générée à chaque partie. Le créateur du salon dose les thèmes avec des curseurs.
- **Salon privé** de 2 à 8 joueurs, avec un simple pseudo et sans compte.
- **Validation par mot entier** : on tape tout le mot, lettres déjà posées comprises.
- **Score** : tout le monde part du même score. Chaque lettre rapporte des points, les définitions difficiles comptent double, et chaque erreur coûte une pénalité.
- **Bonus « mot vierge »** quand on trouve un mot dont aucune lettre n'est encore posée.
- **Cases jumelles** (★ et ◆) : révéler l'une révèle l'autre, avec une prime et parfois un combo.
- **Mot mystère** formé par des cases cerclées, proposable à partir de 80 % de grille remplie, une seule fois par joueur.
- **Deux modes** : *Classique*, qui se termine quand la grille est complète, et *Dernière chance* : dès qu'un joueur trouve le mot mystère, chacun des autres a droit à un dernier essai.
- **Définitions de la communauté** : les joueurs proposent des définitions, les modérateurs les valident, et les admins gèrent toute la base ainsi que les thèmes.

## Structure du dépôt

```
docs/
  conception.md     Règles du jeu, interface, contenu (document de référence)
  architecture.md   Serveur, temps réel, base de données, API, déploiement
  decisions.md      Journal des décisions prises pendant la conception
db/
  schema.sql        Schéma PostgreSQL proposé
prototypes/
  pc/index.html     Prototype PC (jeu + éditeur + modération + administration)
  mobile/index.html Prototype mobile (jeu)
  README.md         Mode d'emploi des prototypes
```

## Prochaines étapes

1. Tester les prototypes avec de vrais joueurs, puis ajuster le barème.
2. Monter le serveur sur le VPS Debian : API, base PostgreSQL, salons temps réel par WebSocket.
3. Brancher le client sur le serveur, en version PC d'abord, puis mobile en PWA.
4. Enrichir la banque de définitions, qui est le vrai chantier de contenu.
