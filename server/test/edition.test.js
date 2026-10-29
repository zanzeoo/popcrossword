// Tests de l'API d'édition. Ils écrivent dans la vraie base avec un thème « zz_test… » dédié,
// et nettoient définitions, thème et journal à la fin.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { redis } from '../src/redis.js';
import { stopGridWorker } from '../src/game/grid.js';

process.env.ADMIN_TOKEN = 'jeton-de-test';
const { app } = await buildApp({ logger: false });
const auth = { authorization: 'Bearer jeton-de-test' };
const call = (method, url, payload, headers = auth) => app.inject({ method, url, payload, headers });
const json = (res) => res.json();

const THEME = 'zz_test';
const createdDefs = [];

after(async () => {
  await pool.query('DELETE FROM journal WHERE (cible_type = $1 AND cible_id = ANY($2)) OR (cible_type = $3 AND cible_id LIKE $4)',
    ['definition', createdDefs.map(String), 'theme', 'zz_test%']);
  await pool.query('DELETE FROM definitions WHERE theme_id LIKE $1', ['zz_test%']);
  await pool.query('DELETE FROM themes WHERE id LIKE $1', ['zz_test%']);
  await app.close();
  await stopGridWorker();
  await pool.end();
  redis.disconnect();
});

test('sans jeton ou avec un mauvais jeton : 401', async () => {
  assert.equal((await call('GET', '/api/admin/definitions', undefined, {})).statusCode, 401);
  assert.equal((await call('GET', '/api/moderation', undefined, { authorization: 'Bearer faux' })).statusCode, 401);
});

test('thèmes : création, doublon, désactivation, suppression', async () => {
  let res = await call('POST', '/api/admin/themes', { nom: 'ZZ Test' });
  assert.equal(res.statusCode, 201);
  assert.equal(json(res).id, THEME);
  assert.equal((await call('POST', '/api/admin/themes', { nom: 'zz test' })).statusCode, 409);

  res = await call('PATCH', `/api/admin/themes/${THEME}`, { actif: false });
  assert.equal(json(res).actif, false);
  assert.equal((await call('PATCH', '/api/admin/themes/mot_courant', { actif: false })).statusCode, 409);

  const list = json(await call('GET', '/api/admin/themes'));
  assert.ok(list.some((t) => t.id === THEME && t.mots === 0));
  assert.equal((await call('POST', '/api/admin/themes', { nom: 'zz test à supprimer' })).statusCode, 201);
  assert.equal((await call('DELETE', '/api/admin/themes/zz_test_a_supprimer')).statusCode, 200);
});

test('définitions : créer, normaliser, doublon, modifier, supprimer, restaurer, journal', async () => {
  let res = await call('POST', '/api/admin/definitions', { reponse: 'Éléphant-Rose', texte: 'Pas si discret', theme_id: THEME });
  assert.equal(res.statusCode, 400, 'plus de 10 lettres');
  for (const reponse of ['A', 'é-', 'Spider-Man-2', '1234', 'ABCDEFGHIJK']) {
    res = await call('POST', '/api/admin/definitions', { reponse, texte: 'Hors format', theme_id: THEME });
    assert.equal(res.statusCode, 400, `« ${reponse} » refusé`);
  }

  res = await call('POST', '/api/admin/definitions', { reponse: 'Spider-Man', texte: 'Héros à toile', theme_id: THEME, difficulte: 'moyen' });
  assert.equal(res.statusCode, 201);
  const def = json(res);
  createdDefs.push(def.id);
  assert.equal(def.reponse, 'SPIDERMAN');
  assert.equal(def.reponse_saisie, 'Spider-Man');
  assert.equal(def.statut, 'validee');
  assert.equal(def.source, 'integree');

  assert.equal((await call('POST', '/api/admin/definitions', { reponse: 'spiderman', texte: 'HÉROS à toile', theme_id: THEME })).statusCode, 409);
  assert.equal((await call('POST', '/api/admin/definitions', { reponse: 'abc', texte: 'x', theme_id: 'inconnu' })).statusCode, 400);

  res = await call('PATCH', `/api/admin/definitions/${def.id}`, { texte: 'Il lance des toiles', difficulte: null });
  assert.equal(res.statusCode, 200);
  assert.equal(json(res).texte, 'Il lance des toiles');
  assert.equal(json(res).difficulte, null);
  assert.equal((await call('PATCH', `/api/admin/definitions/${def.id}`, {})).statusCode, 400);
  assert.equal((await call('PATCH', '/api/admin/definitions/999999999', { texte: 'x' })).statusCode, 404);

  assert.equal((await call('DELETE', `/api/admin/definitions/${def.id}`)).statusCode, 200);
  assert.equal((await call('DELETE', `/api/admin/definitions/${def.id}`)).statusCode, 409);
  assert.equal(json(await call('GET', `/api/admin/definitions?theme=${THEME}`)).total, 0, 'masquée par défaut');
  assert.equal(json(await call('GET', `/api/admin/definitions?theme=${THEME}&supprimees=oui`)).total, 1);
  assert.equal((await call('POST', `/api/admin/definitions/${def.id}/restaurer`)).statusCode, 200);

  const journal = json(await call('GET', `/api/admin/definitions/${def.id}/journal`));
  assert.deepEqual(journal.map((j) => j.action), ['restaurer', 'supprimer', 'modifier', 'creer']);
});

