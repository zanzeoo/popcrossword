-- Schéma PostgreSQL proposé pour Mots Cultes (PopCrossword).
-- Schéma initial. Les évolutions passent par db/migrations/ (voir server/scripts/migrate.js).

CREATE TYPE role_joueur       AS ENUM ('joueur', 'moderateur', 'admin');
CREATE TYPE difficulte        AS ENUM ('facile', 'moyen', 'difficile', 'expert');
CREATE TYPE statut_definition AS ENUM ('en_attente', 'validee', 'refusee');
CREATE TYPE source_definition AS ENUM ('integree', 'communaute');
CREATE TYPE mode_partie       AS ENUM ('classique', 'derniere_chance');

-- Joueurs : simple pseudo pour l'instant, sans mot de passe.
CREATE TABLE joueurs (
  id          BIGSERIAL PRIMARY KEY,
  pseudo      VARCHAR(12) NOT NULL,
  role        role_joueur NOT NULL DEFAULT 'joueur',
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Thèmes : « mot_courant » est un thème système, toujours actif.
CREATE TABLE themes (
  id          VARCHAR(40) PRIMARY KEY,           -- ex. 'films', 't_seriestv_x7k'
  nom         VARCHAR(24) NOT NULL,
  actif       BOOLEAN NOT NULL DEFAULT true,
  systeme     BOOLEAN NOT NULL DEFAULT false,    -- true pour 'mot_courant'
  cree_par    BIGINT REFERENCES joueurs(id),
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX themes_nom_unique ON themes (lower(nom));

INSERT INTO themes (id, nom, systeme) VALUES
  ('films', 'Films', false), ('anim', 'Dessins animés', false), ('jv', 'Jeux vidéo', false),
  ('musique', 'Musique', false), ('persos', 'Personnages', false), ('sagas', 'Sagas & lore', false),
  ('mot_courant', 'Mot courant', true);

-- Définitions : banque intégrée et propositions de la communauté, dans une seule table.
CREATE TABLE definitions (
  id              BIGSERIAL PRIMARY KEY,
  reponse         VARCHAR(10) NOT NULL CHECK (reponse ~ '^[A-Z]{2,10}$'),
  reponse_saisie  VARCHAR(24),                    -- telle que tapée (« Spider-Man »)
  texte           VARCHAR(40) NOT NULL,
  theme_id        VARCHAR(40) NOT NULL REFERENCES themes(id),
  difficulte      difficulte,                     -- NULL = non classée (banque intégrée)
  explication     VARCHAR(280),
  source          source_definition NOT NULL,
  statut          statut_definition NOT NULL DEFAULT 'en_attente',
  auteur_id       BIGINT REFERENCES joueurs(id),
  moderateur_id   BIGINT REFERENCES joueurs(id),
  commentaire     VARCHAR(140),                   -- motif d'un refus, montré à l'auteur
  cree_le         TIMESTAMPTZ NOT NULL DEFAULT now(),
  modere_le       TIMESTAMPTZ,
  modifie_le      TIMESTAMPTZ,
  modifie_par     BIGINT REFERENCES joueurs(id),
  supprimee_le    TIMESTAMPTZ,                    -- suppression logique (restaurable)
  supprimee_par   BIGINT REFERENCES joueurs(id),
  CHECK (source = 'integree' OR explication IS NOT NULL)
);
-- Pas deux fois la même définition pour le même mot (hors supprimées).
CREATE UNIQUE INDEX definitions_unique ON definitions (reponse, lower(texte)) WHERE supprimee_le IS NULL;
-- Ce que lit le générateur de grilles.
CREATE INDEX definitions_jouables ON definitions (theme_id) WHERE statut = 'validee' AND supprimee_le IS NULL;
CREATE INDEX definitions_moderation ON definitions (cree_le) WHERE statut = 'en_attente' AND supprimee_le IS NULL;

-- Parties et scores, pour le récapitulatif et les statistiques.
CREATE TABLE parties (
  id              BIGSERIAL PRIMARY KEY,
  code_salon      CHAR(4) NOT NULL,
  mode            mode_partie NOT NULL,
  reglages        JSONB NOT NULL,                 -- dosage des thèmes, score de départ, pénalités…
  grille          JSONB NOT NULL,                 -- structure + solutions (jamais envoyées avant la fin)
  mot_mystere     VARCHAR(10),
  debut           TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin             TIMESTAMPTZ,
  raison_fin      TEXT
);

CREATE TABLE participations (
  partie_id       BIGINT REFERENCES parties(id) ON DELETE CASCADE,
  joueur_id       BIGINT REFERENCES joueurs(id),
  pseudo          VARCHAR(12) NOT NULL,
  rang            SMALLINT,
  score_final     INTEGER NOT NULL,
  detail          JSONB NOT NULL,                 -- départ, mots, vierge, jumelles, combos, mystère, pénalités
  PRIMARY KEY (partie_id, joueur_id)
);

-- Statistiques par définition, pour recalibrer la difficulté plus tard.
CREATE TABLE stats_definitions (
  definition_id   BIGINT PRIMARY KEY REFERENCES definitions(id) ON DELETE CASCADE,
  apparitions     INTEGER NOT NULL DEFAULT 0,
  trouvee         INTEGER NOT NULL DEFAULT 0,
  erreurs         INTEGER NOT NULL DEFAULT 0,
  temps_moyen_s   REAL
);

-- Journal des actions de modération et d'administration.
CREATE TABLE journal (
  id              BIGSERIAL PRIMARY KEY,
  acteur_id       BIGINT NOT NULL REFERENCES joueurs(id),
  action          VARCHAR(40) NOT NULL,           -- 'valider', 'refuser', 'modifier', 'supprimer', 'restaurer', 'theme_creer'…
  cible_type      VARCHAR(20) NOT NULL,           -- 'definition', 'theme'
  cible_id        VARCHAR(40) NOT NULL,
  avant           JSONB,
  apres           JSONB,
  le              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX journal_cible ON journal (cible_type, cible_id, le DESC);
