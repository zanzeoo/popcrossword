-- La banque intégrée contient des définitions jusqu'à 55 caractères.
-- La limite de 40 caractères reste appliquée par l'API aux propositions des joueurs.
ALTER TABLE definitions ALTER COLUMN texte TYPE VARCHAR(60);
