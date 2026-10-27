// Salons temps réel (voir docs/architecture.md, « Temps réel : messages d'une partie »).
// L'état fait autorité ici, en mémoire ; chaque changement est sauvegardé dans Redis pour
// survivre à un redémarrage. Chaque message client reçoit un accusé { ok, ... } ou { ok: false, error, message }.
import { pool } from '../db.js';
import { generateGameGrid } from '../game/grid.js';
import { publicGrid } from '../game/generator.js';
import * as rules from './rules.js';
import * as store from './store.js';
import { saveGame } from './persist.js';

export const MAX_PLAYERS = 8, MIN_PLAYERS = 2;
const IDLE_MS = 30 * 60 * 1000;        // salon sans joueur connecté
const OVER_KEEP_MS = 2 * 3600 * 1000;  // récapitulatif encore consultable après la fin

// Couleurs des joueurs, reprises du prototype.
const PALETTE = [
  { color: '#1D4ED8', tint: '#DBEAFE' }, { color: '#C2410C', tint: '#FFEDD5' },
  { color: '#15803D', tint: '#DCFCE7' }, { color: '#BE185D', tint: '#FCE7F3' },
  { color: '#6D28D9', tint: '#EDE9FE' }, { color: '#0F766E', tint: '#CCFBF1' },
  { color: '#111827', tint: '#E5E7EB' }, { color: '#4D7C0F', tint: '#ECFCCB' },
];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const DEFAULT_SETTINGS = {
  mode: 'classique', startScore: 100, penWord: 10, penMyst: 30, lastTime: 20,
  weights: { films: 20, anim: 20, jv: 15, musique: 15, persos: 15, sagas: 15 },
};

const ERRORS = {
  invalide: 'Requête invalide.',
  pseudo: 'Pseudo de 1 à 12 caractères.',
  pseudo_pris: 'Ce pseudo est déjà pris dans le salon.',
  salon_inconnu: 'Aucun salon avec ce code.',
  salon_plein: `Le salon est complet (${MAX_PLAYERS} joueurs).`,
  partie_en_cours: 'La partie a déjà commencé.',
  session: 'Session expirée : rejoins le salon avec son code.',
  hors_salon: "Tu n'es dans aucun salon.",
  reserve_createur: 'Réservé au créateur du salon.',
  reglages: 'Réglages invalides.',
  pas_assez: `Il faut au moins ${MIN_PLAYERS} joueurs.`,
  pas_en_jeu: "Aucune partie en cours.",
  pas_finie: "La partie n'est pas terminée.",
  trop_rapide: 'Une tentative par seconde.',
  mot_incomplet: 'Tape le mot en entier avant de valider.',
  deja_trouve: 'Mot déjà trouvé.',
  derniere_chance_jouee: 'Ta dernière tentative est déjà jouée.',
  mystere_ferme: 'Le mot mystère ne peut pas encore être proposé.',
  generation: "La grille n'a pas pu être générée, réessaie.",
  interne: 'Erreur interne du serveur.',
};
const fail = (error, extra) => ({ ok: false, error, message: ERRORS[error], ...extra });

// Pseudo : texte simple, sans caractères de contrôle, 1 à 12 caractères.
function cleanPseudo(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim();
  const n = [...s].length;
  return n >= 1 && n <= 12 ? s : null;
}

// Lettres tapées : majuscules sans accents, A à Z uniquement.
function cleanLetters(v) {
  if (typeof v !== 'string') return null;
  const s = v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return /^[A-Z]{1,10}$/.test(s) ? s : null;
}

async function activeThemes() {
  const { rows } = await pool.query('SELECT id FROM themes WHERE actif AND NOT systeme');
  return new Set(rows.map((r) => r.id));
}

