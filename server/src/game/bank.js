// Banque de mots pour le générateur : définitions validées, non supprimées, dont le thème est actif.
import { pool } from '../db.js';

const HARD = new Set(['difficile', 'expert']);

export async function loadBank() {
  const { rows } = await pool.query(`
    SELECT d.id, d.reponse, d.texte, d.theme_id, d.difficulte, d.explication, d.source, j.pseudo AS auteur
    FROM definitions d
    JOIN themes t ON t.id = d.theme_id AND t.actif
    LEFT JOIN joueurs j ON j.id = d.auteur_id
    WHERE d.statut = 'validee' AND d.supprimee_le IS NULL`);
  return rows.map((d) => ({
    id: Number(d.id),
    ans: d.reponse,
    theme: d.theme_id,
    clue: d.texte,
    hard: HARD.has(d.difficulte),
    diff: d.difficulte,
    expl: d.explication,
    author: d.auteur,
    user: d.source === 'communaute',
  }));
}
