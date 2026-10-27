// Importe la banque intégrée du prototype PC (BANK_RAW) dans la table definitions.
// Source « integree », statut « validee ». Relançable : les définitions déjà présentes sont ignorées.
import { readFile } from 'node:fs/promises';
import { pool } from '../src/db.js';

// Le prototype appelle « commun » le thème système que la base nomme « mot_courant ».
const THEME_IDS = { commun: 'mot_courant' };

const html = await readFile(new URL('../../prototypes/pc/index.html', import.meta.url), 'utf8');
const src = html.match(/const BANK_RAW = (\[[\s\S]*?\n\]);/)?.[1];
if (!src) throw new Error('BANK_RAW introuvable dans prototypes/pc/index.html');
const bank = new Function(`return ${src}`)();

const client = await pool.connect();
let ajoutees = 0;
try {
  await client.query('BEGIN');
  for (const [reponse, theme, texte, hard] of bank) {
    const res = await client.query(
      `INSERT INTO definitions (reponse, texte, theme_id, difficulte, source, statut)
       VALUES ($1, $2, $3, $4, 'integree', 'validee')
       ON CONFLICT (reponse, lower(texte)) WHERE supprimee_le IS NULL DO NOTHING`,
      [reponse, texte, THEME_IDS[theme] ?? theme, hard ? 'difficile' : null],
    );
    ajoutees += res.rowCount;
  }
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}

console.log(`${bank.length} définitions lues, ${ajoutees} ajoutées, ${bank.length - ajoutees} déjà présentes.`);
await pool.end();