// Fusionne des réglages partiels avec les réglages actuels, ou renvoie null s'ils sont invalides.
async function mergeSettings(current, patch) {
  if (patch == null) return current;
  if (typeof patch !== 'object' || Array.isArray(patch)) return null;
  const s = { ...current, weights: { ...current.weights } };
  const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : undefined);
  const ranges = { startScore: [0, 1000], penWord: [0, 500], penMyst: [0, 500], lastTime: [5, 120] };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (patch[key] === undefined) continue;
    if ((s[key] = int(patch[key], min, max)) === undefined) return null;
  }
  if (patch.mode !== undefined) {
    if (!['classique', 'derniere_chance'].includes(patch.mode)) return null;
    s.mode = patch.mode;
  }
  if (patch.weights !== undefined) {
    if (typeof patch.weights !== 'object' || patch.weights === null) return null;
    const themes = await activeThemes();
    const w = {};
    for (const [k, v] of Object.entries(patch.weights)) {
      if (!themes.has(k) || typeof v !== 'number' || !(v >= 0 && v <= 100)) return null;
      w[k] = v;
    }
    if (!Object.values(w).some((v) => v > 0)) return null;
    s.weights = w;
  }
  return s;
}

export function createRooms(io, { log = console, onGameOver = saveGame, generate = generateGameGrid } = {}) {
  const rooms = new Map();   // code -> salon
  const online = new Map();  // code -> Map(pid -> nombre de sockets ouverts)
  const timers = new Map();  // code -> minuteur de la dernière chance

  const persist = (room) => store.saveRoom(room).catch((err) => log.error({ err, code: room.code }, 'sauvegarde Redis'));
  const touch = (room) => { room.lastActivity = Date.now(); };

  function newCode() {
    let code;
    do {
      code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    } while (rooms.has(code));
    return code;
  }

  function isOnline(code, pid) { return (online.get(code)?.get(pid) ?? 0) > 0; }

  function roomState(room) {
    return {
      code: room.code,
      status: room.status,
      hostId: room.hostId,
      settings: room.settings,
      players: room.players.map((p) => ({ ...p, online: isOnline(room.code, p.id) })),
    };
  }
  const broadcastState = (room) => io.to(room.code).emit('room:state', roomState(room));
  const scores = (game) => Object.fromEntries(Object.entries(game.stats).map(([id, st]) => [id, st.score]));

  // Tout ce qu'il faut pour afficher une partie en cours, sans les solutions.
  function gameSync(room, pid) {
    const g = room.game;
    const revealed = {};
    g.fill.forEach((by, k) => { if (by != null) revealed[k] = g.grid.cells[k].ch; });
    const st = g.stats[pid];
    return {
      grid: publicGrid(g.grid),
      startedAt: g.startedAt,
      revealed, fill: g.fill, found: g.found, how: g.how,
      scores: scores(g),
      fillPct: rules.fillPct(g),
      final: g.final,
      serverNow: Date.now(), // le client en déduit le décalage de son horloge
      you: st ? { id: pid, mAttempt: st.mAttempt, mOk: st.mOk, locked: rules.locked(g, pid) } : null,
    };
  }

  function overPayload(room) {
    const g = room.game;
    return {
      reason: g.reason,
      durationMs: g.endedAt - g.startedAt,
      ranking: rules.ranking(g, room.players),
      grid: g.grid, // solutions comprises : la partie est finie
      found: g.found, how: g.how, fill: g.fill,
    };
  }

  function attach(socket, room, pid) {
    socket.data.code = room.code;
    socket.data.pid = pid;
    socket.join(room.code);
    socket.join(`${room.code}:${pid}`);
    if (!online.has(room.code)) online.set(room.code, new Map());
    const m = online.get(room.code);
    m.set(pid, (m.get(pid) ?? 0) + 1);
  }

  function detach(socket) {
    const { code, pid } = socket.data;
    if (!code) return;
    socket.leave(code);
    socket.leave(`${code}:${pid}`);
    socket.data.code = socket.data.pid = undefined;
    const m = online.get(code);
    if (m) {
      const n = (m.get(pid) ?? 1) - 1;
      if (n > 0) m.set(pid, n); else m.delete(pid);
    }
    const room = rooms.get(code);
    if (room) broadcastState(room);
  }

  function addPlayer(room, pseudo) {
    const color = PALETTE.find((c) => !room.players.some((p) => p.color === c.color));
    const player = { id: `p${room.nextPid++}`, pseudo, ...color };
    room.players.push(player);
    return player;
  }

  function findRoom(socket) {
    const room = rooms.get(socket.data.code);
    return room && room.players.some((p) => p.id === socket.data.pid) ? room : null;
  }

  function finish(room, reason) {
    const g = room.game;
    if (room.status !== 'playing') return;
    room.status = 'over';
    g.endedAt = Date.now();
    g.reason = reason;
    clearTimeout(timers.get(room.code));
    timers.delete(room.code);
    io.to(room.code).emit('game:over', overPayload(room));
    broadcastState(room);
    persist(room);
    Promise.resolve(onGameOver(room))
      .then((partieId) => { room.partieId = partieId; persist(room); })
      .catch((err) => log.error({ err, code: room.code }, 'enregistrement de la partie'));
  }

  function armFinal(room) {
    const g = room.game;
    clearTimeout(timers.get(room.code));
    timers.set(room.code, setTimeout(() => {
      timers.delete(room.code);
      if (room.status !== 'playing' || !g.final) return;
      finish(room, `${pseudoOf(room, g.final.by)} a trouvé le mot mystère. Temps écoulé pour la dernière tentative.`);
    }, Math.max(0, g.final.endsAt - Date.now())));
  }

  const pseudoOf = (room, pid) => room.players.find((p) => p.id === pid)?.pseudo ?? '?';

  // Essai de dernière chance consommé : la partie s'arrête quand plus personne n'est attendu.
  function afterAttempt(room, pid) {
    const g = room.game;
    if (!g.final) return;
    const done = rules.useFinal(g, pid);
    io.to(room.code).emit('final:update', { pending: g.final.pending, used: pid });
    if (done) finish(room, `${pseudoOf(room, g.final.by)} a trouvé le mot mystère, puis chacun a joué sa dernière tentative.`);
  }

  function checkComplete(room) {
    if (room.status === 'playing' && rules.isComplete(room.game)) finish(room, 'Grille complète.');
  }

  // ---------------- Messages des joueurs ----------------

  const handlers = {
    async 'room:create'(socket, { pseudo, settings } = {}) {
      const name = cleanPseudo(pseudo);
      if (!name) return fail('pseudo');
      const merged = await mergeSettings(DEFAULT_SETTINGS, settings);
      if (!merged) return fail('reglages');
      detach(socket);
      const now = Date.now();
      const room = {
        code: newCode(), status: 'lobby', hostId: null, createdAt: now, lastActivity: now,
        settings: merged, players: [], nextPid: 1, game: null,
      };
      const you = addPlayer(room, name);
      room.hostId = you.id;
      rooms.set(room.code, room);
      attach(socket, room, you.id);
      const token = await store.createSession(room.code, you.id);
      persist(room);
      broadcastState(room);
      return { ok: true, code: room.code, token, you };
    },

    async 'room:join'(socket, { code, pseudo } = {}) {
      const room = rooms.get(typeof code === 'string' ? code.trim().toUpperCase() : '');
      if (!room) return fail('salon_inconnu');
      const name = cleanPseudo(pseudo);
      if (!name) return fail('pseudo');
      if (room.status !== 'lobby') return fail('partie_en_cours');
      if (room.players.length >= MAX_PLAYERS) return fail('salon_plein');
      if (room.players.some((p) => p.pseudo.toLowerCase() === name.toLowerCase())) return fail('pseudo_pris');
      detach(socket);
      const you = addPlayer(room, name);
      touch(room);
      attach(socket, room, you.id);
      const token = await store.createSession(room.code, you.id);
      persist(room);
      broadcastState(room);
      return { ok: true, code: room.code, token, you };
    },

    // Reconnexion (onglet rechargé, téléphone qui a coupé le réseau…) : état complet renvoyé.
    async 'room:resume'(socket, { token } = {}) {
      const sess = await store.readSession(token);
      const room = sess && rooms.get(sess.code);
      const you = room?.players.find((p) => p.id === sess.pid);
      if (!you) return fail('session');
      detach(socket);
      attach(socket, room, you.id);
      touch(room);
      broadcastState(room);
      if (room.status === 'playing') socket.emit('game:grid', gameSync(room, you.id));
      if (room.status === 'over') socket.emit('game:over', overPayload(room));
      return { ok: true, code: room.code, you };
    },

    async 'room:leave'(socket) {
      const room = findRoom(socket);
      if (!room) return fail('hors_salon');
      const pid = socket.data.pid;
      detach(socket);
      // En partie, le joueur reste au classement ; dans le salon d'attente, il libère sa place.
      if (room.status === 'lobby') {
        room.players = room.players.filter((p) => p.id !== pid);
        if (!room.players.length) {
          rooms.delete(room.code);
          store.deleteRoom(room.code).catch(() => {});
          return { ok: true };
        }
        if (room.hostId === pid) room.hostId = room.players[0].id;
        persist(room);
        broadcastState(room);
      }
      return { ok: true };
    },

    async 'room:settings'(socket, { settings } = {}) {
      const room = findRoom(socket);
      if (!room) return fail('hors_salon');
      if (room.hostId !== socket.data.pid) return fail('reserve_createur');
      if (room.status !== 'lobby') return fail('partie_en_cours');
      const merged = await mergeSettings(room.settings, settings);
      if (!merged) return fail('reglages');
      room.settings = merged;
      touch(room);
      persist(room);
      broadcastState(room);
      return { ok: true, settings: merged };
    },

    async 'game:start'(socket) {
      const room = findRoom(socket);
      if (!room) return fail('hors_salon');
      if (room.hostId !== socket.data.pid) return fail('reserve_createur');
      if (room.status !== 'lobby') return fail('partie_en_cours');
      if (room.players.length < MIN_PLAYERS) return fail('pas_assez');
      room.status = 'starting'; // bloque les arrivées et un second lancement pendant la génération
      broadcastState(room);
      let grid;
      try {
        grid = await generate(room.settings.weights);
      } catch (err) {
        log.error({ err, code: room.code }, 'génération de grille');
      }
      if (!grid) {
        room.status = 'lobby';
        broadcastState(room);
        return fail('generation');
      }
      room.game = rules.newGame(grid, room.players, room.settings);
      room.status = 'playing';
      touch(room);
      persist(room);
      broadcastState(room);
      for (const p of room.players) io.to(`${room.code}:${p.id}`).emit('game:grid', gameSync(room, p.id));
      return { ok: true };
    },

    // Après une partie : retour au salon d'attente avec les mêmes joueurs et les mêmes réglages.
    async 'room:rematch'(socket) {
      const room = findRoom(socket);
      if (!room) return fail('hors_salon');
      if (room.hostId !== socket.data.pid) return fail('reserve_createur');
      if (room.status !== 'over') return fail('pas_finie');
      room.status = 'lobby';
      room.game = null;
      touch(room);
      persist(room);
      broadcastState(room);
      return { ok: true };
    },

    async 'word:submit'(socket, { word, letters } = {}) {
      const room = findRoom(socket);
      if (!room) return fail('hors_salon');
      if (room.status !== 'playing') return fail('pas_en_jeu');
      const pid = socket.data.pid, g = room.game;
      const w = Number.isInteger(word) ? g.grid.words[word] : undefined;
      const guess = cleanLetters(letters);
      if (!w || !guess) return fail('invalide');
      if (guess.length !== w.ans.length) return fail('mot_incomplet');
      if (!(await store.takeAttempt(room.code, pid))) return fail('trop_rapide');
      // Revérifié après l'attente Redis : le premier message traité gagne.
      if (room.status !== 'playing') return fail('pas_en_jeu');
      if (rules.locked(g, pid)) return fail('derniere_chance_jouee');
      if (g.found[word] != null) return fail('deja_trouve', { by: g.found[word] });
      touch(room);
      if (guess === w.ans) {
        const res = rules.claimWord(g, word, pid);
        io.to(room.code).emit('word:found', { ...res, scores: scores(g), fillPct: rules.fillPct(g) });
        afterAttempt(room, pid);
        checkComplete(room);
        persist(room);
        return { ok: true, correct: true, pts: res.base + res.vierge };
      }
      g.wrong[word]++;
      const lost = rules.penalize(g, pid, room.settings.penWord);
      io.to(`${room.code}:${pid}`).emit('word:wrong', { word, lost, score: g.stats[pid].score });
      io.to(room.code).emit('room:scores', { scores: scores(g), penalty: { by: pid, lost } });
      afterAttempt(room, pid);
      persist(room);
      return { ok: true, correct: false, lost };
    },

    async 'mystery:submit'(socket, { letters } = {}) {
      const room = findRoom(socket);
      if (!room) return fail('hors_salon');
      if (room.status !== 'playing') return fail('pas_en_jeu');
      const pid = socket.data.pid, g = room.game;
      if (rules.locked(g, pid)) return fail('derniere_chance_jouee');
      if (!rules.canProposeMystery(g, pid)) return fail('mystere_ferme');
      const guess = cleanLetters(letters);
      if (!guess) return fail('invalide');
      if (guess.length !== g.grid.myst.ans.length) return fail('mot_incomplet', { len: g.grid.myst.ans.length });
      touch(room);
      const res = rules.proposeMystery(g, pid, guess, room.settings.penMyst);
      io.to(room.code).emit('mystery:result', { by: pid, ok: res.ok, pts: res.pts, scores: scores(g) });
      if (res.ok && !g.final && room.settings.mode === 'derniere_chance') {
        rules.startFinal(g, pid, room.settings.lastTime, room.players.map((p) => p.id));
        io.to(room.code).emit('final:start', { ...g.final, serverNow: Date.now() });
        if (!g.final.pending.length) finish(room, `${pseudoOf(room, pid)} a trouvé le mot mystère.`);
        else armFinal(room);
      } else {
        afterAttempt(room, pid);
      }
      persist(room);
      return { ok: true, correct: res.ok, pts: res.pts };
    },
  };

  io.on('connection', (socket) => {
    for (const [event, fn] of Object.entries(handlers)) {
      socket.on(event, async (payload, ack) => {
        if (typeof payload === 'function') { ack = payload; payload = undefined; }
        let res;
        try {
          res = await fn(socket, payload && typeof payload === 'object' ? payload : undefined);
        } catch (err) {
          log.error({ err, event }, 'message de salon');
          res = fail('interne');
        }
        if (typeof ack === 'function') ack(res);
      });
    }
    socket.on('disconnect', () => detach(socket));
  });

  // Ménage : salons abandonnés et récapitulatifs trop anciens.
  function sweep(now = Date.now()) {
    for (const room of rooms.values()) {
      const idle = !online.get(room.code)?.size && now - room.lastActivity > IDLE_MS;
      const old = room.status === 'over' && now - room.game.endedAt > OVER_KEEP_MS;
      if (idle || old) {
        clearTimeout(timers.get(room.code));
        timers.delete(room.code);
        rooms.delete(room.code);
        online.delete(room.code);
        store.deleteRoom(room.code).catch(() => {});
      }
    }
  }
  const sweepTimer = setInterval(sweep, 60 * 1000);
  sweepTimer.unref();

  // Après un redémarrage : salons rechargés depuis Redis, minuteurs réarmés.
  async function restore() {
    for (const room of await store.loadRooms()) {
      if (room.status === 'starting') room.status = 'lobby'; // génération interrompue
      rooms.set(room.code, room);
      if (room.status === 'playing' && room.game.final) armFinal(room);
    }
    return rooms.size;
  }

  function close() {
    clearInterval(sweepTimer);
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  }

  return { rooms, restore, sweep, close };
}
