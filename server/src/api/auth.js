// Authentification provisoire de l'API d'édition : un jeton partagé (ADMIN_TOKEN) en « Bearer ».
// Il vaut rôle admin. Sans ADMIN_TOKEN, les routes protégées répondent 503. La vraie authentification
// par rôles (joueur, modérateur, admin) remplacera ce garde sans changer les routes.
import { timingSafeEqual, createHash } from 'node:crypto';
import { pool } from '../db.js';

const digest = (s) => createHash('sha256').update(s).digest();

// Le compte qui signe les lignes du journal.
let actorId;
async function adminActor() {
  actorId ??= (await pool.query(
    `INSERT INTO joueurs (pseudo, role)
     SELECT 'admin', 'admin' WHERE NOT EXISTS (SELECT 1 FROM joueurs WHERE pseudo = 'admin' AND role = 'admin')
     RETURNING id`,
  )).rows[0]?.id ?? (await pool.query(`SELECT id FROM joueurs WHERE pseudo = 'admin' AND role = 'admin' ORDER BY id LIMIT 1`)).rows[0].id;
  return Number(actorId);
}

export async function requireAdmin(req, reply) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return reply.code(503).send({ erreur: 'API d’édition désactivée (ADMIN_TOKEN absent)' });
  const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
  if (!timingSafeEqual(digest(given), digest(expected))) {
    return reply.code(401).header('www-authenticate', 'Bearer').send({ erreur: 'jeton invalide' });
  }
  req.acteurId = await adminActor();
}
