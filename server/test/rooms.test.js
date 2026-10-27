// Tests des salons temps réel : de vrais clients Socket.IO contre le serveur démarré en mémoire.
// Les clés Redis utilisent le préfixe de test (voir le script « test ») ; la base n'est lue que pour
// la banque de mots, et l'enregistrement des parties est testé dans une transaction annulée.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { redis, REDIS_PREFIX } from '../src/redis.js';
import { stopGridWorker } from '../src/game/grid.js';
import { writeGame } from '../src/rooms/persist.js';

assert.notEqual(REDIS_PREFIX, 'pc:', 'les tests doivent tourner avec REDIS_PREFIX=pctest:');

const saved = [];
const servers = [];
const clients = [];

async function startServer() {
  const s = await buildApp({ logger: false, rooms: { onGameOver: async (room) => { saved.push(room); return 42; } } });
  await s.app.listen({ host: '127.0.0.1', port: 0 });
  s.url = `http://127.0.0.1:${s.app.server.address().port}`;
  servers.push(s);
  return s;
}

function client(url) {
  const c = connect(url, { transports: ['websocket'], forceNew: true });
  c.events = [];
  c.onAny((event, data) => c.events.push({ event, data }));
  clients.push(c);
  return c;
}
const send = (c, event, payload) => c.timeout(10000).emitWithAck(event, payload ?? {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(c, event, pred = () => true, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = c.events.find((x) => x.event === event && pred(x.data));
    if (e) return e.data;
    await sleep(20);
  }
  throw new Error(`${event} non reçu`);
}
const received = (c, event) => c.events.filter((x) => x.event === event).map((x) => x.data);

after(async () => {
  clients.forEach((c) => c.close());
  for (const s of servers) await s.app.close();
  await stopGridWorker();
  const keys = await redis.keys(`${REDIS_PREFIX}*`);
  if (keys.length) await redis.del(...keys.map((k) => k.slice(REDIS_PREFIX.length)));
  await pool.end();
  redis.disconnect();
});

// Trois joueurs dans un salon prêt à démarrer.
async function lobby(server, settings) {
  const [a, b, c] = [client(server.url), client(server.url), client(server.url)];
  const ra = await send(a, 'room:create', { pseudo: 'Alice', settings });
  assert.ok(ra.ok, ra.message);
  const rb = await send(b, 'room:join', { code: ra.code.toLowerCase(), pseudo: 'Bob' });
  const rc = await send(c, 'room:join', { code: ra.code, pseudo: 'Carole' });
  assert.ok(rb.ok && rc.ok);
  return { a, b, c, code: ra.code, room: server.rooms.rooms.get(ra.code), tokens: [ra.token, rb.token, rc.token] };
}

test('salon : création, entrée, réglages et droits', async () => {
  const s = await startServer();
  const { a, b, code, room } = await lobby(s);
  const x = client(s.url);

  assert.equal((await send(x, 'room:join', { code: 'ZZZZ', pseudo: 'X' })).error, 'salon_inconnu');
  assert.equal((await send(x, 'room:join', { code, pseudo: 'bob' })).error, 'pseudo_pris');
  assert.equal((await send(x, 'room:join', { code, pseudo: '   ' })).error, 'pseudo');
  assert.equal((await send(x, 'room:join', { code, pseudo: 'Pseudo beaucoup trop long' })).error, 'pseudo');

  assert.equal((await send(b, 'room:settings', { settings: { penWord: 5 } })).error, 'reserve_createur');
  assert.equal((await send(b, 'game:start')).error, 'reserve_createur');
  assert.equal((await send(a, 'room:settings', { settings: { mode: 'turbo' } })).error, 'reglages');
  assert.equal((await send(a, 'room:settings', { settings: { weights: { inconnu: 50 } } })).error, 'reglages');
  assert.equal((await send(a, 'room:settings', { settings: { weights: { films: 0, jv: 0 } } })).error, 'reglages');
  const ok = await send(a, 'room:settings', { settings: { penWord: 5, weights: { films: 60, jv: 40 } } });
  assert.ok(ok.ok);
  assert.deepEqual(room.settings.weights, { films: 60, jv: 40 });
  const state = await waitFor(b, 'room:state', (st) => st.settings.penWord === 5);
  assert.equal(state.players.length, 3);
  assert.equal(state.hostId, 'p1');

  // Le créateur part : Bob devient créateur.
  assert.ok((await send(a, 'room:leave')).ok);
  assert.equal(room.hostId, 'p2');
  assert.equal(room.players.length, 2);
});

test('partie classique complète : mots, erreurs, conflits, reconnexion, mot mystère, fin', async () => {
  const s = await startServer();
  const { a, b, c, code, room, tokens } = await lobby(s, { penWord: 10, penMyst: 30, startScore: 100 });

  assert.ok((await send(a, 'game:start')).ok);
  const grid = await waitFor(b, 'game:grid');
  await waitFor(c, 'game:grid');
  assert.equal(room.status, 'playing');
  assert.equal((await send(client(s.url), 'room:join', { code, pseudo: 'Tard' })).error, 'partie_en_cours');

  // Aucune solution dans ce que reçoivent les joueurs.
  const json = JSON.stringify(grid);
  assert.doesNotMatch(json, /"(ch|ans|expl|author)"/);
  assert.equal(grid.grid.words.length, room.game.grid.words.length);
  for (const w of room.game.grid.words) assert.ok(!json.includes(`"${w.ans}"`), `réponse ${w.ans} divulguée`);

  const words = room.game.grid.words;
  // Un mot sans lettre commune avec les autres réponses, pour une erreur nette.
  const wrong = words[0].ans.split('').map((ch) => (ch === 'Z' ? 'Y' : 'Z')).join('');

  // Erreur de Bob : pénalité pour lui seul, le score est diffusé à tous.
  const rw = await send(b, 'word:submit', { word: 0, letters: wrong });
  assert.deepEqual([rw.correct, rw.lost], [false, 10]);
  await waitFor(b, 'word:wrong');
  await waitFor(a, 'room:scores', (d) => d.scores.p2 === 90);
  assert.equal(received(a, 'word:wrong').length, 0);
  assert.equal((await send(b, 'word:submit', { word: 1, letters: words[1].ans })).error, 'trop_rapide');
  const short = words[0].ans.slice(1) || 'A';
  assert.equal((await send(a, 'word:submit', { word: 0, letters: short })).error, 'mot_incomplet');

  // Alice et Carole valident le même mot en même temps : une seule gagne, sans pénalité pour l'autre.
  await sleep(1000);
  const target = 2;
  const [r1, r2] = await Promise.all([
    send(a, 'word:submit', { word: target, letters: words[target].ans.toLowerCase() }),
    send(c, 'word:submit', { word: target, letters: words[target].ans }),
  ]);
  const results = [r1, r2];
  assert.equal(results.filter((r) => r.ok && r.correct).length, 1);
  assert.equal(results.filter((r) => r.error === 'deja_trouve').length, 1);
  const found = await waitFor(b, 'word:found', (d) => d.word === target);
  assert.equal(found.revealed[words[target].cells[0]], words[target].ans[0]);
  const winner = found.by;
  assert.equal(room.game.stats[winner === 'p1' ? 'p3' : 'p1'].pen, 0);

  // Carole recharge sa page : la reconnexion renvoie l'état complet.
  c.close();
  await sleep(100);
  assert.equal(room.players.length, 3);
  const c2 = client(s.url);
  const rr = await send(c2, 'room:resume', { token: tokens[2] });
  assert.ok(rr.ok);
  assert.equal(rr.you.pseudo, 'Carole');
  const sync = await waitFor(c2, 'game:grid');
  assert.equal(sync.found[target], winner);
  assert.equal(sync.revealed[words[target].cells[0]], words[target].ans[0]);
  assert.equal((await send(client(s.url), 'room:resume', { token: 'x'.repeat(24) })).error, 'session');

  // Le mot mystère est fermé tant que la grille n'est pas remplie à 80 %.
  assert.equal((await send(a, 'mystery:submit', { letters: 'ABCDE' })).error, 'mystere_ferme');

  // Les trois joueurs remplissent la grille, une tentative par seconde chacun.
  const players = [a, b, c2];
  let turn = 0, mysteryDone = false;
  while (room.status === 'playing') {
    const open = words.map((w, i) => i).filter((i) => room.game.found[i] == null);
    const batch = players.map((p, j) => [p, open[j]]).filter(([, i]) => i != null);
    await Promise.all(batch.map(([p, i]) => send(p, 'word:submit', { word: i, letters: words[i].ans })));
    if (!mysteryDone && room.game.grid.myst && room.status === 'playing') {
      const pct = room.game.letters.filter((k) => room.game.fill[k] != null).length / room.game.letters.length;
      if (pct >= 0.8) {
        const ans = room.game.grid.myst.ans;
        const bad = await send(c2, 'mystery:submit', { letters: 'Z'.repeat(ans.length) });
        assert.deepEqual([bad.ok, bad.correct], [true, false]);
        assert.equal((await send(c2, 'mystery:submit', { letters: ans })).error, 'mystere_ferme'); // une seule proposition
        assert.equal((await send(b, 'mystery:submit', { letters: ans.slice(1) })).error, 'mot_incomplet');
        const good = await send(b, 'mystery:submit', { letters: ans });
        assert.deepEqual([good.correct, good.pts], [true, 100]);
        assert.equal(room.game.final, null); // mode classique : la partie continue
        mysteryDone = true;
      }
    }
    if (++turn > 60) throw new Error('la partie ne se termine pas');
    await sleep(1010);
  }

  const over = await waitFor(a, 'game:over');
  assert.equal(over.reason, 'Grille complète.');
  assert.ok(over.grid.words.every((w) => typeof w.ans === 'string'));
  assert.ok(room.game.found.every((f) => f != null));
  const scores = over.ranking.map((p) => p.score);
  assert.deepEqual(scores, [...scores].sort((x, y) => y - x));
  // Total des points cohérent avec le détail de chaque joueur.
  for (const p of over.ranking) {
    assert.equal(p.score, p.start + p.wordPts + p.vierge + p.twins + p.comboPts + p.mystery - p.pen);
  }
  await sleep(50);
  assert.equal(saved.at(-1).code, code);
  assert.equal(room.partieId, 42);
  assert.equal((await send(a, 'word:submit', { word: 0, letters: words[0].ans })).error, 'pas_en_jeu');

  // Enregistrement en base, dans une transaction annulée.
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const id = await writeGame(db, room);
    const { rows: parts } = await db.query('SELECT pseudo, rang, score_final FROM participations WHERE partie_id = $1 ORDER BY rang', [id]);
    assert.equal(parts.length, 3);
    assert.deepEqual(parts.map((p) => p.score_final), scores);
    const { rows: [st] } = await db.query(
      'SELECT apparitions, erreurs FROM stats_definitions WHERE definition_id = $1', [words[0].id]);
    assert.ok(st.apparitions >= 1 && st.erreurs >= 1);
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
});

test('dernière chance : verrouillage après l\'essai, fin au compte à rebours', async () => {
  const s = await startServer();
  const { a, b, c, room } = await lobby(s, { mode: 'derniere_chance', lastTime: 5 });
  assert.ok((await send(a, 'game:start')).ok);
  await waitFor(c, 'game:grid');
  const g = room.game;
  assert.ok(g.grid.myst, 'grille sans mot mystère');

  // Raccourci de test : 85 % des lettres révélées directement dans l'état du serveur.
  const toFill = g.letters.slice(0, Math.ceil(g.letters.length * 0.85));
  toFill.forEach((k) => { g.fill[k] = 'p3'; });
  const open = g.grid.words.map((w, i) => i).filter((i) => g.grid.words[i].cells.some((k) => g.fill[k] == null));

  const r = await send(a, 'mystery:submit', { letters: g.grid.myst.ans });
  assert.ok(r.correct);
  const fin = await waitFor(b, 'final:start');
  assert.deepEqual(fin.pending.sort(), ['p2', 'p3']);

  // Alice a trouvé : elle ne joue plus. Bob utilise son essai sur un mot, puis est verrouillé.
  assert.equal((await send(a, 'word:submit', { word: open[0], letters: g.grid.words[open[0]].ans })).error, 'derniere_chance_jouee');
  const rb = await send(b, 'word:submit', { word: open[0], letters: g.grid.words[open[0]].ans });
  assert.ok(rb.correct);
  await waitFor(a, 'final:update', (d) => d.used === 'p2');
  await sleep(1000);
  assert.equal((await send(b, 'word:submit', { word: open[1], letters: g.grid.words[open[1]].ans })).error, 'derniere_chance_jouee');

  // Carole ne joue pas : la partie s'arrête à la fin du compte à rebours.
  const over = await waitFor(c, 'game:over', () => true, 8000);
  assert.match(over.reason, /Temps écoulé/);
  const alice = over.ranking.find((p) => p.pseudo === 'Alice');
  assert.deepEqual([alice.mOk, alice.mystery], [true, 100]);
});

test('dernière chance : la partie s\'arrête dès que tout le monde a joué', async () => {
  const s = await startServer();
  const { a, b, c, room } = await lobby(s, { mode: 'derniere_chance', lastTime: 60 });
  await send(a, 'game:start');
  await waitFor(c, 'game:grid');
  const g = room.game;
  g.letters.slice(0, Math.ceil(g.letters.length * 0.85)).forEach((k) => { g.fill[k] = 'p1'; });
  await send(a, 'mystery:submit', { letters: g.grid.myst.ans });
  const bad = await send(b, 'mystery:submit', { letters: 'Z'.repeat(g.grid.myst.ans.length) });
  assert.deepEqual([bad.correct, bad.pts], [false, -30]);
  const rc = await send(c, 'word:submit', { word: 0, letters: 'Z'.repeat(g.grid.words[0].ans.length) });
  assert.equal(rc.correct, false);
  const over = await waitFor(a, 'game:over');
  assert.match(over.reason, /chacun a joué sa dernière tentative/);

  // Rejouer : retour au salon avec les mêmes joueurs, puis une nouvelle partie.
  assert.equal((await send(b, 'room:rematch')).error, 'reserve_createur');
  assert.ok((await send(a, 'room:rematch')).ok);
  assert.equal(room.status, 'lobby');
  assert.equal((await send(a, 'room:rematch')).error, 'pas_finie');
  assert.ok((await send(a, 'game:start')).ok);
  const again = await waitFor(c, 'game:grid', (d) => d.startedAt !== g.startedAt);
  assert.ok(Math.abs(again.serverNow - Date.now()) < 5000);
  assert.ok(Object.values(again.scores).every((v) => v === 100));
});

test('thèmes et fichiers servis', async () => {
  const s = await startServer();
  const themes = await (await fetch(`${s.url}/api/themes`)).json();
  assert.ok(themes.some((t) => t.id === 'films' && t.mots > 0));
  assert.ok(!themes.some((t) => t.id === 'mot_courant'));
  assert.equal((await fetch(`${s.url}/socket.io/socket.io.min.js`)).status, 200);
  assert.equal((await fetch(`${s.url}/proto/pc/`)).status, 200);
});

test('redémarrage : salons rechargés depuis Redis, sessions toujours valables', async () => {
  const s1 = await startServer();
  const { code, tokens } = await lobby(s1);
  await sleep(100); // laisse partir les sauvegardes Redis

  const s2 = await startServer();
  assert.ok((await s2.rooms.restore()) >= 1);
  const room = s2.rooms.rooms.get(code);
  assert.equal(room.players.length, 3);
  const b = client(s2.url);
  const rr = await send(b, 'room:resume', { token: tokens[1] });
  assert.ok(rr.ok);
  assert.equal(rr.you.pseudo, 'Bob');
});
