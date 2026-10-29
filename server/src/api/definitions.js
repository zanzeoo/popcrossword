// API d'édition : définitions, modération, thèmes et export CSV. Voir docs/architecture.md.
import { pool } from '../db.js';
import { requireAdmin } from './auth.js';

const DIFFICULTES = ['facile', 'moyen', 'difficile', 'expert'];
const STATUTS = ['en_attente', 'validee', 'refusee'];

// « Spider-Man » → SPIDERMAN : sans accents, majuscules, lettres seulement.
const normalizeAnswer = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');

// Longueur imposée aux mots de la grille : 2 à 10 lettres, sans chiffres (« Spider-Man 2 » ne devient pas SPIDERMAN).
function validAnswer(input) {
  const reponse = normalizeAnswer(input);
  if (/\d/.test(input)) throw httpError(400, 'la réponse ne doit pas contenir de chiffres');
  if (!/^[A-Z]{2,10}$/.test(reponse)) throw httpError(400, `la réponse doit faire de 2 à 10 lettres (« ${input.trim()} » en fait ${reponse.length})`);
  return reponse;
}

const COLUMNS = `d.id, d.reponse, d.reponse_saisie, d.texte, d.theme_id, d.difficulte, d.explication, d.source,
  d.statut, d.auteur_id, d.moderateur_id, d.commentaire, d.cree_le, d.modere_le, d.modifie_le, d.supprimee_le`;

const idParams = { type: 'object', properties: { id: { type: 'integer', minimum: 1 } }, required: ['id'] };
const fields = {
  reponse: { type: 'string', minLength: 1, maxLength: 24 },
  texte: { type: 'string', minLength: 1, maxLength: 60 },
  theme_id: { type: 'string', minLength: 1, maxLength: 40 },
  difficulte: { type: ['string', 'null'], enum: [...DIFFICULTES, null] },
  explication: { type: ['string', 'null'], maxLength: 280 },
};

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const log = (client, acteurId, action, type, id, avant, apres) => client.query(
  `INSERT INTO journal (acteur_id, action, cible_type, cible_id, avant, apres) VALUES ($1, $2, $3, $4, $5, $6)`,
  [acteurId, action, type, String(id), avant, apres],
);

async function lockDefinition(client, id) {
  const { rows } = await client.query(`SELECT ${COLUMNS} FROM definitions d WHERE d.id = $1 FOR UPDATE`, [id]);
  if (!rows[0]) throw httpError(404, 'définition introuvable');
  return rows[0];
}

async function assertTheme(client, themeId) {
  const { rowCount } = await client.query('SELECT 1 FROM themes WHERE id = $1', [themeId]);
  if (!rowCount) throw httpError(400, `thème inconnu : ${themeId}`);
}

