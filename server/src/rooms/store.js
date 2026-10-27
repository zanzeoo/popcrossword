// Ce que les salons confient à Redis : limite de fréquence, jetons de reconnexion,
// et une sauvegarde de chaque salon pour survivre à un redémarrage du service.
import { randomBytes } from 'node:crypto';
import { redis, REDIS_PREFIX } from '../redis.js';

const ROOM_TTL_S = 6 * 3600;
const SESSION_TTL_S = 6 * 3600;

// true si le joueur peut tenter un mot : une tentative par seconde.
export async function takeAttempt(code, pid) {
  return (await redis.set(`rl:${code}:${pid}`, '1', 'PX', 1000, 'NX')) === 'OK';
}

export async function createSession(code, pid) {
  const token = randomBytes(18).toString('base64url');
  await redis.set(`sess:${token}`, JSON.stringify({ code, pid }), 'EX', SESSION_TTL_S);
  return token;
}

export async function readSession(token) {
  if (typeof token !== 'string' || !/^[\w-]{24}$/.test(token)) return null;
  const raw = await redis.get(`sess:${token}`);
  if (!raw) return null;
  await redis.expire(`sess:${token}`, SESSION_TTL_S);
  return JSON.parse(raw);
}

export const saveRoom = (room) => redis.set(`room:${room.code}`, JSON.stringify(room), 'EX', ROOM_TTL_S);
export const deleteRoom = (code) => redis.del(`room:${code}`);

export async function loadRooms() {
  const rooms = [];
  let cursor = '0';
  do {
    // SCAN ne préfixe pas le motif tout seul, et renvoie les clés complètes.
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${REDIS_PREFIX}room:*`, 'COUNT', 100);
    cursor = next;
    for (const key of keys) {
      const raw = await redis.get(key.slice(REDIS_PREFIX.length));
      if (raw) rooms.push(JSON.parse(raw));
    }
  } while (cursor !== '0');
  return rooms;
}
