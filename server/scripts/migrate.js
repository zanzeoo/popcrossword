// Applique db/schema.sql sur une base vide, puis les fichiers de db/migrations/ pas encore passés,
// dans l'ordre de leur nom. Chaque migration tourne dans sa propre transaction.
import { readFile, readdir } from 'node:fs/promises';
import { pool } from '../src/db.js';

const dbDir = new URL('../../db/', import.meta.url);

async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const { rows } = await pool.query("SELECT to_regclass('public.definitions') AS t");
if (rows[0].t) {
  console.log('Schéma de base déjà en place.');
} else {
  const schema = await readFile(new URL('schema.sql', dbDir), 'utf8');
  await inTransaction((c) => c.query(schema));
  console.log('Schéma de base appliqué.');
}

await pool.query(`CREATE TABLE IF NOT EXISTS migrations (
  nom TEXT PRIMARY KEY,
  appliquee_le TIMESTAMPTZ NOT NULL DEFAULT now()
)`);
const done = new Set((await pool.query('SELECT nom FROM migrations')).rows.map((r) => r.nom));
const files = (await readdir(new URL('migrations/', dbDir))).filter((f) => f.endsWith('.sql')).sort();

for (const file of files.filter((f) => !done.has(f))) {
  const sql = await readFile(new URL(`migrations/${file}`, dbDir), 'utf8');
  await inTransaction(async (c) => {
    await c.query(sql);
    await c.query('INSERT INTO migrations (nom) VALUES ($1)', [file]);
  });
  console.log(`Migration appliquée : ${file}`);
}
await pool.end();
