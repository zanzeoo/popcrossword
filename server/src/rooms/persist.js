// Enregistrement d'une partie terminée : joueurs, partie, scores et statistiques des définitions.
import { pool } from '../db.js';
import { ranking } from './rules.js';

export async function saveGame(room) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = await writeGame(client, room);
    await client.query('COMMIT');
    return id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Écrit la partie avec la connexion fournie, sans gérer la transaction.
export async function writeGame(client, room) {
  const { game, settings } = room;
  const { rows: [partie] } = await client.query(
    `INSERT INTO parties (code_salon, mode, reglages, grille, mot_mystere, debut, fin, raison_fin)
     VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0), $8) RETURNING id`,
    [room.code, settings.mode, settings, game.grid, game.grid.myst?.ans ?? null,
      game.startedAt, game.endedAt, game.reason],
  );

  // Pas de compte pour l'instant : chaque participation crée une ligne joueurs avec son pseudo.
  for (const p of ranking(game, room.players)) {
    const { rows: [j] } = await client.query('INSERT INTO joueurs (pseudo) VALUES ($1) RETURNING id', [p.pseudo]);
    const { id, pseudo, color, rank, score, ...detail } = p;
    await client.query(
      `INSERT INTO participations (partie_id, joueur_id, pseudo, rang, score_final, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [partie.id, j.id, pseudo, rank, score, detail],
    );
  }

  // Statistiques par définition : apparitions, trouvée directement (pas par croisement), erreurs, temps moyen.
  for (const [i, w] of game.grid.words.entries()) {
    if (w.id == null) continue;
    const direct = game.how[i] === 'trouvé';
    const temps = direct ? (game.foundAt[i] - game.startedAt) / 1000 : null;
    await client.query(
      `INSERT INTO stats_definitions (definition_id, apparitions, trouvee, erreurs, temps_moyen_s)
       VALUES ($1, 1, $2, $3, $4)
       ON CONFLICT (definition_id) DO UPDATE SET
         apparitions = stats_definitions.apparitions + 1,
         trouvee = stats_definitions.trouvee + EXCLUDED.trouvee,
         erreurs = stats_definitions.erreurs + EXCLUDED.erreurs,
         temps_moyen_s = CASE WHEN EXCLUDED.temps_moyen_s IS NULL THEN stats_definitions.temps_moyen_s
           ELSE (COALESCE(stats_definitions.temps_moyen_s, 0) * stats_definitions.trouvee + EXCLUDED.temps_moyen_s)
                / (stats_definitions.trouvee + 1) END`,
      [w.id, direct ? 1 : 0, game.wrong[i], temps],
    );
  }
  return Number(partie.id);
}
