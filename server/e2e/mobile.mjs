// Test de bout en bout du client mobile : Alice sur PC, Bob sur un téléphone simulé.
// Lancer avec « npm run e2e » (voir le README).
import { chromium, devices } from 'playwright';
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
function watch(page, name) {
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  return page;
}
const step = (msg) => console.log('•', msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let alice, bob;

try {
  alice = watch(await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage(), 'Alice');
  const { defaultBrowserType, ...iphone } = devices['iPhone 13'];
  bob = watch(await (await browser.newContext({ ...iphone })).newPage(), 'Bob');

  step('Alice crée un salon sur PC');
  await alice.goto(`${URL_}/`);
  await alice.waitForURL(/\/pc\/$/);
  await alice.fill('#hPseudo', 'Alice');
  await alice.click('#hCreate');
  await alice.waitForSelector('#scrLobby.on');
  const code = (await alice.textContent('#lCode')).trim();
  const link = await alice.inputValue('#lLink');
  assert.ok(await alice.isVisible('#lStart'), 'le créateur seul ne voit pas le bouton Lancer');
  assert.match(await alice.textContent('#lPlayers'), /Alice créateur toi/);
  assert.equal(link, `${URL_}/?code=${code}`);

  step('Bob ouvre le lien d\'invitation sur son téléphone : il arrive sur la version mobile');
  await bob.goto(link);
  await bob.waitForURL(new RegExp(`/mobile/\\?code=${code}$`));
  assert.equal(await bob.inputValue('#hCode'), code);
  await bob.fill('#hPseudo', 'Bob');
  await bob.tap('#hJoin');
  await bob.waitForSelector('#scrLobby.on');
  await alice.waitForFunction(() => document.querySelectorAll('#lPlayers .pill').length === 2);
  assert.match(await bob.textContent('#lPlayers'), /Bob toi/);
  const overflow = await bob.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 0, `débordement horizontal de ${overflow}px`);
  await bob.screenshot({ path: `${OUT}m1-salon-bob.png` });

  step('PWA : manifeste, icônes et service worker');
  const man = await bob.evaluate(async () => { const r = await fetch('/mobile/manifest.webmanifest'); return { ok: r.ok, type: r.headers.get('content-type'), body: await r.json() }; });
  assert.ok(man.ok && /json/.test(man.type), man.type);
  assert.equal(man.body.start_url, '/mobile/');
  for (const ic of man.body.icons) assert.equal((await bob.evaluate((u) => fetch(u).then((r) => r.status), ic.src)), 200);
  const sw = await bob.evaluate(() => navigator.serviceWorker.ready.then((r) => r.active && r.active.scriptURL));
  assert.match(sw, /\/mobile\/sw\.js$/);

  step('Alice lance la partie');
  await alice.click('#lStart');
  await Promise.all([alice.waitForSelector('#scrGame.on'), bob.waitForSelector('#scrGame.on')]);
  const room = rooms.rooms.get(code);
  const words = room.game.grid.words;
  assert.equal(await bob.locator('#gGrid .cell').count(), 130);
  assert.equal(await bob.locator('#gKb [data-k]').count(), 28);
  const gridBox = await bob.locator('#gGrid').boundingBox();
  assert.ok(gridBox.width <= 390, `grille trop large : ${gridBox.width}`);
  await bob.screenshot({ path: `${OUT}m2-partie-bob.png` });

  // Bob joue au clavier intégré ; Alice au clavier physique.
  async function bobPlays(wi, letters) {
    await bob.evaluate((i) => { selectWord(i, G.words[i].cells[0]); render(); }, wi);
    for (const ch of letters) await bob.tap(`#gKb [data-k="${ch}"]`);
    await bob.tap('#gKb [data-k="OK"]');
  }
  async function alicePlays(wi, letters) {
    await alice.evaluate((i) => { selectWord(i, G.words[i].cells[0]); render(); }, wi);
    await alice.keyboard.type(letters.toLowerCase(), { delay: 5 });
    await alice.keyboard.press('Enter');
  }
  const letterOf = (page, k) => page.evaluate((k) => document.querySelectorAll('#gGrid .cell')[k].querySelector('.l')?.textContent, k);

  step('Bob trouve un mot avec le clavier intégré');
  await bobPlays(0, words[0].ans);
  await alice.waitForFunction((k) => document.querySelectorAll('#gGrid .cell')[k].querySelector('.l')?.textContent.length === 1, words[0].cells[0]);
  assert.equal(await letterOf(alice, words[0].cells[0]), words[0].ans[0]);
  await bob.waitForFunction(() => /Bien joué/.test(document.querySelector('#gTicker').textContent));

  step('Bob se trompe');
  await sleep(1000);
  const open1 = words.map((w, i) => i).filter((i) => room.game.found[i] == null);
  await bobPlays(open1[0], 'Z'.repeat(words[open1[0]].ans.length));
  await bob.waitForFunction(() => /Raté/.test(document.querySelector('#gTicker').textContent));
  await bob.screenshot({ path: `${OUT}m3-erreur-bob.png` });

  step('Alice trouve un mot : Bob le voit dans la ligne d\'info');
  await alicePlays(open1[0], words[open1[0]].ans);
  await bob.waitForFunction(() => /Alice trouve/.test(document.querySelector('#gTicker').textContent));

  step('Bob recharge la page en pleine partie');
  await bob.reload();
  await bob.waitForSelector('#scrGame.on');
  await bob.waitForFunction((k) => document.querySelectorAll('#gGrid .cell')[k].querySelector('.l')?.textContent.length === 1, words[0].cells[0]);

  step('Bob ouvre le fil de la partie et la légende');
  await bob.tap('#gMenuBtn');
  await bob.tap('#gMenu [data-act=feed]');
  await bob.waitForSelector('#gSheetWrap:not([hidden])');
  await bob.screenshot({ path: `${OUT}m4-fil-bob.png` });
  await bob.tap('#gSheetClose');
  await bob.tap('#gMenuBtn');
  await bob.tap('#gMenu [data-act=legend]');
  assert.match(await bob.textContent('#gSheetBody'), /Mot faux : −10/);
  await bob.tap('#gSheetClose');

  step('La grille se remplit jusqu\'à 80 %');
  const pct = () => { const g = room.game; return g.letters.filter((k) => g.fill[k] != null).length / g.letters.length; };
  let turn = 0;
  while (pct() < 0.8) {
    const open = words.map((w, i) => i).filter((i) => room.game.found[i] == null);
    if (turn++ % 2) await bobPlays(open[0], words[open[0]].ans); else await alicePlays(open[0], words[open[0]].ans);
    await sleep(550);
  }

  step('Bob propose le mot mystère avec le clavier intégré');
  await bob.waitForSelector('#gMAct [data-m=open]');
  await bob.tap('#gMAct [data-m=open]');
  for (const ch of room.game.grid.myst.ans) await bob.tap(`#gKb [data-k="${ch}"]`);
  await bob.screenshot({ path: `${OUT}m5-mystere-bob.png` });
  await bob.tap('#gKb [data-k="OK"]');
  await bob.waitForFunction(() => /✓ \+100/.test(document.querySelector('#gMAct').textContent));

  step('Fin de la grille (mode classique)');
  while (room.status === 'playing') {
    const open = words.map((w, i) => i).filter((i) => room.game.found[i] == null);
    if (!open.length) break;
    if (turn++ % 2) await bobPlays(open[0], words[open[0]].ans); else await alicePlays(open[0], words[open[0]].ans);
    await sleep(550);
  }
  await Promise.all([alice.waitForSelector('#scrRecap.on'), bob.waitForSelector('#scrRecap.on')]);
  assert.match(await bob.textContent('#recap'), /Grille complète/);
  await bob.screenshot({ path: `${OUT}m6-recap-bob.png`, fullPage: true });

  step('Bob revoit la grille');
  await bob.tap('#rReview2');
  await bob.waitForSelector('#scrGame.on');
  await bob.waitForSelector('#gKb .reviewbar');
  await bob.screenshot({ path: `${OUT}m7-revue-bob.png` });
  await bob.tap('#gKb [data-r=back]');
  await bob.waitForSelector('#scrRecap.on');

  assert.deepEqual(errors, []);
  console.log('\nTOUT EST OK');
} catch (err) {
  console.error('\nÉCHEC :', err.message);
  if (errors.length) console.error('Erreurs dans les pages :', errors);
  if (bob) await bob.screenshot({ path: `${OUT}m-echec-bob.png` }).catch(() => {});
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