// Filtres communs à la liste et à l'export.
function listFilter(q) {
  const where = [];
  const args = [];
  const add = (sql, value) => { args.push(value); where.push(sql.replaceAll("$?", `$${args.length}`)); };
  if (q.q) add("(d.reponse ILIKE $? OR d.texte ILIKE $?)", `%${q.q.replace(/[\\%_]/g, '\\$&')}%`);
  if (q.theme) add('d.theme_id = $?', q.theme);
  if (q.statut) add('d.statut = $?', q.statut);
  if (q.source) add('d.source = $?', q.source);
  if (q.difficulte) add('d.difficulte = $?', q.difficulte);
  if (q.supprimees === 'non') where.push('d.supprimee_le IS NULL');
  else if (q.supprimees === 'oui') where.push('d.supprimee_le IS NOT NULL');
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

const listQuery = {
  type: 'object',
  properties: {
    q: { type: 'string', maxLength: 60 },
    theme: { type: 'string', maxLength: 40 },
    statut: { type: 'string', enum: STATUTS },
    source: { type: 'string', enum: ['integree', 'communaute'] },
    difficulte: { type: 'string', enum: DIFFICULTES },
    supprimees: { type: 'string', enum: ['non', 'oui', 'toutes'], default: 'non' },
    page: { type: 'integer', minimum: 1, default: 1 },
    limite: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
  },
};

async function listDefinitions(q, orderBy) {
  const { sql, args } = listFilter(q);
  const total = (await pool.query(`SELECT count(*)::int AS n FROM definitions d ${sql}`, args)).rows[0].n;
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM definitions d ${sql} ORDER BY ${orderBy}
     LIMIT ${q.limite} OFFSET ${(q.page - 1) * q.limite}`, args);
  return { total, page: q.page, limite: q.limite, items: rows };
}

const csvCell = (v) => {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  // Les cellules commençant par =, +, -, @ sont neutralisées pour les tableurs.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export async function editionRoutes(app) {
  app.addHook('onRequest', requireAdmin);

  // Les violations d'unicité deviennent des 409 lisibles.
  app.setErrorHandler((err, req, reply) => {
    if (err.code === '23505') return reply.code(409).send({ erreur: 'doublon : cette définition ou ce thème existe déjà' });
    if (err.validation) return reply.code(400).send({ erreur: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ erreur: err.message });
    req.log.error(err);
    return reply.code(500).send({ erreur: 'erreur interne' });
  });

  // ---- Définitions ----
  app.get('/api/admin/definitions', { schema: { querystring: listQuery } }, (req) => listDefinitions(req.query, 'd.id'));

  app.get('/api/admin/definitions/:id', { schema: { params: idParams } }, async (req) => {
    const { rows } = await pool.query(`SELECT ${COLUMNS} FROM definitions d WHERE d.id = $1`, [req.params.id]);
    if (!rows[0]) throw httpError(404, 'définition introuvable');
    return rows[0];
  });

  app.post('/api/admin/definitions', {
    schema: { body: { type: 'object', required: ['reponse', 'texte', 'theme_id'], additionalProperties: false,
      properties: { ...fields, statut: { type: 'string', enum: STATUTS, default: 'validee' } } } },
  }, async (req, reply) => {
    const b = req.body;
    const reponse = validAnswer(b.reponse);
    const row = await inTransaction(async (c) => {
      await assertTheme(c, b.theme_id);
      const { rows } = await c.query(
        `INSERT INTO definitions (reponse, reponse_saisie, texte, theme_id, difficulte, explication, source, statut, auteur_id, modifie_le)
         VALUES ($1, $2, $3, $4, $5, $6, 'integree', $7, $8, now()) RETURNING id`,
        [reponse, b.reponse.trim(), b.texte.trim(), b.theme_id, b.difficulte ?? null, b.explication ?? null, b.statut, req.acteurId]);
      const created = await lockDefinition(c, rows[0].id);
      await log(c, req.acteurId, 'creer', 'definition', created.id, null, created);
      return created;
    });
    return reply.code(201).send(row);
  });

  app.patch('/api/admin/definitions/:id', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, minProperties: 1,
      properties: { ...fields, statut: { type: 'string', enum: STATUTS } } } },
  }, (req) => inTransaction(async (c) => {
    const before = await lockDefinition(c, req.params.id);
    const b = req.body;
    const sets = [];
    const args = [];
    const set = (col, value) => { args.push(value); sets.push(`${col} = $${args.length}`); };
    if (b.reponse !== undefined) {
      const reponse = validAnswer(b.reponse);
      set('reponse', reponse);
      set('reponse_saisie', b.reponse.trim());
    }
    if (b.texte !== undefined) set('texte', b.texte.trim());
    if (b.theme_id !== undefined) { await assertTheme(c, b.theme_id); set('theme_id', b.theme_id); }
    for (const col of ['difficulte', 'explication', 'statut']) if (b[col] !== undefined) set(col, b[col]);
    if (before.source === 'communaute' && b.explication === null) throw httpError(400, 'une proposition de la communauté garde son explication');
    set('modifie_le', new Date());
    set('modifie_par', req.acteurId);
    args.push(before.id);
    await c.query(`UPDATE definitions SET ${sets.join(', ')} WHERE id = $${args.length}`, args);
    const after = await lockDefinition(c, before.id);
    await log(c, req.acteurId, 'modifier', 'definition', before.id, before, after);
    return after;
  }));

  app.delete('/api/admin/definitions/:id', { schema: { params: idParams } }, (req) => inTransaction(async (c) => {
    const before = await lockDefinition(c, req.params.id);
    if (before.supprimee_le) throw httpError(409, 'déjà supprimée');
    await c.query('UPDATE definitions SET supprimee_le = now(), supprimee_par = $2 WHERE id = $1', [before.id, req.acteurId]);
    const after = await lockDefinition(c, before.id);
    await log(c, req.acteurId, 'supprimer', 'definition', before.id, before, after);
    return after;
  }));

  app.post('/api/admin/definitions/:id/restaurer', { schema: { params: idParams } }, (req) => inTransaction(async (c) => {
    const before = await lockDefinition(c, req.params.id);
    if (!before.supprimee_le) throw httpError(409, 'pas supprimée');
    await c.query('UPDATE definitions SET supprimee_le = NULL, supprimee_par = NULL WHERE id = $1', [before.id]);
    const after = await lockDefinition(c, before.id);
    await log(c, req.acteurId, 'restaurer', 'definition', before.id, before, after);
    return after;
  }));

  app.get('/api/admin/definitions/:id/journal', { schema: { params: idParams } }, async (req) =>
    (await pool.query(
      `SELECT id, action, avant, apres, le FROM journal WHERE cible_type = 'definition' AND cible_id = $1 ORDER BY le DESC, id DESC`,
      [String(req.params.id)])).rows);

  // ---- Modération ----
  app.get('/api/moderation', {
    schema: { querystring: { ...listQuery, properties: { ...listQuery.properties, statut: { type: 'string', enum: STATUTS, default: 'en_attente' },
      supprimees: { type: 'string', default: 'non' } } } },
  }, (req) => listDefinitions(req.query, 'd.cree_le, d.id'));

  const moderate = (action) => (req) => inTransaction(async (c) => {
    const before = await lockDefinition(c, req.params.id);
    if (before.supprimee_le) throw httpError(409, 'définition supprimée');
    if (before.statut !== 'en_attente') throw httpError(409, `déjà ${before.statut === 'validee' ? 'validée' : 'refusée'}`);
    const refuse = action === 'refuser';
    await c.query(
      `UPDATE definitions SET statut = $2, moderateur_id = $3, modere_le = now(), commentaire = $4,
         difficulte = COALESCE($5, difficulte) WHERE id = $1`,
      [before.id, refuse ? 'refusee' : 'validee', req.acteurId, refuse ? req.body.commentaire : null, req.body.difficulte ?? null]);
    const after = await lockDefinition(c, before.id);
    await log(c, req.acteurId, action, 'definition', before.id, before, after);
    return after;
  });
  app.post('/api/moderation/:id/valider', {
    schema: { params: idParams, body: { type: ['object', 'null'], additionalProperties: false, properties: { difficulte: fields.difficulte } } },
    preHandler: async (req) => { req.body ??= {}; },
  }, moderate('valider'));
  app.post('/api/moderation/:id/refuser', {
    schema: { params: idParams, body: { type: 'object', required: ['commentaire'], additionalProperties: false,
      properties: { commentaire: { type: 'string', minLength: 1, maxLength: 140 } } } },
  }, moderate('refuser'));

  // ---- Thèmes ----
  app.get('/api/admin/themes', async () => (await pool.query(`
    SELECT t.id, t.nom, t.actif, t.systeme, t.cree_le, count(d.id)::int AS mots,
           count(d.id) FILTER (WHERE d.statut = 'validee')::int AS mots_valides
    FROM themes t LEFT JOIN definitions d ON d.theme_id = t.id AND d.supprimee_le IS NULL
    GROUP BY t.id ORDER BY t.cree_le, t.id`)).rows);

  const themeName = { type: 'string', minLength: 1, maxLength: 24 };
  app.post('/api/admin/themes', {
    schema: { body: { type: 'object', required: ['nom'], additionalProperties: false, properties: { nom: themeName, actif: { type: 'boolean', default: true } } } },
  }, async (req, reply) => {
    const id = slug(req.body.nom).slice(0, 40);
    if (!id) throw httpError(400, 'nom de thème invalide');
    const theme = await inTransaction(async (c) => {
      const { rows } = await c.query(
        'INSERT INTO themes (id, nom, actif, cree_par) VALUES ($1, $2, $3, $4) RETURNING id, nom, actif, systeme, cree_le',
        [id, req.body.nom.trim(), req.body.actif, req.acteurId]);
      await log(c, req.acteurId, 'theme_creer', 'theme', id, null, rows[0]);
      return rows[0];
    });
    return reply.code(201).send(theme);
  });

  app.patch('/api/admin/themes/:id', {
    schema: { params: { type: 'object', properties: { id: { type: 'string', maxLength: 40 } }, required: ['id'] },
      body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { nom: themeName, actif: { type: 'boolean' } } } },
  }, (req) => inTransaction(async (c) => {
    const { rows } = await c.query('SELECT id, nom, actif, systeme FROM themes WHERE id = $1 FOR UPDATE', [req.params.id]);
    const before = rows[0];
    if (!before) throw httpError(404, 'thème introuvable');
    if (before.systeme) throw httpError(409, 'thème système : non modifiable');
    const after = (await c.query(
      'UPDATE themes SET nom = COALESCE($2, nom), actif = COALESCE($3, actif) WHERE id = $1 RETURNING id, nom, actif, systeme',
      [before.id, req.body.nom?.trim() ?? null, req.body.actif ?? null])).rows[0];
    await log(c, req.acteurId, 'theme_modifier', 'theme', before.id, before, after);
    return after;
  }));

  // Un thème ne se supprime que s'il est vide ; sinon on le désactive.
  app.delete('/api/admin/themes/:id', {
    schema: { params: { type: 'object', properties: { id: { type: 'string', maxLength: 40 } }, required: ['id'] } },
  }, (req) => inTransaction(async (c) => {
    const { rows } = await c.query('SELECT id, nom, actif, systeme FROM themes WHERE id = $1 FOR UPDATE', [req.params.id]);
    const before = rows[0];
    if (!before) throw httpError(404, 'thème introuvable');
    if (before.systeme) throw httpError(409, 'thème système : non supprimable');
    const n = (await c.query('SELECT count(*)::int AS n FROM definitions WHERE theme_id = $1', [before.id])).rows[0].n;
    if (n) throw httpError(409, `${n} définition(s) utilisent ce thème : désactivez-le plutôt`);
    await c.query('DELETE FROM themes WHERE id = $1', [before.id]);
    await log(c, req.acteurId, 'theme_supprimer', 'theme', before.id, before, null);
    return { supprime: before.id };
  }));

  // ---- Export ----
  app.get('/api/admin/export.csv', { schema: { querystring: { ...listQuery, properties: { ...listQuery.properties, supprimees: { type: 'string', enum: ['non', 'oui', 'toutes'], default: 'non' } } } } },
    async (req, reply) => {
      const { sql, args } = listFilter(req.query);
      const { rows } = await pool.query(`SELECT ${COLUMNS} FROM definitions d ${sql} ORDER BY d.id`, args);
      const cols = ['id', 'reponse', 'reponse_saisie', 'texte', 'theme_id', 'difficulte', 'explication', 'source', 'statut', 'commentaire', 'cree_le', 'supprimee_le'];
      const csv = [cols.join(','), ...rows.map((r) => cols.map((k) => csvCell(r[k])).join(','))].join('\r\n');
      return reply.header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="definitions.csv"').send(`﻿${csv}\r\n`);
    });
}
