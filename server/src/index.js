// Point d'entrée du service : recharge les salons sauvegardés, puis écoute.
import { buildApp } from './app.js';
import { pool } from './db.js';
import { redis } from './redis.js';
import { stopGridWorker } from './game/grid.js';

const PORT = Number(process.env.PORT ?? 3100);

const { app, rooms } = await buildApp();
const restored = await rooms.restore();
if (restored) app.log.info(`${restored} salon(s) rechargé(s) depuis Redis`);

const shutdown = async () => {
  await app.close();
  await stopGridWorker();
  await pool.end();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ host: '127.0.0.1', port: PORT });
