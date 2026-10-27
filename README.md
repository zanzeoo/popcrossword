# PopCrossword — Mots Cultes

Jeu de **mots fléchés multijoueur** en ligne, consacré à la **pop culture des années 80, 90 et 2000** : films, dessins animés, musique, jeux vidéo, personnages fictifs, lore des grandes sagas.

Plusieurs joueurs remplissent **la même grille en temps réel**, dans un salon privé rejoint par un code. Chaque mot rapporte des points au premier qui le valide. Le jeu tourne dans le navigateur, sur PC comme sur téléphone.

> « Mots Cultes » est un nom de travail, pas encore définitif.

## État du projet

Les règles du jeu sont arrêtées pour une première version. Le **serveur tourne** sur le VPS (https://popcrossword.zanzeoo.fr, protégé par mot de passe pendant le développement) et les **clients PC et mobile y sont branchés** : on joue à plusieurs pour de vrai, chacun sur l'appareil de son choix. Le prototype PC hors ligne reste la référence pour les écrans de définitions.

| Élément | État |
| --- | --- |
| Règles du jeu (mode compétition) | Arrêtées, voir [docs/conception.md](docs/conception.md) |
| Serveur (salons temps réel, générateur de grilles, PostgreSQL, Redis) | En ligne : voir [docs/architecture.md](docs/architecture.md) et [server/](server/) |
| Client PC connecté | Jouable à plusieurs : salon avec code et lien d'invitation, partie, mot mystère, dernière chance, récapitulatif, reconnexion |
| Client mobile connecté (PWA) | Jouable à plusieurs, installable sur l'écran d'accueil : clavier intégré, mêmes salons que le PC |
| Banque de définitions | 507 définitions intégrées (180 pop culture, 327 mots courants), importées dans PostgreSQL |
| Définitions de la communauté (éditeur, modération, administration) | Dans le prototype PC hors ligne ; API REST à faire |
| Prototypes PC et mobile | Jouables hors ligne, avec adversaires simulés |

## Jouer

Ouvrir https://popcrossword.zanzeoo.fr, choisir un pseudo et créer un salon, puis partager le lien d'invitation. La page envoie chaque appareil vers la bonne version (`/pc/` ou `/mobile/`), et un même salon mélange PC et téléphones. Sur téléphone, « Ajouter à l'écran d'accueil » installe le jeu comme une application.

Il faut au moins deux joueurs ; deux onglets du même navigateur comptent pour deux joueurs. Recharger la page en pleine partie la reprend là où elle en était.

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

## Architecture en bref

```
Navigateur (client PC ou mobile)
   │  HTTPS + WebSocket (Socket.IO)
Caddy (reverse proxy, certificat, mot de passe)
   │
Node.js 22 : Fastify (fichiers, API) + Socket.IO (salons)   ── thread de génération des grilles
   │                         │
PostgreSQL                 Redis
définitions, thèmes,       limite de fréquence, jetons de reconnexion,
parties, statistiques      sauvegarde des salons en cours
```

- **Le serveur fait autorité** : il génère la grille, valide chaque mot, attribue les points et diffuse l'état. Les solutions ne quittent jamais le serveur avant la fin de la partie.
- **Les salons vivent en mémoire** du process et sont sauvegardés dans Redis à chaque changement : un redémarrage du service ne fait pas perdre les parties en cours.
- **Les clients sont sans build** : du HTML, du CSS et du JavaScript servis tels quels. La logique commune aux deux clients est dans `client/shared/core.js`.

Le protocole complet (messages, codes d'erreur, règles de reconnexion) est décrit dans [docs/architecture.md](docs/architecture.md).

## Installer sur un serveur

Testé sur Debian 13 avec Caddy déjà installé. Le dépôt est attendu dans `/home/zanzeoo/popcrossword` ; adapter `APP_USER`, `APP_DIR` et `DOMAIN` en tête de [`deploy/install.sh`](deploy/install.sh) et dans [`deploy/popcrossword.service`](deploy/popcrossword.service) pour un autre emplacement ou domaine.

1. **DNS** : un enregistrement A du domaine vers l'IP du serveur (Caddy en a besoin pour le certificat HTTPS).
2. **Infrastructure** (Node.js 22, PostgreSQL, Redis, base, service systemd, site Caddy) :
   ```bash
   sudo bash deploy/install.sh
   ```
   Le script génère un mot de passe aléatoire pour la base et l'écrit dans `server/.env` (lisible par le seul utilisateur, jamais versionné). Il peut être relancé sans casse.
3. **Dépendances, tables et banque de définitions** :
   ```bash
   cd server
   npm install --omit=dev
   npm run migrate        # schéma initial puis migrations de db/migrations/
   npm run import-bank    # 507 définitions du prototype ; relançable sans doublon
   ```
4. **Démarrage** :
   ```bash
   sudo systemctl start popcrossword
   curl https://<domaine>/api/health   # {"ok":true,"postgres":"ok","redis":"ok"}
   ```
5. **Mot de passe d'accès** (facultatif, pendant le développement) :
   ```bash
   sudo bash deploy/protect.sh
   ```
   Le script demande un identifiant et un mot de passe, et n'écrit que leur hash bcrypt dans le Caddyfile. `/api/health` reste public pour la supervision. Le relancer change le mot de passe.

**Mettre à jour** : récupérer le code, puis `npm install --omit=dev`, `npm run migrate` et `sudo systemctl restart popcrossword`. Les fichiers des clients sont servis directement : une modification de `client/` est en ligne sans redémarrage.

## Développer en local

Il faut Node.js 22 ou plus, PostgreSQL et Redis.

```bash
cd server
cp .env.example .env          # puis renseigner DATABASE_URL
npm install
npm run migrate && npm run import-bank
PUBLIC_ORIGIN=http://localhost:3100 npm run dev   # redémarre à chaque modification
```

Le jeu est alors sur http://localhost:3100. `PUBLIC_ORIGIN` doit correspondre à l'adresse ouverte dans le navigateur : le serveur refuse les connexions temps réel venant d'une autre origine.

### Variables d'environnement

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `PORT` | Port d'écoute (sur 127.0.0.1) | `3100` |
| `DATABASE_URL` | Connexion PostgreSQL | — |
| `REDIS_URL` | Connexion Redis | `redis://127.0.0.1:6379` |
| `REDIS_PREFIX` | Préfixe des clés Redis (les tests utilisent le leur) | `pc:` |
| `PUBLIC_ORIGIN` | Seule origine acceptée pour les WebSockets | `https://popcrossword.zanzeoo.fr` |

### Scripts

| Commande | Rôle |
| --- | --- |
| `npm start` / `npm run dev` | Lancer le serveur (avec rechargement automatique pour `dev`) |
| `npm run migrate` | Appliquer le schéma et les migrations en attente |
| `npm run import-bank` | Importer la banque intégrée du prototype |
| `npm run grid-preview -- 20` | Générer 20 grilles avec la banque en base, vérifier leur cohérence et afficher la dernière |
| `npm test` | Tests des salons : vrais clients Socket.IO contre le serveur |
| `npm run e2e` | Tests de bout en bout dans de vrais navigateurs (voir ci-dessous) |

## Tests

**`npm test`** lance des parties complètes avec plusieurs clients connectés en WebSocket : salon et droits, mots justes et faux, conflits entre joueurs, limite de fréquence, reconnexion, mot mystère, dernière chance, « Rejouer », redémarrage du service. Il utilise un préfixe Redis à part et n'écrit rien en base (l'enregistrement des parties est vérifié dans une transaction annulée).

**`npm run e2e`** fait jouer deux navigateurs Chromium sans interface :
- `e2e/pc.mjs` : deux joueurs sur PC, du salon au récapitulatif ;
- `e2e/mobile.mjs` : un joueur sur PC et un autre sur un iPhone simulé, avec le clavier intégré, la PWA et la reconnexion.

Les captures d'écran sont écrites dans `server/e2e/shots/`. Ces tests demandent un navigateur :

```bash
npx playwright install chromium-headless-shell
```

Sur un serveur sans interface graphique, Chromium réclame quelques bibliothèques X (`libx11-6`, `libxcomposite1`, `libgbm1`, `libatk1.0-0t64`…). Soit les installer (`sudo npx playwright install-deps`), soit, sans droits administrateur, les extraire dans un dossier et le désigner à Chromium :

```bash
mkdir -p /tmp/libs/debs && cd /tmp/libs/debs
apt-get download libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 libx11-6 libxcomposite1 \
  libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libxcb1 libxkbcommon0 libxau6 libxdmcp6 \
  libxrender1 libwayland-server0 libdrm2 libx11-data libxi6
for f in *.deb; do dpkg -x "$f" /tmp/libs/root; done
cd - && LD_LIBRARY_PATH=/tmp/libs/root/usr/lib/x86_64-linux-gnu npm run e2e
```

## Essayer les prototypes

Chaque prototype tient dans **un seul fichier HTML**, sans dépendance ni build, avec des adversaires simulés. Sur le serveur, ils sont aussi servis sous `/proto/pc/` et `/proto/mobile/`.

- **PC** : ouvrir [`prototypes/pc/index.html`](prototypes/pc/index.html) dans un navigateur (un double-clic suffit).
- **Mobile** : servir le dossier, puis ouvrir la page depuis un téléphone connecté au même Wi-Fi.

```bash
cd prototypes
python3 -m http.server 8080
# PC     : http://localhost:8080/pc/
# mobile : http://<ip-du-pc>:8080/mobile/
```

Détails, raccourcis clavier et limites : [prototypes/README.md](prototypes/README.md).

## Structure du dépôt

```
client/
  index.html          Aiguillage vers la version PC ou mobile
  shared/core.js      Logique commune aux deux clients (connexion, salon, partie, saisie)
  pc/index.html       Client PC : affichage
  mobile/             Client mobile (PWA) : affichage, manifeste, service worker, icônes
server/
  src/index.js        Point d'entrée du service
  src/app.js          Fastify, fichiers statiques, /api/health, /api/themes, Socket.IO
  src/game/           Générateur de grilles (port du prototype) et son thread
  src/rooms/          Salons temps réel, règles du jeu, Redis, enregistrement des parties
  scripts/            Migrations, import de la banque, aperçu de grilles
  test/               Tests des salons (npm test)
  e2e/                Tests dans de vrais navigateurs (npm run e2e)
  .env.example        Modèle de configuration
deploy/
  install.sh          Installation de l'infrastructure sur le VPS
  protect.sh          Mot de passe d'accès au site (Caddy)
  popcrossword.service  Service systemd
db/
  schema.sql          Schéma PostgreSQL initial
  migrations/         Évolutions du schéma
docs/
  conception.md       Règles du jeu, interface, contenu (document de référence)
  architecture.md     Serveur, temps réel, base de données, API, déploiement
  decisions.md        Journal des décisions prises pendant la conception
prototypes/
  pc/index.html       Prototype PC (jeu + éditeur + modération + administration)
  mobile/index.html   Prototype mobile (jeu)
  README.md           Mode d'emploi des prototypes
```

## Sécurité

- Aucun secret n'est versionné : `server/.env` est ignoré par git, le mot de passe de la base est généré à l'installation et celui du site n'est stocké que haché, dans le Caddyfile du serveur.
- Les solutions ne sont envoyées aux joueurs qu'à la fin de la partie.
- Une tentative de mot par seconde et par joueur, appliquée par le serveur.
- Les connexions temps réel venant d'un autre site sont refusées.
- **Avant une ouverture au public** : retirer `/proto/` (les prototypes contiennent toutes les réponses), limiter la création de salons, puis retirer le mot de passe Caddy.

## Prochaines étapes

1. Tester avec de vrais joueurs, puis ajuster le barème.
2. ~~Monter le serveur sur le VPS Debian~~ : fait.
3. ~~Brancher les clients PC et mobile sur le serveur~~ : fait.
4. API REST des définitions : proposer, modérer, administrer depuis le client connecté.
5. Enrichir la banque de définitions, qui est le vrai chantier de contenu.
