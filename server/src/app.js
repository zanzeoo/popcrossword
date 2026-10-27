// Construit le serveur : API REST (Fastify) et salons temps réel (Socket.IO) sur le même port.
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import { redis } from './redis.js';
import { createRooms } from './rooms/rooms.js';

// Chaque vérification abandonne au bout de 2 s pour que la sonde réponde même si un service est tombé.
const check = (promise) => Promise.race([
  promise.then(() => 'ok', (e) => e.message || String(e)),
  new Promise((resolve) => setTimeout(resolve, 2000, 'timeout')),
]);

export async function buildApp({ logger = true, rooms: roomOptions } = {}) {
  const app = Fastify({ logger, trustProxy: '127.0.0.1' });

  // Les clients connectés (la racine aiguille vers /pc/ ou /mobile/) ; les prototypes hors ligne
  // restent consultables sous /proto/.
  await app.register(fastifyStatic, {
    root: fileURLToPath(new URL('../../client', import.meta.url)),
  });
  await app.register(fastifyStatic, {
    root: fileURLToPath(new URL('../../prototypes', import.meta.url)),
    prefix: '/proto/',
    decorateReply: false,
  });

  // Thèmes proposés dans le salon, avec le nombre de mots jouables de chacun.
  app.get('/api/themes', async () => {
    const { rows } = await pool.query(`
      SELECT t.id, t.nom, count(d.id)::int AS mots
      FROM themes t
      LEFT JOIN definitions d ON d.theme_id = t.id AND d.statut = 'validee' AND d.supprimee_le IS NULL
      WHERE t.actif AND NOT t.systeme
      GROUP BY t.id, t.nom, t.cree_le
      ORDER BY t.cree_le, t.id`);
    return rows;
  });

  app.get('/api/health', async (req, reply) => {
    const checks = {
      postgres: await check(pool.query('SELECT 1')),
      redis: await check(redis.ping()),
    };
    const ok = Object.values(checks).every((v) => v === 'ok');
    return reply.code(ok ? 200 : 503).send({ ok, ...checks });
  });

  // Les WebSockets échappent au contrôle CORS des navigateurs : on n'accepte que les pages du site.
  // Sans en-tête Origin (outils, tests), la connexion reste possible.
  const origin = process.env.PUBLIC_ORIGIN ?? 'https://popcrossword.zanzeoo.fr';
  const io = new Server(app.server, {
    serveClient: true, // /socket.io/socket.io.min.js pour le client
    allowRequest: (req, cb) => cb(null, !req.headers.origin || req.headers.origin === origin),
  });
  const rooms = createRooms(io, { log: app.log, ...roomOptions });
  app.addHook('onClose', async () => {
    rooms.close();
    io.close();
  });

  return { app, io, rooms };
}