test('recherche, pagination et export CSV', async () => {
  for (const [rep, texte] of [['ALPHA', 'Première lettre'], ['BETA', 'Deuxième, « lettre »'], ['GAMMA', '=SOMME(A1)']]) {
    const res = await call('POST', '/api/admin/definitions', { reponse: rep, texte, theme_id: THEME });
    createdDefs.push(json(res).id);
  }
  const page = json(await call('GET', `/api/admin/definitions?theme=${THEME}&limite=2&page=2`));
  assert.equal(page.total, 4);
  assert.equal(page.items.length, 2);
  assert.equal(json(await call('GET', `/api/admin/definitions?theme=${THEME}&q=lettre`)).total, 2);
  assert.equal(json(await call('GET', `/api/admin/definitions?theme=${THEME}&q=%25`)).total, 0, '% littéral, pas un joker');

  const csv = await call('GET', `/api/admin/export.csv?theme=${THEME}`);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.body, /"Deuxième, « lettre »"/);
  assert.match(csv.body, /'=SOMME\(A1\)/, 'formule neutralisée');
});

test('modération : valider (avec difficulté), refuser, pas de double décision', async () => {
  const ids = [];
  for (const rep of ['OMEGA', 'DELTA']) {
    const { rows } = await pool.query(
      `INSERT INTO definitions (reponse, texte, theme_id, source, statut, explication)
       VALUES ($1, 'Proposée', $2, 'communaute', 'en_attente', 'parce que') RETURNING id`, [rep, THEME]);
    ids.push(Number(rows[0].id));
    createdDefs.push(Number(rows[0].id));
  }
  const queue = json(await call('GET', '/api/moderation'));
  assert.ok(ids.every((id) => queue.items.some((d) => Number(d.id) === id)));

  let res = await call('POST', `/api/moderation/${ids[0]}/valider`, { difficulte: 'expert' });
  assert.equal(res.statusCode, 200);
  assert.equal(json(res).statut, 'validee');
  assert.equal(json(res).difficulte, 'expert');
  assert.equal((await call('POST', `/api/moderation/${ids[0]}/valider`)).statusCode, 409);

  assert.equal((await call('POST', `/api/moderation/${ids[1]}/refuser`, {})).statusCode, 400, 'motif obligatoire');
  res = await call('POST', `/api/moderation/${ids[1]}/refuser`, { commentaire: 'Trop vague' });
  assert.equal(json(res).statut, 'refusee');
  assert.equal(json(res).commentaire, 'Trop vague');

  assert.equal((await call('PATCH', `/api/admin/definitions/${ids[1]}`, { explication: null })).statusCode, 400);
  const journal = json(await call('GET', `/api/admin/definitions/${ids[0]}/journal`));
  assert.equal(journal[0].action, 'valider');
});

test('sans ADMIN_TOKEN, l’API d’édition est désactivée', async () => {
  const saved = process.env.ADMIN_TOKEN;
  delete process.env.ADMIN_TOKEN;
  try {
    assert.equal((await call('GET', '/api/admin/themes')).statusCode, 503);
  } finally {
    process.env.ADMIN_TOKEN = saved;
  }
});
