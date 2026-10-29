// Test de bout en bout du client PC : deux navigateurs jouent une partie sur un serveur local.
// Lancer avec « npm run e2e » (voir le README).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const SRV = new URL('../src', import.meta.url).pathname;
const OUT = new URL('./shots/', import.meta.url).pathname;
await import('node:fs/promises').then((fs) => fs.mkdir(OUT, { recursive: true }));
const PORT = 3199, URL_ = `http://127.0.0.1:${PORT}`;
process.env.PUBLIC_ORIGIN = URL_;

const { buildApp } = await import(`${SRV}/app.js`);
const { pool } = await import(`${SRV}/db.js`);
const { redis, REDIS_PREFIX } = await import(`${SRV}/redis.js`);
const { stopGridWorker } = await import(`${SRV}/game/grid.js`);
assert.notEqual(REDIS_PREFIX, 'pc:', 'lancer avec npm run e2e (préfixe Redis de test)');

const { app, rooms } = await buildApp({ logger: false, rooms: { onGameOver: async () => 1 } });
await app.listen({ host: '127.0.0.1', port: PORT });

const browser = await chromium.launch();
const errors = [];
async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  return page;
}
const step = (msg) => console.log('•', msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const alice = await player('Alice'), bob = await player('Bob');
  globalThis.__a = alice; globalThis.__b = bob;

  step('Alice crée un salon');
  await alice.goto(`${URL_}/`);
  await alice.fill('#hPseudo', 'Alice');
  await alice.click('#hCreate');
  await alice.waitForSelector('#scrLobby.on');
  const code = (await alice.textContent('#lCode')).trim();
  assert.match(code, /^[A-Z0-9]{4}$/);
  assert.match(await alice.inputValue('#lLink'), new RegExp(`:${PORT}/\\?code=${code}$`));
  // Seule dans le salon, la créatrice peut déjà lancer une partie en solo.
  assert.ok(await alice.isEnabled('#lStart'));
  assert.equal((await alice.textContent('#lStart')).trim(), 'Lancer la partie en solo');

  step(`Bob rejoint avec le lien d'invitation (${code})`);
  await bob.goto(`${URL_}/pc/?code=${code}`);
  assert.equal(await bob.inputValue('#hCode'), code);
  await bob.fill('#hPseudo', 'Bob');
  await bob.click('#hJoin');
  await bob.waitForSelector('#scrLobby.on');
  await alice.waitForFunction(() => document.querySelectorAll('#lPlayers .pill').length === 2);
  assert.ok(await bob.isHidden('#lStart'));
  await alice.waitForFunction(() => document.querySelector('#lStart').textContent.trim() === 'Lancer la partie');
  assert.ok(await bob.isDisabled('#lStartScore'));

  step('Alice règle la partie, Bob voit les réglages');
  await alice.click('#lMode [data-v=derniere_chance]');
  await alice.fill('#lPenWord', '15');
  await alice.press('#lPenWord', 'Tab');
  await alice.locator('#th_films').fill('60');
  await bob.waitForFunction(() => document.querySelector('#lMode [data-v=derniere_chance]').getAttribute('aria-pressed') === 'true'
    && document.querySelector('#lPenWord').value === '15' && document.querySelector('#tho_films').textContent === '60 %', null, { timeout: 5000 });
  await alice.screenshot({ path: `${OUT}1-salon-alice.png` });
  await bob.screenshot({ path: `${OUT}2-salon-bob.png` });

  step('Alice lance la partie');
  await alice.click('#lStart');
  await Promise.all([alice.waitForSelector('#scrGame.on'), bob.waitForSelector('#scrGame.on')]);
  const room = rooms.rooms.get(code);
  const words = room.game.grid.words;
  assert.equal(await bob.locator('#gGrid .cell').count(), 130);
  // Aucune réponse dans la page de Bob.
  const leaked = await bob.evaluate((ans) => ans.filter((a) => a.length >= 4 && JSON.stringify(G).includes(`"${a}"`)), words.map((w) => w.ans));
  assert.deepEqual(leaked, []);

  // Saisie au clavier comme un joueur : choisir le mot, taper, Entrée.
  async function play(page, wi, letters) {
    await page.evaluate((i) => { selectWord(i, G.words[i].cells[0]); render(); }, wi);
    await page.keyboard.type(letters.toLowerCase(), { delay: 10 });
    await page.keyboard.press('Enter');
  }

  step('Alice trouve un mot au clavier');
  await play(alice, 0, words[0].ans);
  await bob.waitForFunction((k) => document.querySelectorAll('#gGrid .cell')[k].querySelector('.l')?.textContent.length === 1, words[0].cells[0]);
  const cellColor = await bob.evaluate((k) => getComputedStyle(document.querySelectorAll('#gGrid .cell')[k].querySelector('.l')).color, words[0].cells[0]);
  assert.equal(cellColor, 'rgb(29, 78, 216)'); // couleur d'Alice
  assert.match(await bob.textContent('#gFeed'), new RegExp(`Alice trouve ${words[0].ans}`));

  step('Bob se trompe');
  const wrongIdx = words.findIndex((w, i) => room.game.found[i] == null);
  await play(bob, wrongIdx, 'Z'.repeat(words[wrongIdx].ans.length));
  await bob.waitForFunction(() => /Raté : −15 points/.test(document.querySelector('#gClue').textContent));
  await alice.waitForFunction(() => /Bob se trompe −15/.test(document.querySelector('#gFeed').textContent));
  await bob.screenshot({ path: `${OUT}3-partie-bob-erreur.png` });

  step('Bob recharge sa page en pleine partie');
  await bob.reload();
  await bob.waitForSelector('#scrGame.on');
  await bob.waitForFunction((k) => document.querySelectorAll('#gGrid .cell')[k].querySelector('.l')?.textContent.length === 1, words[0].cells[0]);
  assert.equal((await bob.textContent('#gScores')).includes('85'), true);

  step('Les deux joueurs remplissent la grille jusqu\'à 80 %');
  const pct = () => { const g = room.game; return g.letters.filter((k) => g.fill[k] != null).length / g.letters.length; };
  let turn = 0;
  while (pct() < 0.8) {
    const open = words.map((w, i) => i).filter((i) => room.game.found[i] == null);
    const p = turn++ % 2 ? bob : alice;
    await play(p, open[0], words[open[0]].ans);
    await sleep(550);
  }
  await alice.waitForSelector('[data-m=open]');

  step('Alice propose le mot mystère : dernière chance pour Bob');
  await alice.click('[data-m=open]');
  await alice.keyboard.type(room.game.grid.myst.ans.toLowerCase(), { delay: 10 });
  await alice.keyboard.press('Enter');
  await bob.waitForSelector('#gFinal:not([hidden])');
  assert.match(await bob.textContent('#gFinal'), /Alice.*a trouvé le mot mystère/);
  await bob.screenshot({ path: `${OUT}4-derniere-chance-bob.png` });

  step('Bob joue sa dernière tentative : fin de partie');
  const open = words.map((w, i) => i).filter((i) => room.game.found[i] == null);
  await sleep(1000);
  await play(bob, open[0], words[open[0]].ans);
  await Promise.all([alice.waitForSelector('#scrRecap.on'), bob.waitForSelector('#scrRecap.on')]);
  assert.match(await alice.textContent('#recap'), /chacun a joué sa dernière tentative/);
  assert.match(await bob.textContent('#recap'), new RegExp(room.game.grid.myst.ans));
  assert.ok(await bob.isHidden('#rAgain'));
  await alice.screenshot({ path: `${OUT}5-recap-alice.png`, fullPage: true });

  step('Bob revoit la grille');
  await bob.click('#rReview');
  await bob.waitForSelector('#scrGame.on');
  assert.match(await bob.textContent('#gClue'), /Revoir la grille/);
  await bob.screenshot({ path: `${OUT}6-revue-bob.png` });
  await bob.keyboard.press('Escape');
  await bob.waitForSelector('#scrRecap.on');

  step('Alice relance : tout le monde revient au salon');
  await alice.click('#rAgain');
  await Promise.all([alice.waitForSelector('#scrLobby.on'), bob.waitForSelector('#scrLobby.on')]);

  step('Bob quitte le salon');
  await bob.click('#lLeave');
  await bob.waitForSelector('#scrHome.on');
  await alice.waitForFunction(() => document.querySelectorAll('#lPlayers .pill').length === 1);

  assert.deepEqual(errors, []);
  console.log('\nTOUT EST OK');
} catch (err) {
  console.error('\nÉCHEC :', err.message);
  for (const [n, pg] of [['Alice', globalThis.__a], ['Bob', globalThis.__b]]) {
    if (!pg) continue;
    console.error(n, 'clue:', (await pg.textContent('#gClue').catch(() => '?')).replace(/\s+/g, ' ').slice(0, 200));
    console.error(n, 'feed:', (await pg.textContent('#gFeed').catch(() => '?')).replace(/\s+/g, ' ').slice(0, 200));
    await pg.screenshot({ path: `${OUT}echec-${n}.png` }).catch(() => {});
  }
  if (errors.length) console.error('Erreurs dans les pages :', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  await app.close();
  await stopGridWorker();
  const keys = await redis.keys(`${REDIS_PREFIX}*`);
  if (keys.length) await redis.del(...keys.map((k) => k.slice(REDIS_PREFIX.length)));
  await pool.end();
  redis.disconnect();
}
