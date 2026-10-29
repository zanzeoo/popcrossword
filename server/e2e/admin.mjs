// E2E de l'interface d'administration (client/admin/) contre un serveur local ; nettoie le thème « zz_test ».
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const SRV = new URL('../src', import.meta.url).pathname;
const PORT = 3198, URL_ = `http://127.0.0.1:${PORT}`;
process.env.PUBLIC_ORIGIN = URL_;
process.env.ADMIN_TOKEN = 'jeton-e2e';
const { buildApp } = await import(`${SRV}/app.js`);
const { pool } = await import(`${SRV}/db.js`);
const { redis } = await import(`${SRV}/redis.js`);
const { stopGridWorker } = await import(`${SRV}/game/grid.js`);
const { app } = await buildApp({ logger: false });
await app.listen({ host: '127.0.0.1', port: PORT });
const OUT = '/tmp/pc-shots/';
import { mkdirSync } from 'node:fs';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
let xss = false;
await page.exposeFunction('xssFired', () => { xss = true; });
try {
  await page.goto(`${URL_}/admin/`);
  await page.fill('input[type=password]', 'mauvais');
  await page.click('text=Entrer');
  await page.waitForSelector('text=Jeton invalide');
  await page.fill('input[type=password]', 'jeton-e2e');
  await page.click('text=Entrer');
  await page.waitForSelector('table');
  await page.screenshot({ path: OUT + 'admin-defs.png' });

  // Thème de test
  await page.click('nav >> text=Thèmes');
  await page.fill('input[placeholder^="Nouveau thème"]', 'ZZ Test');
  await page.click('text=Ajouter');
  await page.waitForSelector('td:has-text("ZZ Test")');

  // Création d'une définition
  await page.click('nav >> text=Définitions');
  await page.click('text=+ Nouveau');
  const dlg = page.locator('dialog');
  await dlg.locator('input').nth(0).fill('Spider-Man');
  await dlg.locator('input').nth(1).fill('Il lance des toiles');
  await dlg.locator('select').nth(0).selectOption('zz_test');
  await dlg.locator('text=Enregistrer').click();
  await page.waitForSelector('dialog', { state: 'detached' });
  await page.selectOption('.bar select >> nth=0', 'zz_test');
  await page.waitForSelector('td.rep:has-text("SPIDERMAN")');

  // Doublon → message d'erreur dans la fenêtre
  await page.click('text=+ Nouveau');
  await dlg.locator('input').nth(0).fill('spiderman');
  await dlg.locator('input').nth(1).fill('Il lance des toiles');
  await dlg.locator('select').nth(0).selectOption('zz_test');
  await dlg.locator('text=Enregistrer').click();
  await page.waitForSelector('dialog .err:has-text("doublon")');
  await dlg.locator('text=Annuler').click();

  // Modification, suppression, restauration, historique
  await page.click('tr:has-text("SPIDERMAN") >> text=Modifier');
  await dlg.locator('input').nth(1).fill('Héros arachnéen');
  await dlg.locator('text=Enregistrer').click();
  await page.waitForSelector('td:has-text("Héros arachnéen")');
  await page.click('tr:has-text("SPIDERMAN") >> text=Supprimer');
  await page.waitForSelector('text=Aucune définition');
  await page.selectOption('.bar select >> nth=4', 'oui');
  await page.click('tr.deleted >> text=Restaurer');
  await page.waitForSelector('text=Aucune définition');
  await page.selectOption('.bar select >> nth=4', 'non');
  await page.click('tr:has-text("SPIDERMAN") >> text=Historique');
  await page.waitForSelector('dialog:has-text("restaurer")');
  await page.screenshot({ path: OUT + 'admin-hist.png' });
  await dlg.locator('text=Fermer').click();

  // Modération avec une charge XSS dans la proposition
  await pool.query(`INSERT INTO definitions (reponse, texte, theme_id, source, statut, explication)
    VALUES ('OMEGA', $1, 'zz_test', 'communaute', 'en_attente', $2)`,
    ['<img src=x onerror=xssFired()>', '<script>xssFired()</script>']);
  await page.click('nav >> text=Modération');
  await page.waitForSelector('.card');
  await page.screenshot({ path: OUT + 'admin-mod.png' });
  assert.ok((await page.textContent('.card .def')).includes('<img'), 'texte affiché tel quel');
  await page.click('.card >> text=Refuser'); // sans motif : refus bloqué
  await page.waitForSelector('#toast.show:has-text("motif")');
  await page.fill('.card input', 'Trop vague');
  await page.click('.card >> text=Refuser');
  await page.waitForSelector('text=Aucune proposition en attente');
  const st = (await pool.query(`SELECT statut, commentaire FROM definitions WHERE reponse='OMEGA' AND theme_id='zz_test'`)).rows[0];
  assert.deepEqual({ ...st }, { statut: 'refusee', commentaire: 'Trop vague' });
  assert.equal(xss, false, 'aucun script injecté');

  // Thème : suppression refusée tant qu'il contient des définitions
  await page.click('nav >> text=Thèmes');
  await page.click('tr:has-text("ZZ Test") >> text=Supprimer');
  await page.waitForSelector('#toast.show:has-text("utilisent ce thème")');
  await page.screenshot({ path: OUT + 'admin-themes.png' });

  // Export CSV
  await page.click('nav >> text=Définitions');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Export CSV')]);
  assert.equal(dl.suggestedFilename(), 'definitions.csv');

  // Mobile
  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: OUT + 'admin-mobile.png' });
  assert.deepEqual(errors, []);
  console.log('E2E admin OK');
} catch (e) {
  await page.screenshot({ path: OUT + 'admin-fail.png' });
  console.error(e); process.exitCode = 1;
} finally {
  await browser.close();
  await pool.query(`DELETE FROM journal WHERE cible_type='theme' AND cible_id LIKE 'zz_test%' OR cible_type='definition' AND cible_id IN (SELECT id::text FROM definitions WHERE theme_id LIKE 'zz_test%')`);
  await pool.query(`DELETE FROM definitions WHERE theme_id LIKE 'zz_test%'`);
  await pool.query(`DELETE FROM themes WHERE id LIKE 'zz_test%'`);
  await app.close(); await stopGridWorker(); await pool.end(); redis.disconnect();
}
